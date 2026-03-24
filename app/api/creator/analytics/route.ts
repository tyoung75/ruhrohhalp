/**
 * Creator Analytics Dashboard — GET /api/creator/analytics
 *
 * Returns aggregated analytics data for the creator dashboard:
 * - Overall stats (total posts, avg engagement, total impressions)
 * - Top performing posts
 * - Engagement trend over time
 * - Platform breakdown
 *
 * Query params:
 *   ?days=30  (default 30, max 90)
 *   ?platform=threads  (optional filter)
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
  const days = Math.min(Number(url.searchParams.get("days") ?? "30"), 90);
  const platformFilter = url.searchParams.get("platform");
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const supabase = createAdminClient();

  try {
    // 1. All analytics in the date range
    let analyticsQuery = supabase
      .from("post_analytics")
      .select("*")
      .eq("user_id", user.id)
      .gte("fetched_at", since)
      .order("fetched_at", { ascending: false });

    if (platformFilter) {
      analyticsQuery = analyticsQuery.eq("platform", platformFilter);
    }

    const { data: analytics, error: analyticsError } = await analyticsQuery;

    if (analyticsError) {
      throw new Error(`Failed to fetch analytics: ${analyticsError.message}`);
    }

    // 2. Deduplicate — keep latest fetch per post_id
    const latestByPost = new Map<string, Record<string, unknown>>();
    for (const row of (analytics ?? []) as Record<string, unknown>[]) {
      const postId = row.post_id as string;
      const existing = latestByPost.get(postId);
      if (!existing || (row.fetched_at as string) > (existing.fetched_at as string)) {
        latestByPost.set(postId, row);
      }
    }
    const uniqueMetrics = Array.from(latestByPost.values());

    // 3. Overall stats
    const totalPosts = uniqueMetrics.length;
    const totalImpressions = uniqueMetrics.reduce((s, m) => s + (m.impressions as number ?? 0), 0);
    const totalLikes = uniqueMetrics.reduce((s, m) => s + (m.likes as number ?? 0), 0);
    const totalReplies = uniqueMetrics.reduce((s, m) => s + (m.replies as number ?? 0), 0);
    const totalReposts = uniqueMetrics.reduce((s, m) => s + (m.reposts as number ?? 0), 0);
    const avgEngagement = totalPosts > 0
      ? uniqueMetrics.reduce((s, m) => s + (m.engagement_rate as number ?? 0), 0) / totalPosts
      : 0;

    // 4. Top performing posts (by engagement rate)
    const sorted = [...uniqueMetrics].sort(
      (a, b) => (b.engagement_rate as number ?? 0) - (a.engagement_rate as number ?? 0)
    );
    const topPostIds = sorted.slice(0, 5).map((m) => m.content_queue_id).filter(Boolean) as string[];

    let topPosts: Array<Record<string, unknown>> = [];
    if (topPostIds.length) {
      const { data: postBodies } = await supabase
        .from("content_queue")
        .select("id, body, platform, content_type, created_at")
        .in("id", topPostIds);

      topPosts = sorted.slice(0, 5).map((metric) => {
        const post = (postBodies ?? []).find(
          (p: Record<string, unknown>) => p.id === metric.content_queue_id
        );
        return {
          body: (post?.body as string)?.slice(0, 280) ?? "",
          platform: metric.platform,
          impressions: metric.impressions,
          likes: metric.likes,
          replies: metric.replies,
          reposts: metric.reposts,
          engagement_rate: metric.engagement_rate,
          created_at: post?.created_at ?? metric.fetched_at,
        };
      });
    }

    // 5. Daily engagement trend (group by date)
    const dailyTrend = new Map<string, { impressions: number; engagement: number; count: number }>();
    for (const metric of uniqueMetrics) {
      const date = (metric.fetched_at as string).slice(0, 10);
      const existing = dailyTrend.get(date) ?? { impressions: 0, engagement: 0, count: 0 };
      existing.impressions += metric.impressions as number ?? 0;
      existing.engagement += metric.engagement_rate as number ?? 0;
      existing.count++;
      dailyTrend.set(date, existing);
    }

    const trend = Array.from(dailyTrend.entries())
      .map(([date, data]) => ({
        date,
        impressions: data.impressions,
        avg_engagement: data.count > 0 ? data.engagement / data.count : 0,
        posts: data.count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 6. Platform breakdown
    const platformBreakdown = new Map<string, { posts: number; impressions: number; avgEngagement: number; totalEngagement: number }>();
    for (const metric of uniqueMetrics) {
      const plat = metric.platform as string;
      const existing = platformBreakdown.get(plat) ?? { posts: 0, impressions: 0, avgEngagement: 0, totalEngagement: 0 };
      existing.posts++;
      existing.impressions += metric.impressions as number ?? 0;
      existing.totalEngagement += metric.engagement_rate as number ?? 0;
      platformBreakdown.set(plat, existing);
    }

    const platforms = Array.from(platformBreakdown.entries()).map(([platform, data]) => ({
      platform,
      posts: data.posts,
      impressions: data.impressions,
      avg_engagement: data.posts > 0 ? data.totalEngagement / data.posts : 0,
    }));

    // 7. Queue status
    const { data: queueCounts } = await supabase
      .from("content_queue")
      .select("status")
      .eq("user_id", user.id);

    const queueStatus: Record<string, number> = {};
    for (const row of (queueCounts ?? []) as Record<string, unknown>[]) {
      const status = row.status as string;
      queueStatus[status] = (queueStatus[status] ?? 0) + 1;
    }

    return NextResponse.json({
      period: { days, since },
      overview: {
        total_posts: totalPosts,
        total_impressions: totalImpressions,
        total_likes: totalLikes,
        total_replies: totalReplies,
        total_reposts: totalReposts,
        avg_engagement_rate: avgEngagement,
      },
      top_posts: topPosts,
      daily_trend: trend,
      platforms,
      queue_status: queueStatus,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analytics fetch failed" },
      { status: 500 }
    );
  }
}
