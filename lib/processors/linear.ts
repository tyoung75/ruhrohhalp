/**
 * TYOS-281 — Linear issue processor.
 *
 * - Maps Linear priority (1=Urgent→9, 2=High→7, 3=Normal→5, 4=Low→3).
 * - Extracts project/team name and resolves to TylerOS project_id.
 */

import type { EmbedMetadata } from "@/lib/embedding/pipeline";
import { resolveProjectId } from "@/lib/processors/projects";

// ---------------------------------------------------------------------------
// Priority mapping
// ---------------------------------------------------------------------------

/** Linear priority → TylerOS importance (1–10). */
const PRIORITY_MAP: Record<number, number> = {
  0: 5,  // No priority
  1: 9,  // Urgent
  2: 7,  // High
  3: 5,  // Normal / Medium
  4: 3,  // Low
};

export function mapPriority(linearPriority: number | undefined | null): number {
  if (linearPriority == null) return 5;
  return PRIORITY_MAP[linearPriority] ?? 5;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LinearPayload {
  userId: string;
  action: string;
  type: string;
  data: {
    id: string;
    title: string;
    description?: string;
    state?: { name: string };
    priority?: number;
    assignee?: { name: string };
    labels?: { name: string }[];
    team?: { name: string };
    project?: { name: string };
    url?: string;
  };
  projectId?: string;
  tags?: string[];
}

export interface ProcessedLinear {
  content: string;
  metadata: Omit<EmbedMetadata, "userId"> & { userId: string };
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export async function process(payload: LinearPayload): Promise<ProcessedLinear> {
  const { userId, action, type, data, tags } = payload;

  const importance = mapPriority(data.priority);
  const labels = (data.labels ?? []).map((l) => l.name);

  // Resolve project_id from Linear's project or team name
  let projectId = payload.projectId;
  if (!projectId) {
    const projectName = data.project?.name ?? data.team?.name;
    if (projectName) {
      projectId = await resolveProjectId(userId, projectName);
    }
  }

  // Format structured content
  const content = [
    `[Linear ${type}] ${data.title}`,
    `Action: ${action}`,
    `Priority: ${data.priority ?? "none"} (importance: ${importance})`,
    data.state?.name ? `Status: ${data.state.name}` : null,
    data.assignee?.name ? `Assignee: ${data.assignee.name}` : null,
    data.team?.name ? `Team: ${data.team.name}` : null,
    data.project?.name ? `Project: ${data.project.name}` : null,
    labels.length > 0 ? `Labels: ${labels.join(", ")}` : null,
    data.url ? `URL: ${data.url}` : null,
    data.description ? `\n${data.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    content,
    metadata: {
      userId,
      source: "task",
      sourceId: data.id,
      projectId,
      category: "work",
      importance,
      tags: tags ?? ["linear", ...labels],
    },
  };
}
