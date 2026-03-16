/**
 * TYOS-281 — Calendar ingestion processor.
 *
 * - Parses attendees and detects meeting type (1:1, group, external).
 * - Generates post-meeting summary via Claude when triggered.
 * - Returns enriched content + metadata for embedAndStore.
 */

import type { EmbedMetadata } from "@/lib/embedding/pipeline";
import { callClaude } from "@/lib/processors/claude";

// ---------------------------------------------------------------------------
// Meeting type detection
// ---------------------------------------------------------------------------

export type MeetingType = "one_on_one" | "group" | "external" | "solo";

/** Tyler's known email domains — used to detect external attendees. */
const INTERNAL_DOMAINS = ["motus", "ruhrohhalp", "thestayed", "caliber", "ironpassport"];

function isInternalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return INTERNAL_DOMAINS.some((d) => domain.includes(d));
}

export function detectMeetingType(attendees: string[]): MeetingType {
  if (attendees.length === 0) return "solo";
  if (attendees.length === 1) return "one_on_one";

  const hasExternal = attendees.some((a) => !isInternalEmail(a));
  return hasExternal ? "external" : "group";
}

// ---------------------------------------------------------------------------
// Claude summary
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM = `You are a meeting summarizer for Tyler Young, a founder running multiple ventures (Motus, RuhrohHalp, Iron Passport, Caliber, thestayed).

Produce a concise meeting summary with these sections:
- **Key Points** — bullet list of what was discussed
- **Decisions Made** — any commitments or choices
- **Action Items** — who owes what, with deadlines if mentioned
- **Follow-ups** — anything that needs revisiting

Keep it tight — no filler.`;

export async function generateSummary(rawNotes: string, meetingType: MeetingType, attendees: string[]): Promise<string> {
  const context = [
    `Meeting type: ${meetingType}`,
    attendees.length > 0 ? `Attendees: ${attendees.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return callClaude(SUMMARY_SYSTEM, `${context}\n\nMeeting content:\n\n${rawNotes}`);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CalendarPayload {
  userId: string;
  trigger?: "post_meeting_summary" | "event_created" | "event_updated";
  title: string;
  description?: string;
  notes?: string;
  calendarEventId?: string;
  meetingAt?: string;
  durationMinutes?: number;
  location?: string;
  attendees?: string[];
  attendeeIds?: string[];
  actionItems?: string[];
  projectId?: string;
  tags?: string[];
}

export interface ProcessedCalendar {
  content: string;
  metadata: Omit<EmbedMetadata, "userId"> & { userId: string };
  summary: string;
  meetingType: MeetingType;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export async function process(payload: CalendarPayload): Promise<ProcessedCalendar> {
  const {
    userId,
    trigger,
    title,
    description,
    notes,
    calendarEventId,
    meetingAt,
    durationMinutes,
    location,
    attendees = [],
    attendeeIds = [],
    actionItems = [],
    projectId,
    tags,
  } = payload;

  const meetingType = detectMeetingType(attendees);

  let rawContent = [title, description, notes].filter(Boolean).join("\n\n");
  let summary = "";

  // Generate Claude summary for post-meeting trigger
  if (trigger === "post_meeting_summary" && rawContent.trim()) {
    summary = await generateSummary(rawContent, meetingType, attendees);
    rawContent = `${summary}\n\n---\n\nRaw Notes:\n${rawContent}`;
  }

  // Prepend meeting metadata header
  const metaHeader = [
    `Meeting: ${title}`,
    `Type: ${meetingType}`,
    attendees.length > 0 ? `Attendees: ${attendees.join(", ")}` : null,
    location ? `Location: ${location}` : null,
    meetingAt ? `Date: ${meetingAt}` : null,
    durationMinutes ? `Duration: ${durationMinutes}min` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const content = `${metaHeader}\n\n${rawContent}`;

  const importance = meetingType === "external" ? 7 : meetingType === "one_on_one" ? 6 : 5;

  return {
    content,
    summary,
    meetingType,
    metadata: {
      userId,
      source: "meeting",
      projectId,
      category: "work",
      importance,
      tags: tags ?? ["calendar", meetingType],
      extra: {
        title,
        summary,
        calendarEventId,
        meetingAt,
        durationMinutes,
        location,
        actionItems,
        attendeeIds,
      },
    },
  };
}
