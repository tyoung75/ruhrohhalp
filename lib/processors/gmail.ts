/**
 * TYOS-281 — Gmail ingestion processor.
 *
 * - Detects key contacts and flags importance accordingly.
 * - Calls Claude to extract decisions + action items before embedding.
 */

import type { EmbedMetadata } from "@/lib/embedding/pipeline";
import { callClaude } from "@/lib/processors/claude";
import { logError } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Key contacts — emails from these people get elevated importance.
// ---------------------------------------------------------------------------

const KEY_CONTACTS: { name: string; patterns: string[] }[] = [
  { name: "Abby Dohrmann", patterns: ["abby", "dohrmann"] },
  { name: "Jill Saboe", patterns: ["jill", "saboe"] },
  { name: "Johnny", patterns: ["johnny"] },
  { name: "Brett", patterns: ["brett"] },
  { name: "Clarissa", patterns: ["clarissa"] },
];

function detectKeyContact(from: string): { isKey: boolean; name?: string } {
  const lower = from.toLowerCase();
  for (const contact of KEY_CONTACTS) {
    if (contact.patterns.some((p) => lower.includes(p))) {
      return { isKey: true, name: contact.name };
    }
  }
  return { isKey: false };
}

// ---------------------------------------------------------------------------
// Claude extraction prompt
// ---------------------------------------------------------------------------

const EXTRACT_SYSTEM = `You are an assistant that extracts structured information from emails for Tyler Young (founder of Motus, RuhrohHalp, Iron Passport, Caliber, thestayed).

From the email below, extract:
1. **Decisions** — any decisions mentioned or implied (who decided what).
2. **Action Items** — anything Tyler or others need to do, with deadlines if stated.
3. **Key Info** — any critical facts, numbers, dates, or commitments.

If a section has nothing, write "None." Be concise — bullet points only.
Return as plain text with the three headers above.`;

async function extractInsights(emailContent: string): Promise<string | null> {
  try {
    return await callClaude(EXTRACT_SYSTEM, emailContent, 512);
  } catch (error) {
    logError("processor.gmail.extract", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GmailPayload {
  userId: string;
  subject?: string;
  body: string;
  from?: string;
  threadId?: string;
  projectId?: string;
  tags?: string[];
}

export interface ProcessedGmail {
  content: string;
  metadata: Omit<EmbedMetadata, "userId"> & { userId: string };
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export async function process(payload: GmailPayload): Promise<ProcessedGmail> {
  const { userId, subject, body, from, threadId, projectId, tags } = payload;

  // Detect key contact
  const contact = from ? detectKeyContact(from) : { isKey: false };
  const importance = contact.isKey ? 8 : 5;

  // Format raw content
  const rawContent = [
    subject ? `Subject: ${subject}` : null,
    from ? `From: ${from}` : null,
    contact.isKey ? `[Key Contact: ${contact.name}]` : null,
    "",
    body,
  ]
    .filter((line) => line !== null)
    .join("\n");

  // Extract decisions and action items via Claude
  const insights = await extractInsights(rawContent);

  const content = insights
    ? `${rawContent}\n\n---\n\n**Extracted Insights:**\n${insights}`
    : rawContent;

  const enrichedTags = [...(tags ?? ["gmail"])];
  if (contact.isKey && contact.name) {
    enrichedTags.push(`contact:${contact.name.toLowerCase().replace(/\s+/g, "-")}`);
  }

  return {
    content,
    metadata: {
      userId,
      source: "manual",
      sourceId: threadId,
      projectId,
      category: "work",
      importance,
      tags: enrichedTags,
    },
  };
}
