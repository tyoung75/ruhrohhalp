/**
 * /api/cron/briefing — Daily Briefing + Weekly Synthesis
 *
 * Handles the AI-heavy briefing work:
 *  - Daily trend detection
 *  - Daily briefing generation via RAG + Claude
 *  - Weekly CEO synthesis (Monday morning only)
 *
 * Split from unified /api/cron to stay within Vercel Hobby 60s limit.
 */

import { NextRequest, NextResponse } from "next/server";
import { queryBrain } from "@/lib/query";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { getCurrentStrategy, generateStrategy, detectTrends } from "@/lib/creator/strategy";
import { callClaude } from "@/lib/processors/claude";

export const maxDuration = 60;

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

// ---------------------------------------------------------------------------
// Timezone helpers — all briefing dates should be in ET (America/New_York)
// ---------------------------------------------------------------------------

/** Get current date string in ET (handles EDT/EST automatically) */
function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Determine if this is a morning or evening cron run based on ET hour */
function getBriefingPeriod(): "morning" | "evening" {
  const etHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
  );
  // Morning cron runs at ~6 AM ET, evening at ~8 PM ET
  return etHour < 12 ? "morning" : "evening";
}

// ---------------------------------------------------------------------------
// Direct DB context — supplement RAG with real task/goal/brain-dump data
// ---------------------------------------------------------------------------

interface DirectContext {
  openTasks: { title: string; description: string | null; priority_num: number | null; due_date: string | null; state: string | null }[];
  activeGoals: { title: string; description: string | null; pillar_name: string | null; progress_current: string | null; progress_target: string | null; target_date: string | null }[];
  recentFeedback: { action: string; note: string; created_at: string }[];
  brainDump: { goals: string | null; weekly_context: string | null; top_of_mind: string | null } | null;
}


interface BrandContext {
  activeDeals: number;
  estimatedLow: number;
  estimatedHigh: number;
  closedRevenue: number;
  newReplies: string[];
  dueToday: string[];
}

async function fetchBrandContext(userId: string): Promise<BrandContext> {
  const supabase = createAdminClient();
  const today = getTodayET();
  const [activeRes, repliesRes, dueRes] = await Promise.all([
    supabase.from("brand_deals").select("status, estimated_value_low, estimated_value_high, actual_value").eq("user_id", userId).neq("status", "archived"),
    supabase.from("brand_deals").select("brand_name").eq("user_id", userId).eq("status", "replied").gte("last_reply_date", new Date(Date.now() - 86400000).toISOString()),
    supabase.from("brand_deals").select("brand_name").eq("user_id", userId).eq("next_action_date", today),
  ]);

  const deals = activeRes.data ?? [];
  return {
    activeDeals: deals.filter((d) => d.status !== "closed_lost").length,
    estimatedLow: deals.reduce((sum, d) => sum + (d.estimated_value_low ?? 0), 0),
    estimatedHigh: deals.reduce((sum, d) => sum + (d.estimated_value_high ?? 0), 0),
    closedRevenue: deals.reduce((sum, d) => sum + (d.actual_value ?? 0), 0),
    newReplies: (repliesRes.data ?? []).map((d) => d.brand_name),
    dueToday: (dueRes.data ?? []).map((d) => d.brand_name),
  };
}

async function fetchDirectContext(userId: string): Promise<DirectContext> {
  const supabase = createAdminClient();

  const [tasksRes, goalsRes, feedbackRes, brainDumpRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("title, description, priority_num, due_date, state")
      .eq("user_id", userId)
      .not("state", "in", '("done","cancelled")')
      .order("priority_num", { ascending: true, nullsFirst: false })
      .limit(15),
    supabase
      .from("goals")
      .select("title, description, progress_current, progress_target, target_date, pillars(name)")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(10),
    supabase
      .from("feedback")
      .select("action, note, created_at")
      .eq("user_id", userId)
      .eq("section", "leverage_tasks")
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("brain_dumps")
      .select("goals, weekly_context, top_of_mind")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    openTasks: (tasksRes.data ?? []).map((t) => ({
      title: t.title,
      description: t.description,
      priority_num: t.priority_num,
      due_date: t.due_date,
      state: t.state,
    })),
    activeGoals: (goalsRes.data ?? []).map((g) => ({
      title: g.title,
      description: g.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pillar_name: (g as any).pillars?.name ?? null,
      progress_current: g.progress_current,
      progress_target: g.progress_target,
      target_date: g.target_date,
    })),
    recentFeedback: (feedbackRes.data ?? []).map((f) => ({
      action: f.action,
      note: f.note,
      created_at: f.created_at,
    })),
    brainDump: brainDumpRes.data ?? null,
  };
}

function formatDirectContext(ctx: DirectContext, brandCtx?: BrandContext): string {
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

  if (ctx.brainDump) {
    const dumpLines: string[] = [];
    if (ctx.brainDump.top_of_mind) {
      dumpLines.push(`Top of mind: ${ctx.brainDump.top_of_mind}`);
    }
    if (ctx.brainDump.weekly_context) {
      dumpLines.push(`This week: ${ctx.brainDump.weekly_context}`);
    }
    if (ctx.brainDump.goals) {
      try {
        const goals = JSON.parse(ctx.brainDump.goals);
        if (Array.isArray(goals) && goals.length > 0) {
          dumpLines.push(`Pinned goals: ${goals.map((g: { pillar?: string; text: string }) => g.text).join("; ")}`);
        }
      } catch { /* ignore parse errors */ }
    }
    if (dumpLines.length > 0) {
      parts.push(`## Tyler's Brain Dump (manual context)\n${dumpLines.join("\n")}`);
    }
  }


  if (brandCtx) {
    parts.push(`## Brand Pipeline
- ${brandCtx.activeDeals} active deals, estimated $${brandCtx.estimatedLow}-$${brandCtx.estimatedHigh}/month pipeline
- New replies: ${brandCtx.newReplies.length ? brandCtx.newReplies.join(", ") : "none"} — needs response
- Follow-ups due today: ${brandCtx.dueToday.length ? brandCtx.dueToday.join(", ") : "none"}
- Revenue closed: $${brandCtx.closedRevenue}`);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function checkAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (authHeader !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildDailyPrompt(directContext: string, period: "morning" | "evening"): string {
  const today = getTodayET();
  const periodLabel = period === "morning" ? "morning" : "evening";
  const periodGuidance = period === "morning"
    ? "This is the MORNING briefing. Focus on what Tyler should tackle today — prioritize by urgency and impact. Surface any brand replies that need Tyler's response today. List follow-ups due."
    : "This is the EVENING briefing. Focus on reflecting on today's progress, what shifted, and what needs attention tomorrow. Note any brand outreach drafts created today. Flag brands approaching the 21-day archive window.";

  return `You are generating Tyler Young's ${periodLabel} briefing. Review all stored memories, tasks, calendar events, emails, and project context across every venture (Motus, RuhrohHalp, Iron Passport, Caliber, thestayed).

Today's date: ${today}
${periodGuidance}

Here is Tyler's current task and goal state pulled directly from the database:

${directContext || "(No open tasks or active goals found in database.)"}

Using the above data AND the retrieved memories, return a structured daily briefing with EXACTLY these four markdown sections. You MUST use ## headings exactly as shown. Each section MUST have at least one bullet point. Be specific — reference real items, people, deadlines, and context.

## Leverage Tasks
The top 3-5 highest-leverage tasks Tyler should tackle ${period === "morning" ? "TODAY" : "TOMORROW based on today's progress"}. Prioritize by urgency and impact. Include why each matters and any deadlines. Pull from the open tasks above. IMPORTANT: If "Recent Leverage Feedback" is provided, use it to calibrate — avoid suggesting tasks similar to ones Tyler marked as not high-leverage, and favor patterns matching tasks he confirmed as high-leverage. If "Tyler's Brain Dump" is provided, incorporate that manual context (e.g., if Tyler says he already submitted something, don't suggest it as a task).

## Open Decisions
Decisions pending Tyler's input. Include context on what's blocking each decision and who is waiting. If none are clear from context, surface the most ambiguous open items that need Tyler's judgment call.

## Upcoming
Calendar events, deadlines, and time-sensitive items for ${period === "morning" ? "today and the next 48 hours" : "tomorrow and the next 48 hours"}. Include any due dates from the tasks above. If no calendar data is available, list the nearest deadlines from goals and tasks.

## Insights
Patterns, risks, or opportunities Tyler should be aware of. Surface anything that connects across ventures or that might be falling through the cracks. At minimum, note the health of active goals.`;
}

function buildWeeklyPrompt(strategyContext: string, trendingContext: string): string {
  const strategyBlock = strategyContext
    ? `\n\n--- CURRENT CONTENT STRATEGY INSIGHTS ---\n${strategyContext}\n\nUse these insights to inform the Content Strategy section below.`
    : "";

  const trendingBlock = trendingContext
    ? `\n\n--- EXTERNAL TRENDING ANALYSIS ---\n${trendingContext}\n\nUse these trends to inform the Trending Opportunities section below. Only recommend trends that naturally align with Tyler's brand pillars.`
    : "";

  return `You are generating Tyler Young's weekly CEO synthesis. Review the past 7 days of stored memories, tasks, decisions, meetings, emails, and project context across every venture (Motus, RuhrohHalp, Iron Passport, Caliber, thestayed).${strategyBlock}${trendingBlock}

Return a structured weekly synthesis with exactly these six sections. Be specific — reference real items, people, outcomes, and data from the memories. Think like a chief of staff summarizing the week for a CEO.

## Project Progress
For each active venture, summarize what moved forward this week. Include key milestones hit, deliverables completed, and measurable progress. Flag any venture that had no meaningful progress.

## Top Blockers
The most critical blockers across all ventures. Include what's blocked, who or what is blocking it, how long it's been stuck, and suggested next steps to unblock.

## Content Strategy
Summarize Tyler's social media performance this week: what content patterns worked, what underperformed, any algorithm shifts or trend signals detected, and recommended adjustments for next week. Include follower growth trends, engagement rate changes, and specific content recommendations. If strategy insights are provided above, synthesize them into actionable guidance.

## Trending Opportunities
Based on current social media trends across Threads, Instagram, TikTok, and YouTube, identify 3-5 trending topics, formats, or cultural moments that Tyler should consider for next week's content. For each trend, explain: what's trending and why, which platform it's most relevant on, how Tyler can authentically tie it to his brand pillars (running, travel/food, building in public, NYC lifestyle, fitness), and a specific content idea. Only recommend trends where Tyler has a genuine angle — never force a trend that doesn't fit his voice.

## Patterns Noticed
Cross-venture patterns, recurring themes, or strategic observations from the week. Surface connections Tyler might miss — e.g., the same person blocking two ventures, a theme appearing in multiple meetings, resource conflicts, or momentum shifts.

## Suggested Focus
Based on everything from this week, recommend Tyler's top 3 priorities for next week. Explain the reasoning — why these over other options, what's at stake, and what happens if they're delayed.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gatherTrendingContext(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const supabase = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: recentPosts } = await supabase
    .from("content_queue")
    .select("body, platform, content_type")
    .eq("user_id", TYLER_USER_ID)
    .eq("status", "posted")
    .gte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false })
    .limit(10);

  const postContext = (recentPosts ?? [])
    .map((p) => `[${p.platform}/${p.content_type}] ${(p.body as string).slice(0, 100)}`)
    .join("\n");

  const trendPrompt = `You are a social media trend analyst. Today is ${today}.

Tyler Young's brand pillars: Running & Endurance, Travel & Food, Building in Public (software/startups), NYC Lifestyle, Fitness & Strength.
His platforms: Threads, Instagram, TikTok, YouTube.

His recent posts this week:
${postContext || "(no posts this week)"}

Analyze what is currently trending on social media that is RELEVANT to Tyler's brand pillars. Consider:
1. Trending audio, formats, and challenges on TikTok and Instagram Reels
2. Trending conversation topics on Threads
3. YouTube content trends in running, fitness, travel, and tech
4. Seasonal trends, cultural moments, and news hooks relevant to his niches
5. Algorithm shifts or platform feature changes creators should leverage

For each trend, explain: what it is, which platform, why it's relevant to Tyler's brand, and a specific content idea.

Return 5-8 trends, each as a concise paragraph. Focus on actionable opportunities Tyler can capitalize on THIS WEEK.`;

  return callClaude(
    "You are a social media trend analyst specializing in fitness, running, travel, tech, and NYC lifestyle content.",
    trendPrompt,
    2048,
  );
}

function isMorningRun(): boolean {
  const etHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
  );
  return etHour < 12;
}

function isMondayMorningRun(): boolean {
  // Parse the current ET date/time to get day-of-week in ET (not UTC)
  const etDayOfWeek = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  ).getDay();
  return etDayOfWeek === 1 && isMorningRun();
}

function extractSection(text: string, heading: string): string[] {
  // Match "## <optional emoji/bold/etc> Heading Text" — Claude sometimes adds emoji before headings
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `##[^\\n]*?${escapedHeading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##|$)`,
    "i",
  );
  const match = text.match(pattern);
  if (!match) return [];
  const parsedItems: string[] = [];
  const rawLines = match[1].split("\n");

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("##") || /^-{2,}$/.test(trimmed)) continue;

    const isBullet = /^[\s]*(?:[-*•]|\d+[.)])\s+/.test(rawLine);
    const cleanLine = trimmed
      .replace(/^[\s]*(?:[-*•]|\d+[.)])\s+/, "") // strip list markers
      .replace(/^\*\*|\*\*$/g, "") // strip leading/trailing bold **
      .replace(/^\*|\*$/g, "") // strip leading/trailing italic *
      .trim();
    if (!cleanLine) continue;

    if (isBullet || parsedItems.length === 0) {
      parsedItems.push(cleanLine);
    } else {
      // Continuation line: append to previous bullet so task + rationale stay together.
      parsedItems[parsedItems.length - 1] = `${parsedItems[parsedItems.length - 1]} ${cleanLine}`;
    }
  }

  return parsedItems;
}

function parseDailySections(answer: string) {
  return {
    leverage_tasks: extractSection(answer, "Leverage Tasks"),
    open_decisions: extractSection(answer, "Open Decisions"),
    upcoming: extractSection(answer, "Upcoming"),
    insights: extractSection(answer, "Insights"),
  };
}

function parseWeeklySections(answer: string) {
  return {
    project_progress: extractSection(answer, "Project Progress"),
    top_blockers: extractSection(answer, "Top Blockers"),
    content_strategy: extractSection(answer, "Content Strategy"),
    trending_opportunities: extractSection(answer, "Trending Opportunities"),
    patterns_noticed: extractSection(answer, "Patterns Noticed"),
    suggested_focus: extractSection(answer, "Suggested Focus"),
  };
}

function dailySectionsToContentJson(sections: ReturnType<typeof parseDailySections>) {
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
    })),
  }));
}

function weeklySectionsToContentJson(sections: ReturnType<typeof parseWeeklySections>) {
  const sectionDefs = [
    { key: "project_progress", title: "Project Progress", icon: "📊", color: "#3B82F6" },
    { key: "top_blockers", title: "Top Blockers", icon: "🚧", color: "#EF4444" },
    { key: "content_strategy", title: "Content Strategy", icon: "📱", color: "#F59E0B" },
    { key: "trending_opportunities", title: "Trending Opportunities", icon: "🔥", color: "#EC4899" },
    { key: "patterns_noticed", title: "Patterns Noticed", icon: "🔍", color: "#8B5CF6" },
    { key: "suggested_focus", title: "Suggested Focus", icon: "🎯", color: "#10B981" },
  ] as const;
  return sectionDefs.map((def) => ({
    title: def.title,
    icon: def.icon,
    color: def.color,
    items: (sections[def.key] ?? []).map((text: string, i: number) => ({
      id: `${def.key}-${i}`,
      text,
    })),
  }));
}

async function saveBriefingFromCron(
  userId: string,
  rawMd: string,
  contentJson: unknown,
  period: "morning" | "evening" | "weekly",
) {
  const supabase = createAdminClient();
  const today = getTodayET();
  const { data: existing } = await supabase
    .from("briefings")
    .select("id")
    .eq("user_id", userId)
    .eq("date", today)
    .eq("period", period)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("briefings")
      .update({ content_md: rawMd, content_json: contentJson, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) {
      logError("cron.save.update", error, { userId, period });
      throw new Error(`Briefing update failed: ${error.message}`);
    }
  } else {
    const { error } = await supabase
      .from("briefings")
      .insert({ user_id: userId, content_md: rawMd, content_json: contentJson, date: today, period, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    if (error) {
      logError("cron.save.insert", error, { userId, period });
      throw new Error(`Briefing insert failed: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const authError = checkAuth(request);
  if (authError) return authError;

  const period = getBriefingPeriod();
  const results: Record<string, unknown> = { ok: true, timestamp: new Date().toISOString(), period, dateET: getTodayET() };

  // 0. Fetch direct DB context (tasks, goals, feedback, brain dumps)
  let directContextStr = "";
  try {
    const [directCtx, brandCtx] = await Promise.all([
      fetchDirectContext(TYLER_USER_ID),
      fetchBrandContext(TYLER_USER_ID),
    ]);
    directContextStr = formatDirectContext(directCtx, brandCtx);
  } catch (e) {
    logError("cron.direct-context", e);
  }

  // 1. Daily trend detection (runs in parallel with briefing query)
  const trendPromise = detectTrends()
    .then((r) => { results.daily_trends = { detected: r.detected }; })
    .catch((e) => { logError("cron.daily-trends", e); results.daily_trends = { error: "Trend detection failed" }; });

  // 2. Morning/evening briefing (4096 tokens for structured multi-section output)
  const briefingPromise = queryBrain(buildDailyPrompt(directContextStr, period), { userId: TYLER_USER_ID, topK: 12, threshold: 0.55, maxTokens: 4096 })
    .then(async (dailyResult) => {
      const dailySections = parseDailySections(dailyResult.answer);
      const dailyContentJson = dailySectionsToContentJson(dailySections);
      await saveBriefingFromCron(TYLER_USER_ID, dailyResult.answer, dailyContentJson, period);
      results.daily = { type: `${period}_briefing`, ...dailySections, sources: dailyResult.sources, raw: dailyResult.answer };
    })
    .catch((e) => {
      logError("cron.daily", e);
      results.daily = { error: `${period} briefing failed`, detail: e instanceof Error ? e.message : String(e) };
    });

  // Run trend detection + briefing in parallel
  await Promise.allSettled([trendPromise, briefingPromise]);

  // 3. Daily strategy refresh (every morning run)
  let strategyContext = "";
  if (isMorningRun()) {
    try {
      await generateStrategy();
      const strategy = await getCurrentStrategy();
      const insightLines = (strategy.insights ?? []).map(
        (i: { type: string; content: string; confidence: number }) =>
          `[${i.type}] (confidence: ${i.confidence}) ${i.content}`,
      );
      if (insightLines.length) strategyContext = insightLines.join("\n");
      results.strategy_refresh = { insights: insightLines.length, success: true };
    } catch (e) {
      logError("cron.strategy-refresh", e);
      results.strategy_refresh = { error: "Strategy refresh failed" };
    }
  }

  // 4. Weekly synthesis (Monday morning only)
  if (isMondayMorningRun()) {
    let trendingContext = "";
    try {
      trendingContext = await gatherTrendingContext();
      results.trending_analysis = { success: true };
    } catch (e) {
      logError("cron.trending-analysis", e);
      results.trending_analysis = { error: "Trending analysis failed" };
    }

    try {
      const weeklyResult = await queryBrain(buildWeeklyPrompt(strategyContext, trendingContext), { userId: TYLER_USER_ID, topK: 20, threshold: 0.50, maxTokens: 4096 });
      const weeklySections = parseWeeklySections(weeklyResult.answer);
      const weeklyContentJson = weeklySectionsToContentJson(weeklySections);
      await saveBriefingFromCron(TYLER_USER_ID, weeklyResult.answer, weeklyContentJson, "weekly");
      results.weekly = { type: "weekly_synthesis", ...weeklySections, sources: weeklyResult.sources };
    } catch (e) {
      logError("cron.weekly", e);
      results.weekly = { error: "Weekly synthesis failed" };
    }
  }

  return NextResponse.json(results);
}
