/**
 * POST /api/creator/analytics/refresh
 *
 * Ad-hoc trigger to refresh analytics and follower snapshots.
 * Does the same work as the cron job but on-demand.
 * Rate limited to 3 per hour.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdapter } from "@/lib/creator/platforms";
import { snapshotFollowerCounts } from "@/lib/creator/followers";
import { limitByKey } from "@/lib/security/rate-limit";
import { logError } from "@/lib/logger";

export async function POST() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  // Rate limit: 3 refreshes per hour
  const { ok } = limitByKey(`creator-analytics-refresh:${user.id}`, 3, 60 * 60 * 1000);
  if (!ok) {
    return NextResponse.json(
      { error: "Rate limited. Max 3 analytics refreshes per hour." },
      { status: 429 }
    );
  }

  const supabase = createAdminClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  try {
    // 1. Refresh post analytics
    const { data: posts } = await supabase
      .from("content_queue")
      .select("id, platform, post_id, body, created_at")
      .eq("user_id", user.id)
      .eq("status", "posted")
      .not("post_id", "is", null)
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false });

    const platforms = [...new Set((posts ?? []).map((p: Record<string, unknown>) => p.platform as string))];
    const { data: tokens } = await supabase
      .from("platform_tokens")
      .select("platform, access_token, platform_user_id")
      .eq("user_id", user.id)
      .in("platform", platforms.length ? platforms : ["__none__"]);

    const tokenMap = new Map<string, { accessToken: string; platformUserId: string }>(
      (tokens ?? []).map((t: Record<string, unknown>) => [
        t.platform as string,
        { accessToken: t.access_token as string, platformUserId: t.platform_user_id as string },
      ])
    );

    let analyticsProcessed = 0;
    let analyticsErrors = 0;

    for (const post of posts ?? []) {
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

        analyticsProcessed++;
      } catch (err) {
        logError("analytics-refresh.fetch", err, { postId: post.post_id });
        analyticsErrors++;
      }
    }

    // 2. Refresh follower snapshots across ALL connected platforms
    const followerResult = await snapshotFollowerCounts(user.id);

    return NextResponse.json({
      success: true,
      analytics: { processed: analyticsProcessed, errors: analyticsErrors, totalPosts: posts?.length ?? 0 },
      followers: { snapshots: followerResult.snapshots, errors: followerResult.errors },
    });
  } catch (error) {
    logError("analytics-refresh", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analytics refresh failed" },
      { status: 500 }
    );
  }
}
