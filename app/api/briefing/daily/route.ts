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
  feedbackContext: {
    dismissedSignals: string[];
    alreadyDone: string[];
    wontDo: string[];
    signalReplies: { signal_text: string; reply: string; scope: string; created_at: string }[];
    taskReplies: { task_title: string; reply: string; created_at: string }[];
  };
  recentlyCompleted: { title: string; completed_at: string }[];
  recentActivity: { content: string; created_at: string }[];
  // Cross-section awareness: what other sections are already showing
  todaysFocusTasks: string[];
  activeStrategyInsights: string[];
  contentDirectives: string[];
}

async function fetchDirectContext(userId: string): Promise<DirectContext> {
  const supabase = createAdminClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Run all queries in parallel for performance
  const [
    tasksResult,
    goalsResult,
    feedbackResult,
    dismissalsResult,
    alreadyDoneResult,
    wontDoResult,
    signalRepliesResult,
    taskRepliesResult,
    completedTasksResult,
    recentMemoriesResult,
    // Cross-section awareness queries
    topRankedTasksResult,
    strategyInsightsResult,
    contentDirectivesResult,
  ] = await Promise.all([
    // Open tasks (not done/cancelled), ordered by priority
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

    // Recent leverage_tasks feedback (last 30 days)
    supabase
      .from("feedback")
      .select("action, note, created_at")
      .eq("user_id", userId)
      .eq("section", "leverage_tasks")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),

    // Dismissed signals — items Tyler never wants to see again
    supabase
      .from("signal_dismissals")
      .select("original_text")
      .eq("user_id", userId)
      .limit(50),

    // Feedback marked "already_done" via signal replies
    supabase
      .from("signal_replies")
      .select("signal_text, reply, created_at")
      .eq("user_id", userId)
      .ilike("reply", "%ALREADY DONE%")
      .gte("created_at", thirtyDaysAgo)
      .limit(30),

    // Feedback marked "wont_do" via signal replies
    supabase
      .from("signal_replies")
      .select("signal_text, reply, created_at")
      .eq("user_id", userId)
      .ilike("reply", "%WON'T DO%")
      .gte("created_at", thirtyDaysAgo)
      .limit(30),

    // All signal replies (for specific/broad directives)
    supabase
      .from("signal_replies")
      .select("signal_text, reply, scope, created_at")
      .eq("user_id", userId)
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(40),

    // Task-specific replies
    supabase
      .from("task_replies")
      .select("reply, created_at, tasks(title)")
      .eq("user_id", userId)
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),

    // Recently completed tasks (last 7 days) — so briefing knows what's done
    supabase
      .from("tasks")
      .select("title, updated_at")
      .eq("user_id", userId)
      .eq("state", "done")
      .gte("updated_at", sevenDaysAgo)
      .order("updated_at", { ascending: false })
      .limit(15),

    // Recent ingested memories (emails, calendar, etc.) for activity awareness
    supabase
      .from("memories")
      .select("content, created_at")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(10),

    // Cross-section: Top ranked tasks (same as Today's Focus shows) — so briefing won't repeat them
    supabase
      .from("tasks")
      .select("title")
      .eq("user_id", userId)
      .not("state", "in", '("done","cancelled")')
      .order("priority_num", { ascending: true, nullsFirst: false })
      .limit(5),

    // Cross-section: Active strategy insights — so briefing won't repeat content strategy
    supabase
      .from("strategy_insights")
      .select("content")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(10),

    // Cross-section: Active content directives — so briefing knows what strategy is already steering
    supabase
      .from("content_directives")
      .select("directive")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(10),
  ]);

  return {
    openTasks: (tasksResult.data ?? []).map((t) => ({
      title: t.title,
      description: t.description,
      priority_num: t.priority_num,
      due_date: t.due_date,
      state: t.state,
    })),
    activeGoals: (goalsResult.data ?? []).map((g) => ({
      title: g.title,
      description: g.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pillar_name: (g as any).pillars?.name ?? null,
      progress_current: g.progress_current,
      progress_target: g.progress_target,
      target_date: g.target_date,
    })),
    recentFeedback: (feedbackResult.data ?? []).map((f) => ({
      action: f.action,
      note: f.note,
      created_at: f.created_at,
    })),
    feedbackContext: {
      dismissedSignals: (dismissalsResult.data ?? []).map((d) => d.original_text).filter(Boolean),
      alreadyDone: (alreadyDoneResult.data ?? []).map((d) => d.signal_text).filter(Boolean),
      wontDo: (wontDoResult.data ?? []).map((d) => d.signal_text).filter(Boolean),
      signalReplies: (signalRepliesResult.data ?? []).map((r) => ({
        signal_text: r.signal_text,
        reply: r.reply,
        scope: r.scope,
        created_at: r.created_at,
      })),
      taskReplies: (taskRepliesResult.data ?? []).map((r) => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        task_title: (r as any).tasks?.title ?? "Unknown task",
        reply: r.reply,
        created_at: r.created_at,
      })),
    },
    recentlyCompleted: (completedTasksResult.data ?? []).map((t) => ({
      title: t.title,
      completed_at: t.updated_at,
    })),
    recentActivity: (recentMemoriesResult.data ?? []).map((m) => ({
      content: typeof m.content === "string" ? m.content.slice(0, 200) : JSON.stringify(m.content).slice(0, 200),
      created_at: m.created_at,
    })),
    // Cross-section awareness
    todaysFocusTasks: (topRankedTasksResult.data ?? []).map((t) => t.title),
    activeStrategyInsights: (strategyInsightsResult.data ?? []).map((i) => i.content),
    contentDirectives: (contentDirectivesResult.data ?? []).map((d) => d.directive),
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

  if (ctx.recentFeedback.length > 0) {
    const thumbsUp = ctx.recentFeedback.filter((f) => f.action === "thumbs_up");
    const thumbsDown = ctx.recentFeedback.filter((f) => f.action === "thumbs_down");

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

  // ---- NEW: Feedback context from inline controls ----

  const fc = ctx.feedbackContext;

  // Already completed items — NEVER suggest these again
  if (fc.alreadyDone.length > 0) {
    parts.push(`## ALREADY COMPLETED (do NOT suggest these)\n${fc.alreadyDone.map((t) => `- ${t}`).join("\n")}`);
  }

  // Won't do items — Tyler explicitly declined these
  if (fc.wontDo.length > 0) {
    parts.push(`## WON'T DO (Tyler declined — do NOT suggest these)\n${fc.wontDo.map((t) => `- ${t}`).join("\n")}`);
  }

  // Dismissed signals — permanently hidden
  if (fc.dismissedSignals.length > 0) {
    parts.push(`## DISMISSED SIGNALS (never show again)\n${fc.dismissedSignals.map((t) => `- ${t}`).join("\n")}`);
  }

  // Signal replies — broad directives and specific feedback
  const broadDirectives = fc.signalReplies.filter((r) => r.scope === "broad" && !r.reply.includes("ALREADY DONE") && !r.reply.includes("WON'T DO"));
  const specificFeedback = fc.signalReplies.filter((r) => r.scope === "specific" && !r.reply.includes("ALREADY DONE") && !r.reply.includes("WON'T DO"));

  if (broadDirectives.length > 0) {
    parts.push(`## BROAD DIRECTIVES FROM TYLER (apply to all future briefings)\n${broadDirectives.map((r) => `- "${r.reply}"`).join("\n")}`);
  }

  if (specificFeedback.length > 0) {
    parts.push(`## SPECIFIC FEEDBACK ON SIGNALS\n${specificFeedback.map((r) => `- Re: "${r.signal_text}" → Tyler said: "${r.reply}"`).join("\n")}`);
  }

  // Task replies — direct feedback on specific tasks
  if (fc.taskReplies.length > 0) {
    parts.push(`## TASK FEEDBACK\n${fc.taskReplies.map((r) => `- Re: "${r.task_title}" → Tyler said: "${r.reply}"`).join("\n")}`);
  }

  // Recently completed tasks — for awareness, not re-suggestion
  if (ctx.recentlyCompleted.length > 0) {
    parts.push(`## Recently Completed Tasks (last 7 days)\n${ctx.recentlyCompleted.map((t) => `- ${t.title} (completed ${t.completed_at.slice(0, 10)})`).join("\n")}`);
  }

  // Recent activity from ingested memories
  if (ctx.recentActivity.length > 0) {
    parts.push(`## Recent Activity (emails, calendar, etc.)\n${ctx.recentActivity.map((a) => `- ${a.content}`).join("\n")}`);
  }

  // Cross-section awareness — what other parts of the OS are already showing
  if (ctx.todaysFocusTasks.length > 0) {
    parts.push(`## ALREADY SHOWN IN TODAY'S FOCUS (do NOT repeat these as leverage tasks)\n${ctx.todaysFocusTasks.map((t) => `- ${t}`).join("\n")}`);
  }

  if (ctx.activeStrategyInsights.length > 0) {
    parts.push(`## ACTIVE STRATEGY INSIGHTS (do NOT repeat these — they're in the Strategy tab)\n${ctx.activeStrategyInsights.map((i) => `- ${i}`).join("\n")}`);
  }

  if (ctx.contentDirectives.length > 0) {
    parts.push(`## ACTIVE CONTENT DIRECTIVES (strategy is already applying these)\n${ctx.contentDirectives.map((d) => `- ${d}`).join("\n")}`);
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

CRITICAL RULES — MUST FOLLOW:
1. NEVER suggest items listed under "ALREADY COMPLETED" — Tyler already finished these.
2. NEVER suggest items listed under "WON'T DO" — Tyler explicitly declined these.
3. NEVER include items listed under "DISMISSED SIGNALS" — they are permanently hidden.
4. APPLY all "BROAD DIRECTIVES FROM TYLER" — these are standing instructions that shape every briefing.
5. RESPECT "SPECIFIC FEEDBACK ON SIGNALS" — adjust your recommendations based on Tyler's replies.
6. RESPECT "TASK FEEDBACK" — incorporate Tyler's notes on specific tasks into your prioritization.
7. Reference "Recently Completed Tasks" for awareness (what momentum looks like) but do NOT re-suggest them.
8. Use "Recent Activity" for context on what Tyler has been doing lately.
9. NEVER repeat items listed under "ALREADY SHOWN IN TODAY'S FOCUS" — these are displayed in the Today's Focus panel. The briefing should add NEW value, not echo what's already visible.
10. NEVER repeat items listed under "ACTIVE STRATEGY INSIGHTS" — these are displayed in the Strategy tab. If you have a related but distinct insight, make the distinction explicit.
11. NEVER repeat "ACTIVE CONTENT DIRECTIVES" — these are already steering the content strategy agent.

IMPORTANT: This briefing exists alongside other panels in the OS. Today's Focus shows Tyler's top tasks. The Strategy tab shows content recommendations. The Signals panel shows real-time alerts. This briefing must add INCREMENTAL VALUE — focus on decisions that need Tyler's judgment, upcoming deadlines he might miss, and cross-venture connections that no other panel surfaces.

Using the above data AND the retrieved memories, return a structured daily briefing with EXACTLY these four markdown sections. You MUST use ## headings exactly as shown. Each section MUST have at least one bullet point. Be specific — reference real items, people, deadlines, and context.

## Leverage Tasks
The top 3-5 highest-leverage tasks Tyler should tackle TODAY that are NOT already shown in Today's Focus. If Today's Focus already covers the most important tasks, surface DIFFERENT high-leverage items — tasks that are important but might be overlooked, blocked items that need unblocking, or cross-venture dependencies. Do NOT simply rephrase the same tasks.

## Open Decisions
Decisions pending Tyler's input. Include context on what's blocking each decision and who is waiting. If none are clear from context, surface the most ambiguous open items that need Tyler's judgment call. This is the briefing's unique value — no other panel surfaces pending decisions.

## Upcoming
Calendar events, deadlines, and time-sensitive items for today and the next 48 hours. Include any due dates from the tasks above. If no calendar data is available, list the nearest deadlines from goals and tasks.

## Insights
Cross-venture patterns, risks, or opportunities that NO OTHER panel surfaces. Do NOT repeat strategy insights already shown in the Strategy tab. Focus on: connections between ventures, risks falling through cracks, goal health trends, and time-sensitive opportunities that require Tyler's attention today.`;
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
    // 1. Fetch direct context from DB (tasks + goals + feedback + activity)
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
