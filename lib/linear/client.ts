/**
 * Linear API client for bidirectional sync.
 *
 * Uses the Linear GraphQL API with a personal API key stored in LINEAR_API_KEY.
 */

const LINEAR_API = "https://api.linear.app/graphql";

function getApiKey(): string {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error("LINEAR_API_KEY is not set");
  return key;
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getApiKey(),
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Linear API error: ${json.errors[0]?.message ?? "Unknown"}`);
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinearIssue {
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

export interface LinearCreateResult {
  id: string;
  identifier: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const ISSUE_FRAGMENT = `
  id
  identifier
  title
  description
  url
  priority
  updatedAt
  createdAt
  state { name type }
  assignee { name id }
  labels { nodes { name } }
  project { id name }
  team { id name key }
`;

/** Fetch all issues for a team, optionally filtered by updatedAt. */
export async function fetchTeamIssues(
  teamId: string,
  opts?: { updatedAfter?: string; limit?: number },
): Promise<LinearIssue[]> {
  const limit = opts?.limit ?? 100;
  const filter = opts?.updatedAfter
    ? `, filter: { updatedAt: { gte: "${opts.updatedAfter}" } }`
    : "";

  const data = await gql<{ team: { issues: { nodes: LinearIssue[] } } }>(`
    query {
      team(id: "${teamId}") {
        issues(first: ${limit}, orderBy: updatedAt${filter}) {
          nodes { ${ISSUE_FRAGMENT} }
        }
      }
    }
  `);

  return data.team.issues.nodes;
}

/** Fetch a single issue by its identifier (e.g. TYOS-123). */
export async function fetchIssue(identifier: string): Promise<LinearIssue> {
  const data = await gql<{ issue: LinearIssue }>(`
    query {
      issue(id: "${identifier}") { ${ISSUE_FRAGMENT} }
    }
  `);
  return data.issue;
}

/** Create a new Linear issue. */
export async function createLinearIssue(input: {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
  stateId?: string;
  projectId?: string;
}): Promise<LinearCreateResult> {
  const data = await gql<{ issueCreate: { success: boolean; issue: LinearCreateResult } }>(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
    { input },
  );

  if (!data.issueCreate.success) throw new Error("Failed to create Linear issue");
  return data.issueCreate.issue;
}

/** Update an existing Linear issue. */
export async function updateLinearIssue(
  issueId: string,
  input: {
    title?: string;
    description?: string;
    priority?: number;
    stateId?: string;
  },
): Promise<void> {
  const data = await gql<{ issueUpdate: { success: boolean } }>(
    `mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`,
    { id: issueId, input },
  );

  if (!data.issueUpdate.success) throw new Error("Failed to update Linear issue");
}

/** Fetch workflow states for a team (for mapping TylerOS status → Linear state). */
export async function fetchTeamStates(
  teamId: string,
): Promise<{ id: string; name: string; type: string }[]> {
  const data = await gql<{
    workflowStates: { nodes: { id: string; name: string; type: string }[] };
  }>(`
    query {
      workflowStates(filter: { team: { id: { eq: "${teamId}" } } }) {
        nodes { id name type }
      }
    }
  `);

  return data.workflowStates.nodes;
}
