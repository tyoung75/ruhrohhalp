import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { requireUser } from "@/lib/auth";
import { queryBrain } from "@/lib/query";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Direct DB context — supplement RAG with real task/goal/calendar data
// ---------------------------------------------------------------------------

interface DirectContext {
  openTasks: { title: string; description: string | null; priority_num: number | null; due_date: string | null; state: string | null }[];
  activeGoals: { title: string; description: string | null; pillar_name: string | null; progress_current: string | null; progress_target: string | null; target_date: string | null }[];
}

async function fetchDirectContext(userId: string): Promise<DirectContext> {
  const supabase = createAdminClient();

  // Fetch open tasks (not done/cancelled), ordered by priority
  const { data: tasks } = await supabase
    .from("tasks")
    .select("title, description, priority_num, due_date, state")
    .eq("user_id", userId)
    .not("state", "in", '("done","cancelled")')
    .order("priority_num", { ascending: true, nullsFirst: false })
    .limit(15);

  // Fetch active goals with pillar context
  const { data: goals } = await supabase
    .from("goals")
    .select("title, description, progress_current, progress_target, target_date, pillars(name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(10);

  return {
    openTasks: (tasks ?? []).map((t) => ({
      title: t.title,
      description: t.description,
      priority_num: t.priority_num,
      due_date: t.due_date,
      state: t.state,
    })),
    activeGoals: (goals ?? []).map((g) => ({
      title: g.title,
      description: g.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pillar_name: (g as any).pillars?.name ?? null,
      progress_current: g.progress_current,
      progress_target: g.progress_target,
      target_date: g.target_date,
    })),
  };
}

function formatDirectContext(ctx: DirectContext): string {
  const parts: string[] = [];

  if (ctx.openTasks.length > 0) {
    const taskLines = ctx.openTasks.map((t) => {
      const meta = [
        t.priority_num ? `P${t.priority_num}` : null,
        t.state ?? null,
        t.due_date ? `due ${t.due_date}` : null,
      ].filter(Boolean).join(", ");
      return `- ${t.title}${meta ? ` (${meta})` : ""}${t.description ? `: ${t.description.slice(0, 120)}` : ""}`;
    });
    parts.push(`## Current Open Tasks (${ctx.openTasks.length} total)\n${taskLines.join("\n")}`);
  }

  if (ctx.activeGoals.length > 0) {
    const goalLines = ctx.activeGoals.map((g) => {
      const meta = [
        g.pillar_name ?? null,
        g.progress_current && g.progress_target ? `${g.progress_current} → ${g.progress_target}` : null,
        g.target_date ? `target ${g.target_date}` : null,
      ].filter(Boolean).join(", ");
      return `- ${g.title}${meta ? ` (${meta})` : ""}`;
    });
    parts.push(`## Active Goals (${ctx.activeGoals.length} total)\n${goalLines.join("\n")}`);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildDailyPrompt(directContext: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are generating Tyler Young's daily briefing. Review all stored memories, tasks, calendar events, emails, and project context across every venture (Motus, RuhrohHalp, Iron Passport, Caliber, thestayed).

Today's date: ${today}

Here is Tyler's current task and goal state pulled directly from the database:

${directContext || "(No open tasks or active goals found in database.)"}

Using the above data AND the retrieved memories, return a structured daily briefing with EXACTLY these four markdown sections. You MUST use ## headings exactly as shown. Each section MUST have at least one bullet point. Be specific — reference real items, people, deadlines, and context.

## Leverage Tasks
The top 3-5 highest-leverage tasks Tyler should tackle TODAY. Prioritize by urgency and impact. Include why each matters and any deadlines. Pull from the open tasks above.

## Open Decisions
Decisions pending Tyler's input. Include context on what's blocking each decision and who is waiting. If none are clear from context, surface the most ambiguous open items that need Tyler's judgment call.

## Upcoming
Calendar events, deadlines, and time-sensitive items for today and the next 48 hours. Include any due dates from the tasks above. If no calendar data is available, list the nearest deadlines from goals and tasks.

## Insights
Patterns, risks, or opportunities Tyler should be aware of. Surface anything that connects across ventures or that might be falling through the cracks. At minimum, note the health of active goals.`;
}

// ---------------------------------------------------------------------------
// Section parsing — robust extraction handling varied AI output formats
// ---------------------------------------------------------------------------

function parseDailySections(answer: string) {
  return {
    leverage_tasks: extractSection(answer, "Leverage Tasks"),
    open_decisions: extractSection(answer, "Open Decisions"),
    upcoming: extractSection(answer, "Upcoming"),
    insights: extractSection(answer, "Insights"),
  };
}

function extractSection(text: string, heading: string): string[] {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Try multiple heading formats in priority order:
  // 1. ## Heading (standard)
  // 2. ### Heading (h3)
  // 3. **Heading** (bold)
  // 4. Heading: (colon-terminated)
  const patterns = [
    new RegExp(`#{2,3}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s|$)`, "i"),
    new RegExp(`\\*\\*\\s*${escaped}\\s*\\*\\*\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*\\s|\\n#{2,3}\\s|$)`, "i"),
    new RegExp(`${escaped}\\s*:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z][a-z]+ [A-Z]|\\n#{2,3}\\s|\\n\\*\\*|$)`, "i"),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const lines = match[1]
        .split("\n")
        .map((line) => line.replace(/^[\s]*(?:[-*•]|\d+[.)]\s)\s*/, "").trim())
        .filter((line) => line.length > 0 && !line.startsWith("---"));

      if (lines.length > 0) return lines;
    }
  }

  return [];
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
async function saveBriefing(userId: string, rawMd: string, contentJson: unknown, useAdmin = false) {
  const supabase = useAdmin ? createAdminClient() : await createClient();
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

    if (error) {
      logError("briefing.save.update", error);
      console.error("[briefing.save.update]", JSON.stringify(error));
    }
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

    if (error) {
      logError("briefing.save.insert", error);
      console.error("[briefing.save.insert]", JSON.stringify(error));
    }
    return data;
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// GET — browser-initiated briefing generation (user-authed)
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    // 1. Fetch direct context from DB (tasks + goals)
    const directCtx = await fetchDirectContext(user.id);
    const directContextStr = formatDirectContext(directCtx);

    // 2. RAG query with enriched prompt
    const result = await queryBrain(buildDailyPrompt(directContextStr), {
      userId: user.id,
      topK: 12,
      threshold: 0.55,
    });

    // 3. Parse sections from AI response
    const sections = parseDailySections(result.answer);
    const contentJson = sectionsToContentJson(sections);

    // 4. Persist to DB so it survives page reloads
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
    console.error("[briefing.daily.get]", error);
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

    // 1. Fetch direct context from DB
    const directCtx = await fetchDirectContext(userId);
    const directContextStr = formatDirectContext(directCtx);

    // 2. RAG query with enriched prompt
    const result = await queryBrain(buildDailyPrompt(directContextStr), {
      userId,
      topK: 12,
      threshold: 0.55,
    });

    // 3. Parse + persist
    const sections = parseDailySections(result.answer);
    const contentJson = sectionsToContentJson(sections);
    // Persist to DB (admin client — no user session in webhook context)
    const saved = await saveBriefing(userId, result.answer, contentJson, true);

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
    console.error("[briefing.daily.post]", error);
    return NextResponse.json({ error: "Daily briefing failed" }, { status: 500 });
  }
}
