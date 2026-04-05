/**
 * Content Calendar Planner — POST /api/creator/calendar/plan
 *
 * AI-powered content calendar planning. Analyzes strategy insights,
 * analytics performance, trend signals, and pillar distribution to
 * generate a week of planned content slots.
 *
 * Body params:
 *   { week?: "2026-04-07", days?: 7 }
 *   Defaults to planning the upcoming week (next Monday).
 *
 * Auth: Authenticated user OR cron secret.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { callClaude } from "@/lib/processors/claude";

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

const PILLAR_TARGETS: Record<string, number> = {
  running: 0.275,
  travel: 0.225,
  building: 0.175,
  nyc: 0.175,
  fitness: 0.125,
};

const PLANNER_SYSTEM = `You are Tyler Young's Content Calendar Planner. Your job is to create a week of daily content plans that maximize engagement, align with brand pillars, and leverage current trends.

Tyler is a NYC-based runner, software engineer, and entrepreneur. His brand pillars (with target distribution):
- running (27.5%): Running & endurance training, race prep, training data
- travel (22.5%): Travel & food discoveries, restaurant reviews, trip recaps
- building (17.5%): Building in public — Motus app, Iron Passport, tech insights
- nyc (17.5%): NYC lifestyle, neighborhood discoveries, city energy
- fitness (12.5%): Fitness & strength training, gym observations, workout data

Rules:
1. Plan 2-3 posts per day across the week
2. Each post needs a specific topic (not generic), a pillar, a format, and a time slot
3. Distribute pillars across the week to match target percentages
4. At least 2-3 threads per week (multi-part posts)
5. Use trend signals and analytics patterns to inform WHAT to post and WHEN
6. Morning/midday for informational content, evening for engagement-heavy posts
7. Lean into topics/pillars that analytics show are performing well
8. Include at least 1 "new lane" topic per day that explores fresh territory
9. Consider day-of-week patterns: Monday = fresh start energy, Friday = weekend plans, weekend = lifestyle/adventure
10. Never plan the same topic twice in a week

Return ONLY a valid JSON array. Each item:
{
  "planned_date": "YYYY-MM-DD",
  "time_slot": "morning" | "midday" | "evening" | "late_night",
  "platform": "threads",
  "pillar": "running" | "travel" | "building" | "nyc" | "fitness",
  "topic": "specific content idea (be concrete)",
  "format": "single_post" | "thread",
  "rationale": "why this topic, why this time slot, what data supports it",
  "trend_relevance": 0.0-1.0
}`;

export async function POST(request: NextRequest) {
  // Auth: user session or cron secret
  const cronSecret = request.headers.get("x-cron-secret");
  const authHeader = request.headers.get("Authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");
  let userId: string;

  if (
    (cronSecret && cronSecret === process.env.CRON_SECRET) ||
    (bearerToken && bearerToken === process.env.CRON_SECRET)
  ) {
    userId = process.env.CREATOR_USER_ID ?? TYLER_USER_ID;
  } else {
    const { user, response } = await requireUser();
    if (!user) return response!;
    userId = user.id;
  }

  const body = await request.json().catch(() => ({}));
  const days = body.days ?? 7;

  // Determine planning window
  let startDate: Date;
  if (body.week) {
    startDate = new Date(body.week + "T00:00:00");
  } else {
    // Default: next Monday (or today if Monday)
    startDate = new Date();
    const day = startDate.getDay();
    const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
    startDate.setDate(startDate.getDate() + daysUntilMonday);
  }
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + days - 1);

  const supabase = createAdminClient();

  // Gather planning context in parallel
  const [
    analyticsResult,
    trendResult,
    strategyResult,
    recentPostsResult,
    existingSlotsResult,
    feedbackResult,
  ] = await Promise.all([
    // Top performing content patterns (last 30 days)
    supabase
      .from("post_analytics")
      .select("content_queue_id, engagement_rate, impressions, likes, replies")
      .eq("user_id", userId)
      .gte("fetched_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("engagement_rate", { ascending: false })
      .limit(20),
    // Active trend signals
    supabase
      .from("trend_signals")
      .select("topic, platform, relevance_score, source, context")
      .eq("user_id", userId)
      .gte("expires_at", new Date().toISOString())
      .order("relevance_score", { ascending: false })
      .limit(10),
    // Active strategy insights
    supabase
      .from("strategy_insights")
      .select("insight_type, content, confidence, data")
      .eq("user_id", userId)
      .eq("active", true)
      .order("confidence", { ascending: false })
      .limit(10),
    // Recent posts for context and deduplication
    supabase
      .from("content_queue")
      .select("body, pillar_name, content_type, topic, platform, status, scheduled_for")
      .eq("user_id", userId)
      .in("status", ["queued", "posted", "posting", "draft", "approved"])
      .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(30),
    // Existing calendar slots (to avoid overwriting)
    supabase
      .from("content_calendar")
      .select("planned_date, time_slot, platform")
      .eq("user_id", userId)
      .gte("planned_date", startDate.toISOString().slice(0, 10))
      .lte("planned_date", endDate.toISOString().slice(0, 10)),
    // Creator feedback/directives
    supabase
      .from("content_feedback")
      .select("feedback_type, content, context")
      .eq("user_id", userId)
      .eq("active", true)
      .in("feedback_type", ["directive", "dislike"])
      .limit(10),
  ]);

  // Get content details for top performing posts
  const topQueueIds = (analyticsResult.data ?? [])
    .map((a: Record<string, unknown>) => a.content_queue_id)
    .filter(Boolean) as string[];

  let topPostDetails: Array<Record<string, unknown>> = [];
  if (topQueueIds.length > 0) {
    const { data } = await supabase
      .from("content_queue")
      .select("id, body, pillar_name, content_type, topic")
      .in("id", topQueueIds.slice(0, 15));
    topPostDetails = (data ?? []) as Array<Record<string, unknown>>;
  }

  // Build analytics context
  const analyticsMap = new Map(
    (analyticsResult.data ?? []).map((a: Record<string, unknown>) => [a.content_queue_id, a])
  );
  const topPerformers = topPostDetails.map((post) => {
    const analytics = analyticsMap.get(post.id) as Record<string, unknown> | undefined;
    return {
      pillar: post.pillar_name ?? "unknown",
      type: post.content_type,
      topic: post.topic ?? truncateBody(post.body as string),
      engagement_rate: analytics?.engagement_rate ?? 0,
      impressions: analytics?.impressions ?? 0,
    };
  });

  // Compute current pillar distribution
  const pillarCounts: Record<string, number> = {};
  let totalRecent = 0;
  for (const post of (recentPostsResult.data ?? []) as Array<{ pillar_name: string | null }>) {
    const pillar = post.pillar_name || "default";
    pillarCounts[pillar] = (pillarCounts[pillar] ?? 0) + 1;
    totalRecent++;
  }

  // Find existing slots to avoid duplicating
  const existingSlotKeys = new Set(
    (existingSlotsResult.data ?? []).map(
      (s: Record<string, unknown>) => `${s.planned_date}:${s.time_slot}:${s.platform}`
    )
  );

  // Build planning prompt
  const dateLabels: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
    dateLabels.push(`${d.toISOString().slice(0, 10)} (${dayName})`);
  }

  const userPrompt = buildPlannerPrompt({
    dates: dateLabels,
    topPerformers,
    trends: (trendResult.data ?? []) as Array<Record<string, unknown>>,
    insights: (strategyResult.data ?? []) as Array<Record<string, unknown>>,
    recentPosts: (recentPostsResult.data ?? []) as Array<Record<string, unknown>>,
    pillarCounts,
    totalRecent,
    directives: (feedbackResult.data ?? []) as Array<Record<string, unknown>>,
    existingSlots: existingSlotKeys,
  });

  const raw = await callClaude(PLANNER_SYSTEM, userPrompt, 4096);

  // Parse the response
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) {
    return NextResponse.json({ error: "Failed to parse planner response" }, { status: 500 });
  }

  let planned: Array<Record<string, unknown>>;
  try {
    planned = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return NextResponse.json({ error: "Invalid JSON from planner" }, { status: 500 });
  }

  // Filter out slots that already exist
  const newSlots = planned.filter((slot) => {
    const key = `${slot.planned_date}:${slot.time_slot}:${slot.platform}`;
    return !existingSlotKeys.has(key);
  });

  // Insert into content_calendar
  if (newSlots.length > 0) {
    const rows = newSlots.map((slot) => ({
      user_id: userId,
      planned_date: slot.planned_date as string,
      time_slot: slot.time_slot as string,
      platform: (slot.platform as string) || "threads",
      pillar: slot.pillar as string,
      topic: slot.topic as string,
      format: (slot.format as string) || "single_post",
      rationale: (slot.rationale as string) || null,
      trend_relevance: (slot.trend_relevance as number) || 0,
      status: "planned",
    }));

    const { error: insertError } = await supabase
      .from("content_calendar")
      .insert(rows);

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    planned: newSlots.length,
    skipped_existing: planned.length - newSlots.length,
    week_start: startDate.toISOString().slice(0, 10),
    slots: newSlots,
  });
}

function truncateBody(body: string): string {
  if (!body) return "";
  const text = body.startsWith("[") ? (JSON.parse(body)?.[0] ?? body) : body;
  return text.length > 80 ? text.slice(0, 77) + "..." : text;
}

function buildPlannerPrompt(ctx: {
  dates: string[];
  topPerformers: Array<Record<string, unknown>>;
  trends: Array<Record<string, unknown>>;
  insights: Array<Record<string, unknown>>;
  recentPosts: Array<Record<string, unknown>>;
  pillarCounts: Record<string, number>;
  totalRecent: number;
  directives: Array<Record<string, unknown>>;
  existingSlots: Set<string>;
}): string {
  const lines: string[] = [];

  lines.push(`Plan content for these dates: ${ctx.dates.join(", ")}`);
  lines.push("");

  // Current pillar distribution
  lines.push("--- CURRENT PILLAR DISTRIBUTION (last 14 days) ---");
  for (const [pillar, target] of Object.entries(PILLAR_TARGETS)) {
    const actual = ctx.totalRecent > 0 ? ((ctx.pillarCounts[pillar] ?? 0) / ctx.totalRecent) : 0;
    const status = actual < target - 0.05 ? "UNDER-REPRESENTED (plan more)" : actual > target + 0.1 ? "over-represented (plan less)" : "on target";
    lines.push(`  ${pillar}: ${Math.round(actual * 100)}% actual vs ${Math.round(target * 100)}% target — ${status}`);
  }
  if (ctx.pillarCounts["default"]) {
    lines.push(`  default (unassigned): ${Math.round(((ctx.pillarCounts["default"] ?? 0) / ctx.totalRecent) * 100)}% — avoid planning unassigned content`);
  }
  lines.push("");

  // Top performers
  if (ctx.topPerformers.length > 0) {
    lines.push("--- TOP PERFORMING CONTENT (last 30 days) ---");
    for (const post of ctx.topPerformers.slice(0, 10)) {
      lines.push(`  [${post.pillar}] ${post.type}: "${post.topic}" — engagement: ${Number(post.engagement_rate).toFixed(3)}, impressions: ${post.impressions}`);
    }
    lines.push("");
  }

  // Trend signals
  if (ctx.trends.length > 0) {
    lines.push("--- ACTIVE TREND SIGNALS ---");
    for (const t of ctx.trends) {
      lines.push(`  "${t.topic}" (relevance: ${t.relevance_score}, source: ${t.source})${t.context ? ` — ${t.context}` : ""}`);
    }
    lines.push("");
  }

  // Strategy insights
  if (ctx.insights.length > 0) {
    lines.push("--- ACTIVE STRATEGY INSIGHTS ---");
    for (const i of ctx.insights) {
      lines.push(`  [${i.insight_type}] ${i.content} (confidence: ${i.confidence})`);
    }
    lines.push("");
  }

  // Recent posts (for dedup)
  if (ctx.recentPosts.length > 0) {
    lines.push("--- RECENT POSTS (avoid repeating these topics) ---");
    for (const post of ctx.recentPosts.slice(0, 15)) {
      const body = post.body as string;
      const preview = body?.startsWith("[") ? (JSON.parse(body)?.[0] ?? body).slice(0, 60) : body?.slice(0, 60);
      lines.push(`  [${post.pillar_name ?? "?"}] ${preview}...`);
    }
    lines.push("");
  }

  // Directives
  if (ctx.directives.length > 0) {
    lines.push("--- STANDING DIRECTIVES ---");
    for (const d of ctx.directives) {
      lines.push(`  [${d.feedback_type}] ${d.content}`);
    }
    lines.push("");
  }

  // Existing slots
  if (ctx.existingSlots.size > 0) {
    lines.push("--- ALREADY PLANNED (skip these slots) ---");
    for (const key of ctx.existingSlots) {
      lines.push(`  ${key}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
