/**
 * Optimal Posting Hours — GET /api/creator/optimal-hours
 *
 * Analyzes historical post_analytics joined with content_queue to determine
 * which hours of the day produce the highest engagement on each platform.
 *
 * Returns an ordered list of hours (0-23) ranked by average engagement rate,
 * plus the top 3 "best hours" for quick consumption.
 *
 * Query params:
 *   ?platform=threads  (optional, defaults to all platforms)
 *   ?days=60           (lookback window, default 60, max 180)
 *
 * Auth: Authenticated user session.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const url = new URL(request.url);
  const platform = url.searchParams.get("platform");
  const days = Math.min(Number(url.searchParams.get("days") ?? "60"), 180);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const supabase = createAdminClient();

  try {
    // Fetch analytics with their linked content_queue post (for scheduled_for / updated_at)
    let analyticsQuery = supabase
      .from("post_analytics")
      .select("content_queue_id, platform, engagement_rate, fetched_at")
      .eq("user_id", user.id)
      .gte("fetched_at", since);

    if (platform) {
      analyticsQuery = analyticsQuery.eq("platform", platform);
    }

    const { data: analytics, error: analyticsError } = await analyticsQuery;
    if (analyticsError) throw new Error(analyticsError.message);
    if (!analytics?.length) {
      return NextResponse.json({
        best_hours: [8, 12, 18], // sensible defaults
        hourly: [],
        sample_size: 0,
        is_default: true,
      });
    }

    // Get the content_queue rows to determine what hour each post was published
    const queueIds = [...new Set(
      analytics
        .map((a: Record<string, unknown>) => a.content_queue_id as string)
        .filter(Boolean)
    )];

    if (!queueIds.length) {
      return NextResponse.json({
        best_hours: [8, 12, 18],
        hourly: [],
        sample_size: 0,
        is_default: true,
      });
    }

    const { data: posts, error: postsError } = await supabase
      .from("content_queue")
      .select("id, scheduled_for, updated_at")
      .in("id", queueIds);

    if (postsError) throw new Error(postsError.message);

    // Map post id -> publish hour (use scheduled_for if available, else updated_at)
    const postHourMap = new Map<string, number>();
    for (const post of (posts ?? []) as Record<string, unknown>[]) {
      const timestamp = (post.scheduled_for as string) || (post.updated_at as string);
      if (timestamp) {
        postHourMap.set(post.id as string, new Date(timestamp).getHours());
      }
    }

    // Deduplicate analytics — keep latest fetch per content_queue_id
    const latestByPost = new Map<string, Record<string, unknown>>();
    for (const row of analytics as Record<string, unknown>[]) {
      const qId = row.content_queue_id as string;
      if (!qId) continue;
      const existing = latestByPost.get(qId);
      if (!existing || (row.fetched_at as string) > (existing.fetched_at as string)) {
        latestByPost.set(qId, row);
      }
    }

    // Group engagement by hour
    const hourlyStats = new Map<number, { total: number; count: number }>();
    for (const [qId, metric] of latestByPost) {
      const hour = postHourMap.get(qId);
      if (hour === undefined) continue;
      const existing = hourlyStats.get(hour) ?? { total: 0, count: 0 };
      existing.total += (metric.engagement_rate as number) ?? 0;
      existing.count++;
      hourlyStats.set(hour, existing);
    }

    // Build sorted hourly breakdown
    const hourly = Array.from(hourlyStats.entries())
      .map(([hour, stats]) => ({
        hour,
        avg_engagement: stats.count > 0 ? stats.total / stats.count : 0,
        post_count: stats.count,
      }))
      .sort((a, b) => b.avg_engagement - a.avg_engagement);

    // Top 3 hours (require at least 2 posts per hour for reliability)
    const reliableHours = hourly.filter((h) => h.post_count >= 2);
    const bestHours = (reliableHours.length >= 3 ? reliableHours : hourly)
      .slice(0, 3)
      .map((h) => h.hour)
      .sort((a, b) => a - b); // sort chronologically

    return NextResponse.json({
      best_hours: bestHours.length ? bestHours : [8, 12, 18],
      hourly,
      sample_size: latestByPost.size,
      is_default: bestHours.length === 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to compute optimal hours" },
      { status: 500 }
    );
  }
}
