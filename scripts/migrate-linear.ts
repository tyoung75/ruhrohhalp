/**
 * Migrate-Linear Script
 *
 * One-time migration to import Linear issues into Supabase tasks table.
 * Maps Linear fields to ruhrohhalp schema with proper priority and state mappings.
 *
 * Usage: npx tsx scripts/migrate-linear.ts
 *
 * Environment variables required:
 * - LINEAR_API_KEY: Linear GraphQL API key
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_KEY: Supabase service role key
 * - TYLER_USER_ID: UUID of the user to own the migrated tasks
 */

import { createClient } from "@supabase/supabase-js";

// ============================================================================
// Environment setup
// ============================================================================

const LINEAR_API = "https://api.linear.app/graphql";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const TYLER_USER_ID = process.env.TYLER_USER_ID;

if (!LINEAR_API_KEY) throw new Error("LINEAR_API_KEY is required");
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required");
if (!SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_SERVICE_KEY is required");
if (!TYLER_USER_ID) throw new Error("TYLER_USER_ID is required");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================================================
// Linear API Client
// ============================================================================

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number;
  updatedAt: string;
  createdAt: string;
  state: { name: string; type: string };
  assignee: { name: string; id: string } | null;
  labels: { nodes: { name: string }[] };
  project: { id: string; name: string } | null;
  team: { id: string; name: string; key: string };
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors) {
    throw new Error(`Linear API error: ${json.errors[0]?.message ?? "Unknown"}`);
  }
  return json.data as T;
}

async function fetchTeamId(teamKey: string): Promise<string> {
  const data = await gql<{
    teams: { nodes: Array<{ id: string; name: string; key: string }> };
  }>(`
    query { teams(filter: { key: { eq: "${teamKey}" } }) { nodes { id name key } } }
  `);
  const team = data.teams.nodes[0];
  if (!team) throw new Error(`Team with key "${teamKey}" not found`);
  console.log(`Found team: ${team.name} (${team.id})`);
  return team.id;
}

async function fetchTeamIssues(teamKey: string): Promise<LinearIssue[]> {
  const teamId = await fetchTeamId(teamKey);

  const allIssues: LinearIssue[] = [];
  let hasMore = true;
  let after: string | null = null;

  while (hasMore) {
    const afterClause = after ? `, after: "${after}"` : "";

    const data = await gql<{
      issues: {
        nodes: LinearIssue[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    }>(`
      query {
        issues(first: 50, filter: { team: { id: { eq: "${teamId}" } } }${afterClause}) {
          nodes {
            id identifier title description url priority updatedAt createdAt
            state { name type }
            assignee { name id }
            labels { nodes { name } }
            project { id name }
            team { id name key }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `);

    const issues = data.issues.nodes;
    allIssues.push(...issues);
    hasMore = data.issues.pageInfo.hasNextPage;
    after = data.issues.pageInfo.endCursor;

    console.log(`Fetched ${issues.length} issues, total: ${allIssues.length}`);
  }

  return allIssues;
}

// ============================================================================
// Mapping functions
// ============================================================================

/** Map Linear priority (0-4) to priority text (high/medium/low) */
function linearPriorityToText(priority: number): "high" | "medium" | "low" {
  switch (priority) {
    case 1: // Urgent
    case 2: // High
      return "high";
    case 3: // Normal
      return "medium";
    case 4: // Low
    case 0: // None
    default:
      return "low";
  }
}

/** Map Linear priority (0-4) to priority_num (1-4) */
function linearPriorityToNum(priority: number): 1 | 2 | 3 | 4 {
  switch (priority) {
    case 1:
      return 1; // urgent
    case 2:
      return 2; // high
    case 3:
      return 3; // normal
    case 4:
    case 0:
    default:
      return 4; // low
  }
}

/** Map Linear state to our state column */
function linearStateToState(stateType: string): string {
  switch (stateType.toLowerCase()) {
    case "completed":
      return "done";
    case "canceled":
      return "cancelled";
    case "started":
      return "started";
    case "unstarted":
      return "unstarted";
    case "backlog":
      return "backlog";
    default:
      return "unstarted";
  }
}

/** Map Linear state to our status column (backward compat) */
function linearStateToStatus(stateType: string): "open" | "done" {
  switch (stateType.toLowerCase()) {
    case "completed":
    case "canceled":
      return "done";
    default:
      return "open";
  }
}

/** Map Linear project name to TylerOS project slug */
function linearProjectToSlug(projectName: string | null | undefined): string | undefined {
  if (!projectName) return undefined;

  const map: Record<string, string> = {
    Motus: "motus",
    "Iron Passport": "iron-passport",
    "ruhrohhalp.com": "ruhrohhalp",
    thestayed: "thestayed",
    "bearduckhornempire.com": "bearduckhornempire",
    "BearDuckHornEmpire.com Launch": "bearduckhornempire",
    Personal: "personal",
    "Life OS": "life-os",
    "AI Brain": "ai-brain",
    "Financial Command Center": "financial-command-center",
    "Real Estate Investment Analyzer": "real-estate-analyzer",
    "Restaurant Reservation Notifier": "restaurant-notifier",
  };

  return map[projectName] ?? projectName.toLowerCase().replace(/\s+/g, "-");
}

// ============================================================================
// Migration logic
// ============================================================================

async function ensureProjectsExist(issues: LinearIssue[]): Promise<Record<string, string>> {
  const projectMap = new Map<string, string>();
  const projectSlugs = new Set<string>();

  // Collect unique projects from issues
  for (const issue of issues) {
    if (issue.project?.name) {
      const slug = linearProjectToSlug(issue.project.name);
      if (slug) {
        projectSlugs.add(slug);
      }
    }
  }

  // Check which projects already exist
  const { data: existingProjects } = await supabase
    .from("projects")
    .select("id, slug")
    .eq("user_id", TYLER_USER_ID)
    .in("slug", Array.from(projectSlugs));

  const existingMap = new Map(existingProjects?.map((p) => [p.slug, p.id]) ?? []);

  // Insert missing projects
  const projectsToInsert = Array.from(projectSlugs)
    .filter((slug) => !existingMap.has(slug))
    .map((slug) => ({
      user_id: TYLER_USER_ID,
      name: slug.replace(/-/g, " ").toUpperCase(),
      slug,
      description: `Migrated from Linear`,
      status: "active" as const,
      priority: "medium" as const,
    }));

  if (projectsToInsert.length > 0) {
    const { data: inserted } = await supabase
      .from("projects")
      .insert(projectsToInsert)
      .select("id, slug");

    if (inserted) {
      inserted.forEach((p) => {
        existingMap.set(p.slug, p.id);
      });
    }
    console.log(`Created ${projectsToInsert.length} new projects`);
  }

  return Object.fromEntries(existingMap);
}

async function migrateIssues(
  issues: LinearIssue[],
  projectMap: Record<string, string>,
): Promise<void> {
  const tasksToInsert = issues.map((issue) => {
    const projectSlug = linearProjectToSlug(issue.project?.name);
    const projectId = projectSlug ? projectMap[projectSlug] : null;

    return {
      user_id: TYLER_USER_ID,
      title: issue.title,
      description: issue.description ?? "",
      type: "task" as const,
      priority: linearPriorityToText(issue.priority),
      priority_num: linearPriorityToNum(issue.priority),
      state: linearStateToState(issue.state.type),
      status: linearStateToStatus(issue.state.type),
      how_to: "",
      recommended_ai: "claude" as const,
      recommended_model: "claude-sonnet-4-5",
      ai_reason: "Migrated from Linear",
      source_text: `Linear: ${issue.identifier}`,
      source: "linear_import" as const,
      identifier: issue.identifier,
      linear_issue_id: issue.id,
      linear_url: issue.url,
      linear_synced_at: new Date().toISOString(),
      project_id: projectId ?? null,
      created_at: issue.createdAt,
      updated_at: issue.updatedAt,
    };
  });

  // Insert in batches of 100 to avoid overwhelming Supabase
  const batchSize = 100;
  for (let i = 0; i < tasksToInsert.length; i += batchSize) {
    const batch = tasksToInsert.slice(i, i + batchSize);
    const { error } = await supabase.from("tasks").insert(batch);

    if (error) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, error);
      throw error;
    }

    const progress = Math.min(i + batchSize, tasksToInsert.length);
    console.log(
      `Migrated ${progress}/${tasksToInsert.length} issues (${Math.round((progress / tasksToInsert.length) * 100)}%)`,
    );
  }

  console.log(`Successfully migrated all ${tasksToInsert.length} issues`);
}

// ============================================================================
// Main execution
// ============================================================================

async function main() {
  try {
    console.log("Starting Linear migration...");
    console.log(`Target user ID: ${TYLER_USER_ID}`);

    console.log("\nFetching all issues from TYOS team...");
    const issues = await fetchTeamIssues("TYOS");
    console.log(`Found ${issues.length} total issues`);

    console.log("\nEnsuring projects exist...");
    const projectMap = await ensureProjectsExist(issues);
    console.log(`Project mapping ready: ${Object.keys(projectMap).length} projects`);

    console.log("\nMigrating issues to tasks table...");
    await migrateIssues(issues, projectMap);

    console.log("\n✓ Migration complete!");
  } catch (error) {
    console.error("\n✗ Migration failed:", error);
    process.exit(1);
  }
}

main();
