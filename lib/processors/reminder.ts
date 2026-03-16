/**
 * TYOS-281 — Reminder ingestion processor.
 *
 * - Parses project prefix from list name (MOTUS:, RNTLX:, Caliber:, etc.)
 * - Resolves to TylerOS project_id.
 */

import type { EmbedMetadata } from "@/lib/embedding/pipeline";
import { resolveProjectId } from "@/lib/processors/projects";

// ---------------------------------------------------------------------------
// Prefix parsing
// ---------------------------------------------------------------------------

/** Known prefixes → project slugs. Case-insensitive matching. */
const PREFIX_MAP: Record<string, string> = {
  "motus": "motus",
  "rntlx": "ruhrohhalp",
  "ruhrohhalp": "ruhrohhalp",
  "caliber": "caliber",
  "iron passport": "iron-passport",
  "ironpassport": "iron-passport",
  "thestayed": "thestayed",
  "personal": "personal",
};

export function parseProjectPrefix(title: string): { cleanTitle: string; slug?: string } {
  // Match "PREFIX: rest of title" or "PREFIX - rest of title"
  const match = title.match(/^([A-Za-z\s]+?)[:–\-]\s*(.+)$/);
  if (!match) return { cleanTitle: title };

  const prefix = match[1].trim().toLowerCase();
  const slug = PREFIX_MAP[prefix];
  if (slug) {
    return { cleanTitle: match[2].trim(), slug };
  }

  return { cleanTitle: title };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReminderPayload {
  userId: string;
  title: string;
  body?: string;
  listName?: string;
  dueAt?: string;
  projectId?: string;
  tags?: string[];
}

export interface ProcessedReminder {
  content: string;
  metadata: Omit<EmbedMetadata, "userId"> & { userId: string };
  detectedProject?: string;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export async function process(payload: ReminderPayload): Promise<ProcessedReminder> {
  const { userId, body, dueAt, tags } = payload;

  // 1. Try to parse project from title prefix
  const { cleanTitle, slug: titleSlug } = parseProjectPrefix(payload.title);

  // 2. Also try from listName if provided (e.g. Apple Reminders list name)
  let detectedSlug = titleSlug;
  if (!detectedSlug && payload.listName) {
    const fromList = parseProjectPrefix(payload.listName + ": dummy");
    detectedSlug = fromList.slug;
  }

  // 3. Resolve to project_id
  let projectId = payload.projectId;
  if (!projectId && detectedSlug) {
    projectId = await resolveProjectId(userId, detectedSlug);
  }

  // 4. Format content
  const content = [
    `Reminder: ${cleanTitle}`,
    dueAt ? `Due: ${dueAt}` : null,
    body || null,
  ]
    .filter(Boolean)
    .join("\n");

  const enrichedTags = [...(tags ?? ["reminder"])];
  if (detectedSlug) enrichedTags.push(detectedSlug);

  return {
    content,
    detectedProject: detectedSlug,
    metadata: {
      userId,
      source: "task",
      projectId,
      category: "general",
      importance: dueAt ? 7 : 6,
      tags: enrichedTags,
    },
  };
}
