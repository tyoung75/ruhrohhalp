/**
 * Follower tracking — daily snapshots with advanced KPIs.
 *
 * Called by the daily cron to snapshot follower counts for each connected
 * platform and compute engagement/growth KPIs from recent post_analytics.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdapter } from "./platforms";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FollowerSnapshot {
  platform: string;
  followers: number;
  following: number;
  posts_count: number;
  engagement_rate: number | null;
  reach_rate: number | null;
  virality_rate: number | null;
  reply_rate: number | null;
  non_follower_pct: number | null;
  avg_impressions_per_post: number | null;
  follower_growth_rate: number | null;
  extra: Record<string, unknown>;
  fetched_at: string;
}

export interface FollowerSummary {
  total: number;
  byPlatform: Record<string, {
    current: number;
    delta7d: number;
    delta30d: number;
    growthRate7d: number;
    growthRate30d: number;
    engagementRate: number | null;
    reachRate: number | null;
    viralityRate: number | null;
    nonFollowerPct: number | null;
    avgImpressionsPerPost: number | null;
  }>;
  sparklines: Record<string, Array<{ date: string; followers: number }>>;
}

// ---------------------------------------------------------------------------
// Snapshot follower counts (daily cron)
// ---------------------------------------------------------------------------

export async function snapshotFollowerCounts(userId: string): Promise<{
  snapshots: number;
  errors: string[];
}> {
  const supabase = createAdminClient();
  const errors: string[] = [];
  let snapshots = 0;

  // Get all connected platform tokens
  const { data: tokens } = await supabase
    .from("platform_tokens")
    .select("platform, access_token, platform_user_id")
    .eq("user_id", userId);

  // Build a unified list: platform_tokens entries + API-key-only platforms (YouTube)
  const platformEntries: Array<{ platform: string; access_token: string; platform_user_id: string }> =
    (tokens ?? []).map((t) => ({
      platform: t.platform as string,
      access_token: t.access_token as string,
      platform_user_id: t.platform_user_id as string,
    }));

  // Add YouTube if API key is configured and not already in platform_tokens
  const hasYouTubeToken = platformEntries.some((t) => t.platform === "youtube");
  if (!hasYouTubeToken && process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_CHANNEL_ID) {
    platformEntries.push({
      platform: "youtube",
      access_token: "", // YouTube adapter uses API key from env, not OAuth token
      platform_user_id: process.env.YOUTUBE_CHANNEL_ID,
    });
  }

  if (!platformEntries.length) return { snapshots: 0, errors: ["No platform tokens found"] };

  for (const token of platformEntries) {
    try {
      const adapter = getPlatformAdapter(token.platform);
      const profile = await adapter.getProfile({
        accessToken: token.access_token,
        userId: token.platform_user_id,
      });

      // Compute advanced KPIs from recent post_analytics
      const kpis = await computeKPIs(supabase, userId, token.platform, profile.followers);

      // Get previous snapshot for growth rate
      const { data: prevSnapshot } = await supabase
        .from("follower_snapshots")
        .select("followers")
        .eq("user_id", userId)
        .eq("platform", token.platform)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .single();

      const growthRate = prevSnapshot
        ? prevSnapshot.followers > 0
          ? (profile.followers - prevSnapshot.followers) / prevSnapshot.followers
          : 0
        : null;

      const { error } = await supabase.from("follower_snapshots").upsert(
        {
          user_id: userId,
          platform: token.platform,
          followers: profile.followers,
          following: profile.following,
          posts_count: profile.postsCount,
          engagement_rate: kpis.engagementRate,
          reach_rate: kpis.reachRate,
          virality_rate: kpis.viralityRate,
          reply_rate: kpis.replyRate,
          non_follower_pct: kpis.nonFollowerPct,
          avg_impressions_per_post: kpis.avgImpressionsPerPost,
          follower_growth_rate: growthRate,
          extra: profile.extras ?? {},
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform,fetched_at::date" }
      );

      if (error) {
        // Upsert on expression index might not work — try insert instead
        const { error: insertError } = await supabase.from("follower_snapshots").insert({
          user_id: userId,
          platform: token.platform,
          followers: profile.followers,
          following: profile.following,
          posts_count: profile.postsCount,
          engagement_rate: kpis.engagementRate,
          reach_rate: kpis.reachRate,
          virality_rate: kpis.viralityRate,
          reply_rate: kpis.replyRate,
          non_follower_pct: kpis.nonFollowerPct,
          avg_impressions_per_post: kpis.avgImpressionsPerPost,
          follower_growth_rate: growthRate,
          extra: profile.extras ?? {},
          fetched_at: new Date().toISOString(),
        });
        if (insertError) {
          errors.push(`${token.platform}: ${insertError.message}`);
          continue;
        }
      }

      snapshots++;
    } catch (err) {
      errors.push(`${token.platform}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  return { snapshots, errors };
}

// ---------------------------------------------------------------------------
// Compute advanced KPIs from post_analytics
// ---------------------------------------------------------------------------

interface KPIs {
  engagementRate: number | null;
  reachRate: number | null;
  viralityRate: number | null;
  replyRate: number | null;
  nonFollowerPct: number | null;
  avgImpressionsPerPost: number | null;
}

async function computeKPIs(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  platform: string,
  followers: number
): Promise<KPIs> {
  // Fetch recent analytics (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: analytics } = await supabase
    .from("post_analytics")
    .select("impressions, likes, replies, reposts, quotes, engagement_rate")
    .eq("user_id", userId)
    .eq("platform", platform)
    .gte("fetched_at", thirtyDaysAgo);

  if (!analytics?.length) {
    return {
      engagementRate: null,
      reachRate: null,
      viralityRate: null,
      replyRate: null,
      nonFollowerPct: null,
      avgImpressionsPerPost: null,
    };
  }

  const count = analytics.length;
  const totals = analytics.reduce(
    (acc, a) => ({
      impressions: acc.impressions + (a.impressions ?? 0),
      likes: acc.likes + (a.likes ?? 0),
      replies: acc.replies + (a.replies ?? 0),
      reposts: acc.reposts + (a.reposts ?? 0),
      quotes: acc.quotes + (a.quotes ?? 0),
    }),
    { impressions: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 }
  );

  const totalEngagement = totals.likes + totals.replies + totals.reposts + totals.quotes;
  const avgImpressions = totals.impressions / count;

  return {
    // Engagement rate: total engagement / total impressions
    engagementRate: totals.impressions > 0
      ? Math.round((totalEngagement / totals.impressions) * 10000) / 10000
      : null,
    // Reach rate: avg impressions / followers (how much of audience you reach)
    reachRate: followers > 0
      ? Math.round((avgImpressions / followers) * 10000) / 10000
      : null,
    // Virality: (reposts + quotes) / impressions
    viralityRate: totals.impressions > 0
      ? Math.round(((totals.reposts + totals.quotes) / totals.impressions) * 10000) / 10000
      : null,
    // Reply rate: replies / impressions
    replyRate: totals.impressions > 0
      ? Math.round((totals.replies / totals.impressions) * 10000) / 10000
      : null,
    // Non-follower %: (impressions - followers) / impressions (rough proxy)
    nonFollowerPct: followers > 0 && avgImpressions > followers
      ? Math.round(((avgImpressions - followers) / avgImpressions) * 10000) / 10000
      : null,
    // Avg impressions per post
    avgImpressionsPerPost: Math.round(avgImpressions),
  };
}

// ---------------------------------------------------------------------------
// Query follower data for dashboard
// ---------------------------------------------------------------------------

export async function getFollowerSummary(userId: string): Promise<FollowerSummary> {
  const supabase = createAdminClient();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

  // All snapshots from last 30 days
  const { data: snapshots } = await supabase
    .from("follower_snapshots")
    .select("*")
    .eq("user_id", userId)
    .gte("fetched_at", thirtyDaysAgo)
    .order("fetched_at", { ascending: true });

  if (!snapshots?.length) {
    return { total: 0, byPlatform: {}, sparklines: {} };
  }

  // Group by platform
  const byPlatform: Record<string, typeof snapshots> = {};
  for (const s of snapshots) {
    if (!byPlatform[s.platform]) byPlatform[s.platform] = [];
    byPlatform[s.platform].push(s);
  }

  const summary: FollowerSummary = { total: 0, byPlatform: {}, sparklines: {} };

  for (const [platform, platformSnapshots] of Object.entries(byPlatform)) {
    const latest = platformSnapshots[platformSnapshots.length - 1];
    const current = latest.followers;
    summary.total += current;

    // Find 7-day-ago and 30-day-ago snapshots
    const sevenDaySnapshot = platformSnapshots.find(
      (s) => new Date(s.fetched_at) <= new Date(sevenDaysAgo)
    ) ?? platformSnapshots[0];
    const thirtyDaySnapshot = platformSnapshots[0];

    const delta7d = current - (sevenDaySnapshot?.followers ?? current);
    const delta30d = current - (thirtyDaySnapshot?.followers ?? current);

    summary.byPlatform[platform] = {
      current,
      delta7d,
      delta30d,
      growthRate7d: sevenDaySnapshot?.followers
        ? Math.round((delta7d / sevenDaySnapshot.followers) * 10000) / 100
        : 0,
      growthRate30d: thirtyDaySnapshot?.followers
        ? Math.round((delta30d / thirtyDaySnapshot.followers) * 10000) / 100
        : 0,
      engagementRate: latest.engagement_rate,
      reachRate: latest.reach_rate,
      viralityRate: latest.virality_rate,
      nonFollowerPct: latest.non_follower_pct,
      avgImpressionsPerPost: latest.avg_impressions_per_post,
    };

    // Sparkline data
    summary.sparklines[platform] = platformSnapshots.map((s) => ({
      date: new Date(s.fetched_at).toISOString().split("T")[0],
      followers: s.followers,
    }));
  }

  return summary;
}
