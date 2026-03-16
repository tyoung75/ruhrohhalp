import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { embedAndStore } from "@/lib/embedding";
import { logError } from "@/lib/logger";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const SUMMARY_SYSTEM = `You are a meeting summarizer for Tyler Young, a founder running multiple ventures (Motus, RuhrohHalp, Iron Passport, Caliber, thestayed).

Produce a concise meeting summary with these sections:
- **Key Points** — bullet list of what was discussed
- **Decisions Made** — any commitments or choices
- **Action Items** — who owes what, with deadlines if mentioned
- **Follow-ups** — anything that needs revisiting

Keep it tight — no filler.`;

async function generateMeetingSummary(rawNotes: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY for meeting summary");

  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: SUMMARY_SYSTEM,
      messages: [{ role: "user", content: `Summarize this meeting:\n\n${rawNotes}` }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Claude summary call failed (${res.status})`);
  }

  return data.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
}

/**
 * POST /api/webhook/calendar
 *
 * Expected JSON body:
 * {
 *   userId: string,
 *   trigger: "post_meeting_summary" | "event_created" | "event_updated",
 *   title: string,
 *   description?: string,
 *   notes?: string,
 *   calendarEventId?: string,
 *   meetingAt?: string,
 *   durationMinutes?: number,
 *   location?: string,
 *   attendees?: string[],
 *   attendeeIds?: string[],
 *   actionItems?: string[],
 *   projectId?: string,
 *   tags?: string[]
 * }
 */
export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const payload = await request.json();
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
      attendeeIds,
      actionItems,
      projectId,
      tags,
    } = payload;

    if (!userId || !title) {
      return NextResponse.json({ error: "userId and title are required" }, { status: 400 });
    }

    let content = [title, description, notes].filter(Boolean).join("\n\n");
    let summary = "";

    // If this is a post-meeting summary trigger, generate a Claude summary first.
    if (trigger === "post_meeting_summary" && content.trim()) {
      summary = await generateMeetingSummary(content);
      // Prepend summary to content so it gets embedded too.
      content = `${summary}\n\n---\n\nRaw Notes:\n${content}`;
    }

    const result = await embedAndStore(content, {
      userId,
      source: "meeting",
      projectId,
      category: "work",
      importance: 6,
      tags: tags ?? ["calendar"],
      extra: {
        title,
        summary,
        calendarEventId,
        meetingAt,
        durationMinutes,
        location,
        actionItems: actionItems ?? [],
        attendeeIds: attendeeIds ?? [],
      },
    });

    return NextResponse.json({
      success: true,
      memoryIds: result.memoryIds,
      sourceIds: result.sourceIds,
      chunkCount: result.chunkCount,
      summary: summary || undefined,
    });
  } catch (error) {
    logError("webhook.calendar", error);
    return NextResponse.json({ error: "Failed to process calendar webhook" }, { status: 500 });
  }
}
