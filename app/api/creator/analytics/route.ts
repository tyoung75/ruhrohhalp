/**
 * Creator Analytics Dashboard
 *
 * GET  /api/creator/analytics — Returns aggregated analytics data
 * POST /api/creator/analytics — Triggers ad-hoc analytics refresh (re-fetches metrics from platform APIs)
 *
 * Query params (GET):
 *   ?days=30  (default 30, max 90)
 *   ?platform=threads  (optional filter)
 *
 * Auth: Authenticated user session.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdapter } from "@/lib/creator/platforms";
import { limitByKey } from "@/lib/security/rate-limit";

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
        .select("id, body, platform, content_type, source, model_source, created_at")
        .in("id", topPostIds);

      topPosts = sorted.slice(0, 5).map((metric) => {
        const post = (postBodies ?? []).find(
          (p: Record<string, unknown>) => p.id === metric.content_queue_id
        );
        return {
          content_queue_id: metric.content_queue_id,
          body: (post?.body as string)?.slice(0, 280) ?? "",
          platform: metric.platform,
          source: post?.source ?? "creator_os",
          model_source: (post?.model_source as string) ?? null,
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

    // 7. Source breakdown (creator_os vs external)
    const allQueueIds = uniqueMetrics
      .map((m) => m.content_queue_id)
      .filter(Boolean) as string[];

    let sourceBreakdown: Record<string, { posts: number; impressions: number; avgEngagement: number }> = {};
    if (allQueueIds.length) {
      const { data: sourcePosts } = await supabase
        .from("content_queue")
        .select("id, source")
        .in("id", allQueueIds);

      const sourceMap = new Map(
        (sourcePosts ?? []).map((p: Record<string, unknown>) => [p.id as string, (p.source as string) ?? "creator_os"])
      );

      const sourceBuckets = new Map<string, { posts: number; impressions: number; totalEngagement: number }>();
      for (const metric of uniqueMetrics) {
        const src = sourceMap.get(metric.content_queue_id as string) ?? "creator_os";
        const existing = sourceBuckets.get(src) ?? { posts: 0, impressions: 0, totalEngagement: 0 };
        existing.posts++;
        existing.impressions += (metric.impressions as number) ?? 0;
        existing.totalEngagement += (metric.engagement_rate as number) ?? 0;
        sourceBuckets.set(src, existing);
      }

      sourceBreakdown = Object.fromEntries(
        Array.from(sourceBuckets.entries()).map(([src, data]) => [
          src,
          {
            posts: data.posts,
            impressions: data.impressions,
            avgEngagement: data.posts > 0 ? data.totalEngagement / data.posts : 0,
          },
        ])
      );
    }

    // 8. Model breakdown (performance by generating model)
    let modelBreakdown: Record<string, { posts: number; impressions: number; avgEngagement: number }> = {};
    if (allQueueIds.length) {
      const { data: modelPosts } = await supabase
        .from("content_queue")
        .select("id, model_source")
        .in("id", allQueueIds);

      const modelMap = new Map(
        (modelPosts ?? []).map((p: Record<string, unknown>) => [p.id as string, (p.model_source as string) ?? "unknown"])
      );

      const modelBuckets = new Map<string, { posts: number; impressions: number; totalEngagement: number }>();
      for (const metric of uniqueMetrics) {
        const model = modelMap.get(metric.content_queue_id as string) ?? "unknown";
        const existing = modelBuckets.get(model) ?? { posts: 0, impressions: 0, totalEngagement: 0 };
        existing.posts++;
        existing.impressions += (metric.impressions as number) ?? 0;
        existing.totalEngagement += (metric.engagement_rate as number) ?? 0;
        modelBuckets.set(model, existing);
      }

      modelBreakdown = Object.fromEntries(
        Array.from(modelBuckets.entries()).map(([model, data]) => [
          model,
          {
            posts: data.posts,
            impressions: data.impressions,
            avgEngagement: data.posts > 0 ? data.totalEngagement / data.posts : 0,
          },
        ])
      );
    }

    // 9. Per-post analytics lookup (for History tab — all posts, not just top 5)
    const allPostAnalytics = uniqueMetrics.map((m) => ({
      content_queue_id: m.content_queue_id,
      platform: m.platform,
      impressions: m.impressions,
      likes: m.likes,
      replies: m.replies,
      reposts: m.reposts,
      engagement_rate: m.engagement_rate,
    }));

    // 10. Queue status
    const { data: queueCounts } = await supabase
      .from("content_queue")
      .select("status")
      .eq("user_id", user.id);

    const queueStatus: Record<string, number> = {};
    for (const row of (queueCounts ?? []) as Record<string, unknown>[]) {
      const status = row.status as string;
      queueStatus[status] = (queueStatus[status] ?? 0) + 1;
    }

    // 11. Most recent analytics pull timestamp
    const { data: latestFetch } = await supabase
      .from("post_analytics")
      .select("fetched_at")
      .eq("user_id", user.id)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .single();

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
      all_post_analytics: allPostAnalytics,
      source_breakdown: sourceBreakdown,
      model_breakdown: modelBreakdown,
      daily_trend: trend,
      platforms,
      queue_status: queueStatus,
      last_fetched_at: (latestFetch?.fetched_at as string) ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analytics fetch failed" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Ad-hoc analytics refresh (re-fetch metrics from platform APIs)
// ---------------------------------------------------------------------------

export async function POST() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  // Rate limit: 5 refreshes per hour
  const { ok } = limitByKey(`creator-analytics-refresh:${user.id}`, 5, 60 * 60 * 1000);
  if (!ok) {
    return NextResponse.json(
      { error: "Rate limited. Max 5 analytics refreshes per hour." },
      { status: 429 }
    );
  }

  const supabase = createAdminClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  try {
    // Find all posted content in the last 30 days
    const { data: posts, error: postsError } = await supabase
      .from("content_queue")
      .select("id, platform, post_id, body")
      .eq("user_id", user.id)
      .eq("status", "posted")
      .not("post_id", "is", null)
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false });

    if (postsError) throw new Error(`Failed to fetch posts: ${postsError.message}`);
    if (!posts?.length) {
      return NextResponse.json({ processed: 0, errors: 0, message: "No posts to refresh" });
    }

    // Get platform tokens
    const platforms = [...new Set(posts.map((p: Record<string, unknown>) => p.platform as string))];
    const { data: tokens } = await supabase
      .from("platform_tokens")
      .select("platform, access_token, platform_user_id")
      .eq("user_id", user.id)
      .in("platform", platforms);

    const tokenMap = new Map<string, { accessToken: string; platformUserId: string }>(
      (tokens ?? []).map((t: Record<string, unknown>) => [
        t.platform as string,
        { accessToken: t.access_token as string, platformUserId: t.platform_user_id as string },
      ])
    );

    // Ensure YouTube is in tokenMap even without a platform_tokens entry (API-key-only)
    if (!tokenMap.has("youtube") && process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_CHANNEL_ID) {
      tokenMap.set("youtube", { accessToken: "", platformUserId: process.env.YOUTUBE_CHANNEL_ID });
    }

    let processed = 0;
    let errors = 0;

    for (const post of posts) {
      const token = tokenMap.get(post.platform as string);
      if (!token) continue;

      try {
        const adapter = getPlatformAdapter(post.platform as string);
        const metrics = await adapter.getPostMetrics({
          accessToken: token.accessToken,
          postId: post.post_id as string,
        });

        const totalEngagement = metrics.likes + metrics.replies + metrics.reposts + metrics.quotes;
        const engagementRate = metrics.impressions > 0 ? totalEngagement / metrics.impressions : 0;

        await supabase.from("post_analytics").upsert(
          {
            user_id: user.id,
            content_queue_id: post.id,
            platform: post.platform,
            post_id: post.post_id,
            impressions: metrics.impressions,
            likes: metrics.likes,
            replies: metrics.replies,
            reposts: metrics.reposts,
            quotes: metrics.quotes,
            follows_gained: metrics.followsGained,
            engagement_rate: engagementRate,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "platform,post_id,fetched_at" }
        );

        processed++;
      } catch {
        errors++;
      }
    }

    return NextResponse.json({ processed, errors, totalPosts: posts.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analytics refresh failed" },
      { status: 500 }
    );
  }
}
