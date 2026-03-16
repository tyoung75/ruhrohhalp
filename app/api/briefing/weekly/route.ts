import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { queryBrain } from "@/lib/query";
import { logError } from "@/lib/logger";

const WEEKLY_PROMPT = `You are generating Tyler Young's weekly CEO synthesis. Review the past 7 days of stored memories, tasks, decisions, meetings, emails, and project context across every venture (Motus, RuhrohHalp, Iron Passport, Caliber, thestayed).

Return a structured weekly synthesis with exactly these four sections. Be specific — reference real items, people, outcomes, and data from the memories. Think like a chief of staff summarizing the week for a CEO.

## Project Progress
For each active venture, summarize what moved forward this week. Include key milestones hit, deliverables completed, and measurable progress. Flag any venture that had no meaningful progress.

## Top Blockers
The most critical blockers across all ventures. Include what's blocked, who or what is blocking it, how long it's been stuck, and suggested next steps to unblock.

## Patterns Noticed
Cross-venture patterns, recurring themes, or strategic observations from the week. Surface connections Tyler might miss — e.g., the same person blocking two ventures, a theme appearing in multiple meetings, resource conflicts, or momentum shifts.

## Suggested Focus
Based on everything from this week, recommend Tyler's top 3 priorities for next week. Explain the reasoning — why these over other options, what's at stake, and what happens if they're delayed.`;

export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const body = await request.json();
    const userId = body.userId;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const result = await queryBrain(WEEKLY_PROMPT, {
      userId,
      topK: 20,
      threshold: 0.50,
    });

    const sections = parseWeeklySections(result.answer);

    return NextResponse.json({
      ...sections,
      sources: result.sources,
      raw: result.answer,
    });
  } catch (error) {
    logError("briefing.weekly", error);
    return NextResponse.json({ error: "Weekly synthesis failed" }, { status: 500 });
  }
}

function parseWeeklySections(answer: string) {
  return {
    project_progress: extractSection(answer, "Project Progress"),
    top_blockers: extractSection(answer, "Top Blockers"),
    patterns_noticed: extractSection(answer, "Patterns Noticed"),
    suggested_focus: extractSection(answer, "Suggested Focus"),
  };
}

function extractSection(text: string, heading: string): string[] {
  const pattern = new RegExp(
    `##\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  const match = text.match(pattern);
  if (!match) return [];

  return match[1]
    .split("\n")
    .map((line) => line.replace(/^[\s]*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}
