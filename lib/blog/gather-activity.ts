import { createAdminClient } from "@/lib/supabase/admin";
import type { ActivityItem, WeeklyActivity } from "@/lib/blog/types";

type RepoConfig = { owner: string; repo: string; project: ActivityItem["project"] };

const PUBLIC_REPOS: RepoConfig[] = [
  { owner: "tyoung75", repo: "Motus", project: "motus" },
  { owner: "tyoung75", repo: "TheStayed", project: "thestayed" },
  { owner: "tyoung75", repo: "bearduckhornempire.com", project: "bdhe" },
];

function norm(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchGithubCommits(sinceIso: string): Promise<ActivityItem[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return [];

  const items: ActivityItem[] = [];

  for (const repo of PUBLIC_REPOS) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits?since=${encodeURIComponent(sinceIso)}&per_page=50`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
          cache: "no-store",
        },
      );

      if (!res.ok) continue;
      const commits = (await res.json()) as Array<{
        html_url: string;
        commit: { message: string; author?: { date?: string } };
      }>;

      for (const commit of commits) {
        const firstLine = commit.commit.message.split("\n")[0] ?? "Code update";
        items.push({
          type: "commit",
          source: `github:${repo.owner}/${repo.repo}`,
          project: repo.project,
          title: firstLine,
          summary: firstLine,
          url: commit.html_url,
          timestamp: commit.commit.author?.date ?? new Date().toISOString(),
          tags: ["code", "github"],
        });
      }
    } catch {
      // graceful degradation
    }
  }

  return items;
}

async function fetchCompletedTasks(sinceIso: string): Promise<ActivityItem[]> {
  const supabase = createAdminClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, slug")
    .in("slug", ["motus", "thestayed", "bdhe"]);

  const projectMap = new Map<string, ActivityItem["project"]>();
  (projects ?? []).forEach((p) => {
    const slug = (p.slug as string | undefined) ?? "other";
    projectMap.set(p.id as string, slug as ActivityItem["project"]);
  });

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, description, updated_at, status, project_id")
    .eq("status", "done")
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(200);

  return (tasks ?? []).map((task) => ({
    type: "task",
    source: "ruhrohhalp:tasks",
    project: projectMap.get(task.project_id as string) ?? "other",
    title: task.title as string,
    summary: (task.description as string | null) || (task.title as string),
    timestamp: task.updated_at as string,
    tags: ["task", "completed"],
  }));
}

function dedupeAndGroup(commits: ActivityItem[], tasks: ActivityItem[]): ActivityItem[] {
  const taskNorm = new Set(tasks.map((t) => norm(t.title)));
  const filteredCommits = commits.filter((c) => !taskNorm.has(norm(c.title)));

  const byProject = new Map<string, ActivityItem[]>();
  for (const item of filteredCommits) {
    const key = `${item.project}`;
    const existing = byProject.get(key) ?? [];
    existing.push(item);
    byProject.set(key, existing);
  }

  const grouped: ActivityItem[] = [];
  for (const [project, entries] of byProject.entries()) {
    if (entries.length < 2) {
      grouped.push(...entries);
      continue;
    }

    grouped.push({
      type: "grouped_change",
      source: "github:grouped",
      project: project as ActivityItem["project"],
      title: `${project.toUpperCase()}: ${entries.length} code updates`,
      summary: entries.slice(0, 4).map((e) => e.title).join("; "),
      timestamp: entries[0].timestamp,
      tags: ["code", "summary"],
    });
  }

  return [...tasks, ...grouped].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

/**
 * Compute the Sunday-to-Sunday window ending on or before `now`.
 * "Most recent Sunday" = the last Sunday at-or-before now.
 * "Previous Sunday" = 7 days before that.
 */
function sundayToSundayWindow(now: Date): { start: Date; end: Date } {
  const day = now.getUTCDay(); // 0 = Sunday
  const end = new Date(now);
  end.setUTCDate(now.getUTCDate() - day); // most recent Sunday
  end.setUTCHours(23, 59, 59, 999);

  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 7); // previous Sunday
  start.setUTCHours(0, 0, 0, 0);

  return { start, end };
}

export async function gatherWeeklyActivity(lookbackDays?: number): Promise<WeeklyActivity> {
  const now = new Date();

  let sinceDate: Date;
  let untilDate: Date;

  if (lookbackDays) {
    // Legacy: explicit lookback from now
    sinceDate = new Date(now);
    sinceDate.setUTCDate(now.getUTCDate() - lookbackDays);
    untilDate = now;
  } else {
    // Default: previous Sunday → most recent Sunday
    const window = sundayToSundayWindow(now);
    sinceDate = window.start;
    untilDate = window.end;
  }

  const sinceIso = sinceDate.toISOString();

  const [commits, tasks] = await Promise.all([fetchGithubCommits(sinceIso), fetchCompletedTasks(sinceIso)]);
  const items = dedupeAndGroup(commits, tasks);

  return {
    lookbackDays: lookbackDays ?? Math.round((untilDate.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24)),
    weekStartIso: sinceIso,
    weekEndIso: untilDate.toISOString(),
    items,
    stats: {
      commitCount: commits.length,
      taskCount: tasks.length,
      groupedChanges: items.filter((i) => i.type === "grouped_change").length,
    },
  };
}
