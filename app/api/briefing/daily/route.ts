import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { queryBrain } from "@/lib/query";
import { logError } from "@/lib/logger";

function buildDailyPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are generating Tyler Young's daily briefing. Review all stored memories, tasks, calendar events, emails, and project context across every venture (Motus, RuhrohHalp, Iron Passport, Caliber, thestayed).

Today's date: ${today}

Return a structured daily briefing with exactly these four sections. Be specific — reference real items, people, deadlines, and context from the memories.

## Leverage Tasks
The top 3-5 highest-leverage tasks Tyler should tackle TODAY. Prioritize by urgency and impact. Include why each matters and any deadlines.

## Open Decisions
Decisions pending Tyler's input. Include context on what's blocking each decision and who is waiting.

## Upcoming
Calendar events, deadlines, and time-sensitive items for today and the next 48 hours. Include meeting prep notes if relevant context exists.

## Insights
Patterns, risks, or opportunities Tyler should be aware of. Surface anything that connects across ventures or that might be falling through the cracks.`;
}

export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const body = await request.json();
    const userId = body.userId;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const result = await queryBrain(buildDailyPrompt(), {
      userId,
      topK: 12,
      threshold: 0.55,
    });

    const sections = parseDailySections(result.answer);

    return NextResponse.json({
      ...sections,
      sources: result.sources,
      raw: result.answer,
    });
  } catch (error) {
    logError("briefing.daily", error);
    return NextResponse.json({ error: "Daily briefing failed" }, { status: 500 });
  }
}

function parseDailySections(answer: string) {
  return {
    leverage_tasks: extractSection(answer, "Leverage Tasks"),
    open_decisions: extractSection(answer, "Open Decisions"),
    upcoming: extractSection(answer, "Upcoming"),
    insights: extractSection(answer, "Insights"),
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
