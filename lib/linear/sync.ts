/**
 * Linear ↔ TylerOS bidirectional sync logic.
 *
 * Maps between Linear issue fields and TylerOS task fields.
 * Handles conflict resolution via last-write-wins on updated_at.
 */

import type { Priority } from "@/lib/types/domain";
import type { LinearIssue } from "@/lib/linear/client";

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/** Linear state type → TylerOS status. */
export function linearStateToStatus(stateType: string): "open" | "done" {
  switch (stateType) {
    case "completed":
    case "canceled":
      return "done";
    default:
      // backlog, unstarted, started, triage
      return "open";
  }
}

/** TylerOS status → target Linear state type. */
export function statusToLinearStateType(status: "open" | "done"): string {
  return status === "done" ? "completed" : "started";
}

// ---------------------------------------------------------------------------
// Priority mapping
// ---------------------------------------------------------------------------

/** Linear priority (0-4) → TylerOS priority. */
export function linearPriorityToTylerOS(linearPriority: number): Priority {
  switch (linearPriority) {
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

/** TylerOS priority → Linear priority (0-4). */
export function tylerOSPriorityToLinear(priority: Priority): number {
  switch (priority) {
    case "high":
      return 2;
    case "medium":
      return 3;
    case "low":
      return 4;
  }
}

// ---------------------------------------------------------------------------
// Project mapping (Linear project name → known slug)
// ---------------------------------------------------------------------------

/** Map Linear project names to TylerOS project slugs. */
const LINEAR_PROJECT_MAP: Record<string, string> = {
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

export function linearProjectToSlug(projectName: string | null | undefined): string | undefined {
  if (!projectName) return undefined;
  return LINEAR_PROJECT_MAP[projectName] ?? projectName.toLowerCase().replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// Sync direction resolution (last-write-wins)
// ---------------------------------------------------------------------------

export type SyncDirection = "linear-wins" | "tyleros-wins" | "in-sync" | "new-from-linear";

export function resolveSyncDirection(
  linearUpdatedAt: string,
  tylerOSUpdatedAt: string | null,
  linearSyncedAt: string | null,
): SyncDirection {
  // Brand new from Linear — never seen before
  if (!tylerOSUpdatedAt || !linearSyncedAt) return "new-from-linear";

  const linearTime = new Date(linearUpdatedAt).getTime();
  const tylerOSTime = new Date(tylerOSUpdatedAt).getTime();
  const syncTime = new Date(linearSyncedAt).getTime();

  // Both unchanged since last sync
  if (linearTime <= syncTime && tylerOSTime <= syncTime) return "in-sync";

  // Linear changed more recently
  if (linearTime > tylerOSTime) return "linear-wins";

  // TylerOS changed more recently
  return "tyleros-wins";
}

// ---------------------------------------------------------------------------
// Build TylerOS task insert data from a Linear issue
// ---------------------------------------------------------------------------

export function linearIssueToTaskData(issue: LinearIssue) {
  return {
    title: issue.title,
    description: issue.description ?? "",
    type: "task" as const,
    priority: linearPriorityToTylerOS(issue.priority),
    status: linearStateToStatus(issue.state.type),
    how_to: "",
    recommended_ai: "claude" as const,
    recommended_model: "claude-sonnet-4-5",
    ai_reason: "Synced from Linear",
    source_text: `Linear: ${issue.identifier}`,
    linear_issue_id: issue.id,
    linear_url: issue.url,
    linear_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
