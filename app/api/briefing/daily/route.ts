import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { requireUser } from "@/lib/auth";
import { queryBrain } from "@/lib/query";
import { createClient } from "@/lib/supabase/server";
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

/** Convert parsed sections into the BriefingSection[] format the UI expects */
function sectionsToContentJson(sections: ReturnType<typeof parseDailySections>) {
  const sectionDefs = [
    { key: "leverage_tasks", title: "Leverage Tasks", icon: "⚡", color: "#F59E0B" },
    { key: "open_decisions", title: "Open Decisions", icon: "◈", color: "#8B5CF6" },
    { key: "upcoming", title: "Upcoming", icon: "📅", color: "#3B82F6" },
    { key: "insights", title: "Insights", icon: "💡", color: "#10B981" },
  ] as const;

  return sectionDefs.map((def) => ({
    title: def.title,
    icon: def.icon,
    color: def.color,
    items: (sections[def.key] ?? []).map((text: string, i: number) => ({
      id: `${def.key}-${i}`,
      text,
      type: def.key === "leverage_tasks" ? "triage" : def.key === "insights" ? "recommendation" : undefined,
    })),
  }));
}

/** Persist briefing to the briefings table, upserting by date+period */
async function saveBriefing(userId: string, rawMd: string, contentJson: unknown) {
  const supabase = await createClient();
  const today = new Date().toISOString().split("T")[0];

  // Upsert — if a briefing already exists for today, update it
  const { data: existing } = await supabase
    .from("briefings")
    .select("id")
    .eq("user_id", userId)
    .eq("date", today)
    .eq("period", "daily")
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("briefings")
      .update({
        content_md: rawMd,
        content_json: contentJson,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) logError("briefing.save.update", error);
    return data;
  } else {
    const { data, error } = await supabase
      .from("briefings")
      .insert({
        user_id: userId,
        content_md: rawMd,
        content_json: contentJson,
        date: today,
        period: "daily",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) logError("briefing.save.insert", error);
    return data;
  }
}

// GET — browser-initiated briefing generation (user-authed)
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    const result = await queryBrain(buildDailyPrompt(), {
      userId: user.id,
      topK: 12,
      threshold: 0.55,
    });

    const sections = parseDailySections(result.answer);
    const contentJson = sectionsToContentJson(sections);

    // Persist to DB so it survives page reloads
    const saved = await saveBriefing(user.id, result.answer, contentJson);

    return NextResponse.json({
      briefing: saved ?? {
        content_json: contentJson,
        content_md: result.answer,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      sources: result.sources,
    });
  } catch (error) {
    logError("briefing.daily.get", error);
    return NextResponse.json({ error: "Daily briefing failed" }, { status: 500 });
  }
}

// POST — webhook-initiated briefing generation (webhook secret auth)
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
    const contentJson = sectionsToContentJson(sections);

    // Persist to DB
    const saved = await saveBriefing(userId, result.answer, contentJson);

    return NextResponse.json({
      briefing: saved ?? {
        content_json: contentJson,
        content_md: result.answer,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      sources: result.sources,
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
