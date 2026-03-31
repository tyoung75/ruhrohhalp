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
  recentFeedback: { action: string; note: string; created_at: string }[];
  /** Recently completed tasks (last 7 days) — so the AI knows what's already done */
  recentlyCompleted: { title: string; updated_at: string }[];
  /** Recent emails and calendar events from memory store */
  recentActivity: { content: string; source: string; created_at: string }[];
  /** Aggregated feedback context: dismissals, replies, directives, done/skip actions */
  feedbackContext: {
    dismissedTexts: string[];
    alreadyDoneItems: string[];
    wontDoItems: string[];
    signalReplies: { signal_text: string; reply: string; scope: string }[];
    taskReplies: { task_id: string; reply: string }[];
  };
}

async function fetchDirectContext(userId: string): Promise<DirectContext> {
  const supabase = createAdminClient();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch open tasks (not done/cancelled), ordered by priority
  const [{ data: tasks }, { data: goals }, { data: completedTasks }, { data: recentMemories }] = await Promise.all([
    supabase
      .from("tasks")
      .select("title, description, priority_num, due_date, state")
      .eq("user_id", userId)
      .not("state", "in", '("done","cancelled")')
      .order("priority_num", { ascending: true, nullsFirst: false })
      .limit(15),
    // Active goals with pillar context
    supabase
      .from("goals")
      .select("title, description, progress_current, progress_target, target_date, pillars(name)")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(10),
    // Recently completed tasks (last 7 days) — critical for awareness
    supabase
      .from("tasks")
      .select("title, updated_at")
      .eq("user_id", userId)
      .eq("state", "done")
      .gte("updated_at", sevenDaysAgo)
      .order("updated_at", { ascending: false })
      .limit(20),
    // Recent emails and calendar memories (last 7 days)
    supabase
      .from("memories")
      .select("content, source, created_at")
      .eq("user_id", userId)
      .in("source", ["manual", "meeting", "email", "gmail", "calendar"])
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // Fetch recent leverage_tasks feedback (last 30 days, unapplied)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [feedbackRes, dismissalsRes, alreadyDoneRes, wontDoRes, signalRepliesRes, taskRepliesRes] = await Promise.all([
    supabase
      .from("feedback")
      .select("action, note, created_at")
      .eq("user_id", userId)
      .eq("section", "leverage_tasks")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),
    // Signal dismissals — items Tyler explicitly suppressed
    supabase
      .from("signal_dismissals")
      .select("original_text")
      .eq("user_id", userId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(50),
    // "Already done" feedback — things Tyler already completed
    supabase
      .from("feedback")
      .select("note")
      .eq("user_id", userId)
      .eq("action", "already_done")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(30),
    // "Won't do" feedback — things Tyler chose to skip
    supabase
      .from("feedback")
      .select("note")
      .eq("user_id", userId)
      .eq("action", "wont_do")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(30),
    // Signal replies (unapplied) — direct feedback on specific signals
    supabase
      .from("signal_replies")
      .select("signal_text, reply, scope")
      .eq("user_id", userId)
      .eq("applied", false)
      .order("created_at", { ascending: false })
      .limit(30),
    // Task replies (unapplied) — direct feedback on tasks
    supabase
      .from("task_replies")
      .select("task_id, reply")
      .eq("user_id", userId)
      .eq("applied", false)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const feedback = feedbackRes.data;

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
    recentFeedback: (feedback ?? []).map((f) => ({
      action: f.action,
      note: f.note,
      created_at: f.created_at,
    })),
    recentlyCompleted: (completedTasks ?? []).map((t) => ({
      title: t.title,
      updated_at: t.updated_at,
    })),
    recentActivity: (recentMemories ?? []).map((m) => ({
      content: typeof m.content === "string" ? m.content.slice(0, 200) : "",
      source: m.source,
      created_at: m.created_at,
    })),
    feedbackContext: {
      dismissedTexts: (dismissalsRes.data ?? []).map((d) => d.original_text),
      alreadyDoneItems: (alreadyDoneRes.data ?? []).map((d) => d.note),
      wontDoItems: (wontDoRes.data ?? []).map((d) => d.note),
      signalReplies: (signalRepliesRes.data ?? []).map((r) => ({
        signal_text: r.signal_text,
        reply: r.reply,
        scope: r.scope,
      })),
      taskReplies: (taskRepliesRes.data ?? []).map((r) => ({
        task_id: r.task_id,
        reply: r.reply,
      })),
    },
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

  if (ctx.recentlyCompleted.length > 0) {
    const completedLines = ctx.recentlyCompleted.map((t) => {
      const when = new Date(t.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `- ${t.title} (completed ${when})`;
    });
    parts.push(`## Recently Completed Tasks (last 7 days — DO NOT suggest these again)\n${completedLines.join("\n")}`);
  }

  if (ctx.recentActivity.length > 0) {
    const activityLines = ctx.recentActivity.map((a) => {
      const when = new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return `- [${a.source}] ${a.content} (${when})`;
    });
    parts.push(`## Recent Activity (emails, calendar, meetings)\n${activityLines.join("\n")}`);
  }

  if (ctx.recentFeedback.length > 0) {
    const thumbsUp = ctx.recentFeedback.filter((f) => f.action === "thumbs_up" || f.action === "helpful");
    const thumbsDown = ctx.recentFeedback.filter((f) => f.action === "thumbs_down" || f.action === "not_helpful");

    const feedbackLines: string[] = [];
    if (thumbsDown.length > 0) {
      feedbackLines.push("Tyler marked these as NOT high-leverage (avoid suggesting similar tasks):");
      thumbsDown.forEach((f) => feedbackLines.push(`  - ${f.note}`));
    }
    if (thumbsUp.length > 0) {
      feedbackLines.push("Tyler confirmed these as high-leverage (suggest more like these):");
      thumbsUp.forEach((f) => feedbackLines.push(`  - ${f.note}`));
    }
    parts.push(`## Recent Leverage Feedback\n${feedbackLines.join("\n")}`);
  }

  // === Comprehensive feedback context ===
  const fc = ctx.feedbackContext;

  if (fc.alreadyDoneItems.length > 0) {
    parts.push(
      `## ALREADY COMPLETED (DO NOT suggest these again — Tyler already did them)\n${fc.alreadyDoneItems.map((t) => `- ${t}`).join("\n")}`
    );
  }

  if (fc.wontDoItems.length > 0) {
    parts.push(
      `## WON'T DO (Tyler explicitly chose to skip these — do NOT resurface)\n${fc.wontDoItems.map((t) => `- ${t}`).join("\n")}`
    );
  }

  if (fc.dismissedTexts.length > 0) {
    parts.push(
      `## DISMISSED SIGNALS (suppress similar topics — Tyler doesn't want to see these)\n${fc.dismissedTexts.slice(0, 20).map((t) => `- "${t.slice(0, 80)}"`).join("\n")}`
    );
  }

  if (fc.signalReplies.length > 0) {
    const broad = fc.signalReplies.filter((r) => r.scope === "broad");
    const specific = fc.signalReplies.filter((r) => r.scope === "specific");

    if (broad.length > 0) {
      parts.push(
        `## BROAD DIRECTIVES FROM TYLER (apply across the entire briefing)\n${broad.map((r) => `- "${r.reply}"`).join("\n")}`
      );
    }
    if (specific.length > 0) {
      parts.push(
        `## SPECIFIC FEEDBACK ON SIGNALS (incorporate when covering similar topics)\n${specific.map((r) => `- On "${r.signal_text.slice(0, 60)}…": Tyler says "${r.reply}"`).join("\n")}`
      );
    }
  }

  if (fc.taskReplies.length > 0) {
    parts.push(
      `## TASK FEEDBACK FROM TYLER\n${fc.taskReplies.map((r) => `- Task ${r.task_id}: "${r.reply}"`).join("\n")}`
    );
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

CRITICAL RULES:
- If items appear under "ALREADY COMPLETED", "WON'T DO", or "DISMISSED SIGNALS" above, you MUST NOT include them or anything similar in the briefing. These represent Tyler's explicit feedback.
- If "BROAD DIRECTIVES" are provided, apply them across the entire briefing — they override default behavior.
- If "SPECIFIC FEEDBACK ON SIGNALS" is provided, incorporate Tyler's responses when covering similar topics.
- If "TASK FEEDBACK" is provided, reflect Tyler's notes in how you present those tasks.

Using the above data AND the retrieved memories, return a structured daily briefing with EXACTLY these four markdown sections. You MUST use ## headings exactly as shown. Each section MUST have at least one bullet point. Be specific — reference real items, people, deadlines, and context.

## Leverage Tasks
The top 3-5 highest-leverage tasks Tyler should tackle TODAY. Prioritize by urgency and impact. Include why each matters and any deadlines. Pull from the open tasks above. IMPORTANT: If "Recent Leverage Feedback" is provided, use it to calibrate — avoid suggesting tasks similar to ones Tyler marked as not high-leverage, and favor patterns matching tasks he confirmed as high-leverage.

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

/** Get current date in ET */
function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Get time-aware period based on ET hour */
function getCurrentPeriod(): "morning" | "evening" {
  const etHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
  );
  return etHour < 12 ? "morning" : "evening";
}

/** Persist briefing to the briefings table, upserting by date+period */
async function saveBriefing(userId: string, rawMd: string, contentJson: unknown, useAdmin = false) {
  const supabase = useAdmin ? createAdminClient() : await createClient();
  const today = getTodayET();
  const period = getCurrentPeriod();

  // Upsert — if a briefing already exists for today+period, update it
  const { data: existing } = await supabase
    .from("briefings")
    .select("id")
    .eq("user_id", userId)
    .eq("date", today)
    .eq("period", period)
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
        period,
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
