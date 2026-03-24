/**
 * Cron: Creator Analytics — runs every 6 hours via Vercel Cron.
 *
 * 1. Pulls metrics for all posts from the last 30 days via platform APIs
 * 2. Calculates engagement rate per post
 * 3. Upserts into post_analytics
 * 4. Generates goal_signals for the Content pillar
 * 5. Embeds top/bottom performers into semantic memory
 *
 * Auth: Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdapter } from "@/lib/creator/platforms";
import { embedAndStore } from "@/lib/embedding/pipeline";
import { logError } from "@/lib/logger";

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

export async function GET(request: NextRequest) {
  // Auth
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const userId = TYLER_USER_ID;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  try {
    // 1. Find all posted content in the last 30 days
    const { data: posts, error: postsError } = await supabase
      .from("content_queue")
      .select("id, platform, post_id, body, created_at")
      .eq("user_id", userId)
      .eq("status", "posted")
      .not("post_id", "is", null)
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false });

    if (postsError) {
      throw new Error(`Failed to fetch posts: ${postsError.message}`);
    }

    if (!posts?.length) {
      return NextResponse.json({ ok: true, message: "No posts to analyze", processed: 0 });
    }

    // 2. Get platform tokens
    const platforms = [...new Set(posts.map((p: Record<string, unknown>) => p.platform as string))];
    const { data: tokens } = await supabase
      .from("platform_tokens")
      .select("platform, access_token, platform_user_id")
      .eq("user_id", userId)
      .in("platform", platforms);

    const tokenMap = new Map(
      (tokens ?? []).map((t: Record<string, unknown>) => [
        t.platform as string,
        { accessToken: t.access_token as string, platformUserId: t.platform_user_id as string },
      ])
    );

    // 3. Fetch metrics for each post
    let processed = 0;
    let errors = 0;
    const allMetrics: Array<{
      contentQueueId: string;
      platform: string;
      postId: string;
      body: string;
      impressions: number;
      likes: number;
      replies: number;
      reposts: number;
      quotes: number;
      engagementRate: number;
    }> = [];

    for (const post of posts) {
      const token = tokenMap.get(post.platform as string);
      if (!token) continue;

      try {
        const adapter = getPlatformAdapter(post.platform as string);
        const metrics = await adapter.getPostMetrics({
          accessToken: token.accessToken,
          postId: post.post_id as string,
        });

        // Calculate engagement rate: (likes + replies + reposts + quotes) / impressions
        const totalEngagement = metrics.likes + metrics.replies + metrics.reposts + metrics.quotes;
        const engagementRate = metrics.impressions > 0
          ? totalEngagement / metrics.impressions
          : 0;

        const now = new Date().toISOString();

        // Upsert analytics row
        const { error: upsertError } = await supabase
          .from("post_analytics")
          .upsert(
            {
              user_id: userId,
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
              fetched_at: now,
            },
            { onConflict: "platform,post_id,fetched_at" }
          );

        if (upsertError) {
          logError("cron.creator-analytics.upsert", upsertError, { postId: post.post_id });
          errors++;
        } else {
          allMetrics.push({
            contentQueueId: post.id as string,
            platform: post.platform as string,
            postId: post.post_id as string,
            body: post.body as string,
            impressions: metrics.impressions,
            likes: metrics.likes,
            replies: metrics.replies,
            reposts: metrics.reposts,
            quotes: metrics.quotes,
            engagementRate,
          });
          processed++;
        }
      } catch (err) {
        logError("cron.creator-analytics.fetch", err, { postId: post.post_id });
        errors++;
      }
    }

    // 4. Generate goal signals for Content pillar
    if (allMetrics.length >= 3) {
      await generateContentGoalSignals(supabase, userId, allMetrics);
    }

    // 5. Embed top/bottom performers into semantic memory
    if (allMetrics.length >= 5) {
      await embedPerformanceMemories(userId, allMetrics);
    }

    return NextResponse.json({
      ok: true,
      processed,
      errors,
      totalPosts: posts.length,
    });
  } catch (error) {
    logError("cron.creator-analytics", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analytics failed" },
      { status: 500 }
    );
  }
}

/**
 * Generate goal_signals for the Content pillar based on analytics trends.
 */
async function generateContentGoalSignals(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  metrics: Array<{
    engagementRate: number;
    impressions: number;
    likes: number;
    replies: number;
  }>
) {
  // Find the Content pillar goal (look for any active goal with "content" or "creator" in title)
  const { data: contentGoals } = await supabase
    .from("goals")
    .select("id, title")
    .eq("user_id", userId)
    .eq("status", "active")
    .or("title.ilike.%content%,title.ilike.%creator%,title.ilike.%threads%,title.ilike.%social%")
    .limit(1);

  const goalId = contentGoals?.[0]?.id;
  if (!goalId) return; // No content-related goal found

  const avgEngagement = metrics.reduce((sum, m) => sum + m.engagementRate, 0) / metrics.length;
  const totalImpressions = metrics.reduce((sum, m) => sum + m.impressions, 0);
  const totalLikes = metrics.reduce((sum, m) => sum + m.likes, 0);
  const totalReplies = metrics.reduce((sum, m) => sum + m.replies, 0);

  // Determine sentiment based on engagement rate
  let sentiment: "positive" | "neutral" | "negative";
  let content: string;
  let impactScore: number;

  if (avgEngagement >= 0.05) {
    sentiment = "positive";
    content = `Content performing well — ${(avgEngagement * 100).toFixed(1)}% avg engagement across ${metrics.length} posts. ${totalImpressions.toLocaleString()} impressions, ${totalLikes} likes, ${totalReplies} replies.`;
    impactScore = 0.8;
  } else if (avgEngagement >= 0.02) {
    sentiment = "neutral";
    content = `Content engagement steady at ${(avgEngagement * 100).toFixed(1)}% across ${metrics.length} posts. ${totalImpressions.toLocaleString()} impressions. Room to improve reply rate (${totalReplies} replies).`;
    impactScore = 0.5;
  } else {
    sentiment = "negative";
    content = `Content engagement below target — ${(avgEngagement * 100).toFixed(1)}% avg across ${metrics.length} posts. Only ${totalImpressions.toLocaleString()} impressions. Consider adjusting content strategy or posting times.`;
    impactScore = 0.7;
  }

  await supabase.from("goal_signals").insert({
    user_id: userId,
    goal_id: goalId,
    signal_type: "social_post",
    content,
    sentiment,
    impact_score: impactScore,
    raw_data: {
      avg_engagement: avgEngagement,
      total_impressions: totalImpressions,
      total_likes: totalLikes,
      total_replies: totalReplies,
      post_count: metrics.length,
      fetched_at: new Date().toISOString(),
    },
  });
}

/**
 * Embed top and bottom performing posts into semantic memory.
 * Top 20% get tagged as "content:winner", bottom 20% as "content:underperformer".
 */
async function embedPerformanceMemories(
  userId: string,
  metrics: Array<{
    contentQueueId: string;
    body: string;
    engagementRate: number;
    impressions: number;
    likes: number;
    platform: string;
  }>
) {
  const sorted = [...metrics].sort((a, b) => b.engagementRate - a.engagementRate);
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.2));
  const bottomCount = Math.max(1, Math.ceil(sorted.length * 0.2));

  const topPosts = sorted.slice(0, topCount);
  const bottomPosts = sorted.slice(-bottomCount);

  // Embed top performers
  for (const post of topPosts) {
    const content = `[TOP PERFORMING ${post.platform.toUpperCase()} POST]\nEngagement: ${(post.engagementRate * 100).toFixed(1)}% | Impressions: ${post.impressions} | Likes: ${post.likes}\n\n${post.body}`;

    try {
      await embedAndStore(content, {
        userId,
        source: "manual",
        sourceId: `creator-analytics:${post.contentQueueId}`,
        category: "general",
        importance: 8,
        tags: ["content:winner", `platform:${post.platform}`, "creator-os"],
      });
    } catch (err) {
      logError("creator-analytics.embed-winner", err, { postId: post.contentQueueId });
    }
  }

  // Embed bottom performers
  for (const post of bottomPosts) {
    const content = `[UNDERPERFORMING ${post.platform.toUpperCase()} POST]\nEngagement: ${(post.engagementRate * 100).toFixed(1)}% | Impressions: ${post.impressions} | Likes: ${post.likes}\n\n${post.body}`;

    try {
      await embedAndStore(content, {
        userId,
        source: "manual",
        sourceId: `creator-analytics:${post.contentQueueId}`,
        category: "general",
        importance: 6,
        tags: ["content:underperformer", `platform:${post.platform}`, "creator-os"],
      });
    } catch (err) {
      logError("creator-analytics.embed-underperformer", err, { postId: post.contentQueueId });
    }
  }
}
