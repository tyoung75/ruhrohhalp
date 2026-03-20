/**
 * POST /api/sync/linear — Bidirectional Linear ↔ TylerOS sync.
 *
 * Pull: fetches Linear issues → upserts into tasks table.
 * Push: sends TylerOS task changes → updates Linear issues.
 *
 * Query params:
 *   ?direction=pull  (default) — Linear → TylerOS
 *   ?direction=push  — TylerOS → Linear
 *   ?direction=both  — full bidirectional sync
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveProjectId } from "@/lib/processors/projects";
import { logError } from "@/lib/logger";
import {
  fetchTeamIssues,
  updateLinearIssue,
  createLinearIssue,
  fetchTeamStates,
} from "@/lib/linear/client";
import {
  linearIssueToTaskData,
  linearProjectToSlug,
  resolveSyncDirection,
  statusToLinearStateType,
  tylerOSPriorityToLinear,
} from "@/lib/linear/sync";

// Tyler's ty-life-OS team ID
const TEAM_ID = "b189b68f-3e71-4923-87c6-a44f8bd1f68f";

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const direction = request.nextUrl.searchParams.get("direction") ?? "pull";
  const results = { pulled: 0, pushed: 0, skipped: 0, errors: [] as string[] };

  try {
    if (direction === "pull" || direction === "both") {
      await pullFromLinear(user.id, results);
    }

    if (direction === "push" || direction === "both") {
      await pushToLinear(user.id, results);
    }

    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    logError("sync.linear", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Pull: Linear → TylerOS
// ---------------------------------------------------------------------------

async function pullFromLinear(
  userId: string,
  results: { pulled: number; skipped: number; errors: string[] },
) {
  const supabase = await createClient();

  // Get the last sync time to only fetch updated issues
  const { data: lastSynced } = await supabase
    .from("tasks")
    .select("linear_synced_at")
    .eq("user_id", userId)
    .not("linear_synced_at", "is", null)
    .order("linear_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const issues = await fetchTeamIssues(TEAM_ID, {
    updatedAfter: lastSynced?.linear_synced_at ?? undefined,
    limit: 100,
  });

  for (const issue of issues) {
    try {
      // Check if task already exists for this Linear issue
      const { data: existing } = await supabase
        .from("tasks")
        .select("id, updated_at, linear_synced_at")
        .eq("user_id", userId)
        .eq("linear_issue_id", issue.id)
        .maybeSingle();

      if (existing) {
        const direction = resolveSyncDirection(
          issue.updatedAt,
          existing.updated_at,
          existing.linear_synced_at,
        );

        if (direction === "in-sync" || direction === "tyleros-wins") {
          results.skipped++;
          continue;
        }

        // Linear wins — update the TylerOS task
        const taskData = linearIssueToTaskData(issue);
        await supabase.from("tasks").update(taskData).eq("id", existing.id);
        results.pulled++;
      } else {
        // New issue — insert as a TylerOS task
        const taskData = linearIssueToTaskData(issue);

        // Resolve project_id from Linear project name
        const slug = linearProjectToSlug(issue.project?.name);
        let projectId: string | undefined;
        if (slug) {
          projectId = await resolveProjectId(userId, slug);
        }

        await supabase.from("tasks").insert({
          ...taskData,
          user_id: userId,
          project_id: projectId ?? null,
        });
        results.pulled++;
      }
    } catch (err) {
      results.errors.push(`Pull ${issue.identifier}: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Push: TylerOS → Linear
// ---------------------------------------------------------------------------

async function pushToLinear(
  userId: string,
  results: { pushed: number; skipped: number; errors: string[] },
) {
  const supabase = await createClient();

  // Fetch workflow states for status mapping
  const states = await fetchTeamStates(TEAM_ID);

  function findStateId(targetType: string): string | undefined {
    // Prefer specific state names
    const state = states.find((s) => s.type === targetType);
    return state?.id;
  }

  // --- Push updates for tasks that already have a linear_issue_id ---
  const { data: linkedTasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .not("linear_issue_id", "is", null);

  for (const task of linkedTasks ?? []) {
    try {
      const direction = resolveSyncDirection(
        task.updated_at, // This is a simplification — we don't have the Linear updatedAt here
        task.updated_at,
        task.linear_synced_at,
      );

      // Only push if TylerOS was updated after the last sync
      if (direction === "in-sync") {
        results.skipped++;
        continue;
      }

      const stateType = statusToLinearStateType(task.status as "open" | "done");
      const stateId = findStateId(stateType);

      await updateLinearIssue(task.linear_issue_id!, {
        title: task.title,
        description: task.description || undefined,
        priority: tylerOSPriorityToLinear(task.priority as "high" | "medium" | "low"),
        stateId,
      });

      // Update sync timestamp
      await supabase
        .from("tasks")
        .update({ linear_synced_at: new Date().toISOString() })
        .eq("id", task.id);

      results.pushed++;
    } catch (err) {
      results.errors.push(`Push ${task.title}: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  // --- Create Linear issues for unlinked tasks ---
  const { data: unlinkTasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .is("linear_issue_id", null)
    .eq("type", "task"); // Only push tasks, not notes/reminders

  for (const task of unlinkTasks ?? []) {
    try {
      const stateType = statusToLinearStateType(task.status as "open" | "done");
      const stateId = findStateId(stateType);

      const created = await createLinearIssue({
        teamId: TEAM_ID,
        title: task.title,
        description: task.description || undefined,
        priority: tylerOSPriorityToLinear(task.priority as "high" | "medium" | "low"),
        stateId,
      });

      // Link the task to the new Linear issue
      await supabase
        .from("tasks")
        .update({
          linear_issue_id: created.id,
          linear_url: created.url,
          linear_synced_at: new Date().toISOString(),
        })
        .eq("id", task.id);

      results.pushed++;
    } catch (err) {
      results.errors.push(`Create ${task.title}: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }
}
