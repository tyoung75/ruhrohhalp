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

function isMondayMorningRun(): boolean {
  const now = new Date();
  return now.getUTCDay() === 1 && now.getUTCHours() < 12;
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
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^[\s]*(?:[-*]|\d+[.)]\s*)\s*/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("##"));
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
  period: "daily" | "weekly",
) {
  const supabase = createAdminClient();
  const today = new Date().toISOString().split("T")[0];
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

  const results: Record<string, unknown> = { ok: true, timestamp: new Date().toISOString() };

  // 1. Daily trend detection (runs in parallel with briefing query)
  const trendPromise = detectTrends()
    .then((r) => { results.daily_trends = { detected: r.detected }; })
    .catch((e) => { logError("cron.daily-trends", e); results.daily_trends = { error: "Trend detection failed" }; });

  // 2. Daily briefing (4096 tokens for structured multi-section output)
  const briefingPromise = queryBrain(buildDailyPrompt(), { userId: TYLER_USER_ID, topK: 12, threshold: 0.55, maxTokens: 4096 })
    .then(async (dailyResult) => {
      const dailySections = parseDailySections(dailyResult.answer);
      const dailyContentJson = dailySectionsToContentJson(dailySections);
      await saveBriefingFromCron(TYLER_USER_ID, dailyResult.answer, dailyContentJson, "daily");
      results.daily = { type: "daily_briefing", ...dailySections, sources: dailyResult.sources, raw: dailyResult.answer };
    })
    .catch((e) => {
      logError("cron.daily", e);
      results.daily = { error: "Daily briefing failed", detail: e instanceof Error ? e.message : String(e) };
    });

  // Run trend detection + daily briefing in parallel
  await Promise.allSettled([trendPromise, briefingPromise]);

  // 3. Weekly synthesis (Monday morning only)
  if (isMondayMorningRun()) {
    let strategyContext = "";
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
