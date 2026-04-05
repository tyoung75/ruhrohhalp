/**
 * Content Calendar — GET /api/creator/calendar
 *
 * Returns the content calendar for a given week, merging planned slots
 * with actual content_queue posts. Also returns pillar coverage stats.
 *
 * Query params:
 *   ?week=2026-03-31  (Monday of the week to fetch; defaults to current week)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

export async function GET(request: NextRequest) {
  // Auth: user session or cron secret
  const authHeader = request.headers.get("Authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");
  let userId: string;

  if (bearerToken && bearerToken === process.env.CRON_SECRET) {
    userId = process.env.CREATOR_USER_ID ?? TYLER_USER_ID;
  } else {
    const { user, response } = await requireUser();
    if (!user) return response!;
    userId = user.id;
  }

  const url = new URL(request.url);
  const weekParam = url.searchParams.get("week");

  // Determine the Monday of the requested week
  const now = new Date();
  let monday: Date;
  if (weekParam) {
    monday = new Date(weekParam + "T00:00:00");
  } else {
    monday = new Date(now);
    const day = monday.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday.setDate(monday.getDate() + diff);
  }
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const startDate = monday.toISOString().slice(0, 10);
  const endDate = sunday.toISOString().slice(0, 10);

  const supabase = createAdminClient();

  // Fetch calendar slots and actual posts in parallel
  const [calendarResult, postsResult, allPostsResult] = await Promise.all([
    supabase
      .from("content_calendar")
      .select("*")
      .eq("user_id", userId)
      .gte("planned_date", startDate)
      .lte("planned_date", endDate)
      .order("planned_date")
      .order("time_slot"),
    // Actual posts for this week (queued/posted/posting)
    supabase
      .from("content_queue")
      .select("id, platform, content_type, body, status, scheduled_for, pillar_name, confidence_score, brand_voice_score, timeliness_score, topic, created_at")
      .eq("user_id", userId)
      .in("status", ["queued", "posted", "posting", "draft", "approved"])
      .gte("scheduled_for", monday.toISOString())
      .lte("scheduled_for", sunday.toISOString())
      .order("scheduled_for"),
    // All recent posts for pillar coverage (last 30 days)
    supabase
      .from("content_queue")
      .select("pillar_name")
      .eq("user_id", userId)
      .in("status", ["queued", "posted", "posting", "draft", "approved"])
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()),
  ]);

  // Compute pillar coverage from last 30 days
  const pillarCounts: Record<string, number> = {};
  let totalPosts = 0;
  for (const post of (allPostsResult.data ?? []) as Array<{ pillar_name: string | null }>) {
    const pillar = post.pillar_name || "default";
    pillarCounts[pillar] = (pillarCounts[pillar] ?? 0) + 1;
    totalPosts++;
  }

  const pillarCoverage: Record<string, number> = {};
  for (const [pillar, count] of Object.entries(pillarCounts)) {
    pillarCoverage[pillar] = totalPosts > 0 ? Math.round((count / totalPosts) * 100) : 0;
  }

  return NextResponse.json({
    week_start: startDate,
    week_end: endDate,
    calendar: calendarResult.data ?? [],
    posts: postsResult.data ?? [],
    pillar_coverage: pillarCoverage,
    total_posts_30d: totalPosts,
  });
}
