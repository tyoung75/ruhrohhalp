/**
 * Vercel Cron — Unified Daily Endpoint
 *
 * Single cron job (Hobby plan limit) that handles ALL scheduled work:
 *  1. Daily briefing (every run)
 *  2. Weekly CEO synthesis (Monday morning only)
 *  3. Creator OS: publish queued posts, collect analytics, refresh tokens
 *
 * Schedule: "0 11 * * *" → runs at 11:00 UTC (6 AM ET)
 *
 * Auth: Vercel sets the `authorization` header to `Bearer <CRON_SECRET>`.
 */

import { NextRequest, NextResponse } from "next/server";
import { queryBrain } from "@/lib/query";
import { logError } from "@/lib/logger";
import { publishQueuedPosts, syncExternalPosts, collectAnalytics, refreshExpiringTokens, expireStaleDrafts } from "@/lib/creator/jobs";

/** Tyler's Supabase user ID — hardcoded for cron (no session context). */
const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMondayMorningRun(): boolean {
  // The 11:00 UTC run corresponds to 6 AM ET (morning briefing).
  // If it's Monday at that time, we also run the weekly synthesis.
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay(); // 0 = Sunday, 1 = Monday
  return utcDay === 1 && utcHour < 12; // Morning run on Monday
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
    patterns_noticed: extractSection(answer, "Patterns Noticed"),
    suggested_focus: extractSection(answer, "Suggested Focus"),
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Verify Vercel cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {
    ok: true,
    timestamp: new Date().toISOString(),
  };

  // --- Always run the daily briefing ---
  try {
    const dailyResult = await queryBrain(buildDailyPrompt(), {
      userId: TYLER_USER_ID,
      topK: 12,
      threshold: 0.55,
    });

    results.daily = {
      type: "daily_briefing",
      ...parseDailySections(dailyResult.answer),
      sources: dailyResult.sources,
      raw: dailyResult.answer,
    };
  } catch (error) {
    logError("cron.daily", error);
    results.daily = { error: "Daily briefing failed" };
  }

  // --- On Monday morning, also run the weekly synthesis ---
  if (isMondayMorningRun()) {
    try {
      const weeklyResult = await queryBrain(WEEKLY_PROMPT, {
        userId: TYLER_USER_ID,
        topK: 20,
        threshold: 0.50,
      });

      results.weekly = {
        type: "weekly_synthesis",
        ...parseWeeklySections(weeklyResult.answer),
        sources: weeklyResult.sources,
        raw: weeklyResult.answer,
      };
    } catch (error) {
      logError("cron.weekly", error);
      results.weekly = { error: "Weekly synthesis failed" };
    }
  }

  // --- Creator OS jobs (run every day) ---

  // 3a. Sync external posts (manual posts made in Threads app)
  try {
    const syncResult = await syncExternalPosts(TYLER_USER_ID);
    results.creator_sync = syncResult;
  } catch (error) {
    logError("cron.creator-sync", error);
    results.creator_sync = { error: "Sync failed" };
  }

  // 3b. Expire stale queued drafts (before publishing)
  try {
    const expireResult = await expireStaleDrafts(TYLER_USER_ID);
    results.creator_expire = expireResult;
  } catch (error) {
    logError("cron.creator-expire", error);
    results.creator_expire = { error: "Expire failed" };
  }

  // 3c. Publish any queued posts whose schedule has arrived
  try {
    const publishResult = await publishQueuedPosts(TYLER_USER_ID, { source: "cron" });
    results.creator_publish = publishResult;
  } catch (error) {
    logError("cron.creator-publish", error);
    results.creator_publish = { error: "Publish failed" };
  }

  // 3d. Collect analytics on ALL posted content (including synced external posts)
  try {
    const analyticsResult = await collectAnalytics(TYLER_USER_ID);
    results.creator_analytics = analyticsResult;
  } catch (error) {
    logError("cron.creator-analytics", error);
    results.creator_analytics = { error: "Analytics failed" };
  }

  // 3e. Refresh any platform tokens expiring within 7 days
  try {
    const tokenResult = await refreshExpiringTokens();
    results.token_refresh = tokenResult;
  } catch (error) {
    logError("cron.token-refresh", error);
    results.token_refresh = { error: "Token refresh failed" };
  }

  return NextResponse.json(results);
}
