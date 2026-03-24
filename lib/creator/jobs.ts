/**
 * Creator OS background jobs — extracted from cron routes.
 *
 * These functions are called by the unified /api/cron route (daily)
 * and can also be triggered on-demand from the Creator UI.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdapter } from "@/lib/creator/platforms";
import { embedAndStore } from "@/lib/embedding/pipeline";
import { logError } from "@/lib/logger";

type AdminClient = ReturnType<typeof createAdminClient>;

// ---------------------------------------------------------------------------
// Publish queued posts
// ---------------------------------------------------------------------------

export async function publishQueuedPosts(
  userId: string,
  maxPosts = 10
): Promise<{ published: number; failed: number; results: Array<{ id: string; success: boolean; error?: string }> }> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data: posts, error: fetchError } = await supabase
    .from("content_queue")
    .select("*")
    .eq("status", "queued")
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(maxPosts);

  if (fetchError || !posts?.length) {
    return { published: 0, failed: 0, results: [] };
  }

  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  for (const post of posts) {
    await supabase
      .from("content_queue")
      .update({ status: "posting", updated_at: new Date().toISOString() })
      .eq("id", post.id);

    const { data: token } = await supabase
      .from("platform_tokens")
      .select("access_token, platform_user_id, expires_at")
      .eq("user_id", post.user_id)
      .eq("platform", post.platform)
      .single();

    if (!token || (token.expires_at && new Date(token.expires_at) < new Date())) {
      await supabase
        .from("content_queue")
        .update({
          status: "failed",
          last_error: token ? "Token expired" : "No token found",
          attempts: post.attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", post.id);
      results.push({ id: post.id, success: false, error: "Token issue" });
      continue;
    }

    try {
      const adapter = getPlatformAdapter(post.platform);
      const result = await adapter.publish({
        accessToken: token.access_token,
        userId: token.platform_user_id,
        body: post.body,
        mediaUrls: post.media_urls,
        contentType: post.content_type,
      });

      if (result.success) {
        await supabase
          .from("content_queue")
          .update({
            status: "posted",
            post_id: result.postId,
            post_url: result.postUrl,
            attempts: post.attempts + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", post.id);
        results.push({ id: post.id, success: true });
      } else {
        const newAttempts = post.attempts + 1;
        const maxedOut = newAttempts >= (post.max_attempts ?? 3);
        await supabase
          .from("content_queue")
          .update({
            status: maxedOut ? "failed" : "queued",
            last_error: result.error,
            attempts: newAttempts,
            scheduled_for: maxedOut
              ? post.scheduled_for
              : new Date(Date.now() + 5 * 60 * 1000 * Math.pow(5, newAttempts - 1)).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", post.id);
        results.push({ id: post.id, success: false, error: result.error });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      await supabase
        .from("content_queue")
        .update({
          status: "queued",
          last_error: errorMsg,
          attempts: post.attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", post.id);
      results.push({ id: post.id, success: false, error: errorMsg });
    }
  }

  return {
    published: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

// ---------------------------------------------------------------------------
// Refresh expiring tokens
// ---------------------------------------------------------------------------

export async function refreshExpiringTokens(): Promise<{ refreshed: number; failed: number }> {
  const supabase = createAdminClient();
  const sevenDaysFromNow = new Date(Date.now() + 7 * 86400000).toISOString();

  const { data: expiringTokens, error } = await supabase
    .from("platform_tokens")
    .select("id, user_id, platform, access_token, expires_at")
    .not("expires_at", "is", null)
    .lt("expires_at", sevenDaysFromNow)
    .order("expires_at", { ascending: true });

  if (error || !expiringTokens?.length) {
    return { refreshed: 0, failed: 0 };
  }

  let refreshed = 0;
  let failed = 0;

  for (const token of expiringTokens) {
    try {
      const adapter = getPlatformAdapter(token.platform as string);
      const refreshResult = await adapter.refreshLongLivedToken(token.access_token as string);

      const newExpiresAt = refreshResult.expiresIn
        ? new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString()
        : null;

      await supabase
        .from("platform_tokens")
        .update({
          access_token: refreshResult.accessToken,
          token_type: refreshResult.tokenType,
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", token.id);

      refreshed++;
    } catch (err) {
      failed++;
      logError("jobs.refresh-tokens", err, { tokenId: token.id, platform: token.platform });
    }
  }

  return { refreshed, failed };
}

// ---------------------------------------------------------------------------
// Collect analytics
// ---------------------------------------------------------------------------

export async function collectAnalytics(
  userId: string
): Promise<{ processed: number; errors: number }> {
  const supabase = createAdminClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data: posts } = await supabase
    .from("content_queue")
    .select("id, platform, post_id, body, created_at")
    .eq("user_id", userId)
    .eq("status", "posted")
    .not("post_id", "is", null)
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: false });

  if (!posts?.length) return { processed: 0, errors: 0 };

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

  let processed = 0;
  let errors = 0;
  const allMetrics: Array<{
    contentQueueId: string;
    body: string;
    platform: string;
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

      const totalEngagement = metrics.likes + metrics.replies + metrics.reposts + metrics.quotes;
      const engagementRate = metrics.impressions > 0 ? totalEngagement / metrics.impressions : 0;

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
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "platform,post_id,fetched_at" }
        );

      if (upsertError) {
        errors++;
      } else {
        allMetrics.push({
          contentQueueId: post.id as string,
          body: post.body as string,
          platform: post.platform as string,
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
      logError("jobs.analytics.fetch", err, { postId: post.post_id });
      errors++;
    }
  }

  // Goal signals
  if (allMetrics.length >= 3) {
    await generateContentGoalSignals(supabase, userId, allMetrics);
  }

  // Embed top/bottom performers
  if (allMetrics.length >= 5) {
    await embedPerformanceMemories(userId, allMetrics);
  }

  return { processed, errors };
}

// ---------------------------------------------------------------------------
// Helpers (goal signals + memory embedding)
// ---------------------------------------------------------------------------

async function generateContentGoalSignals(
  supabase: AdminClient,
  userId: string,
  metrics: Array<{ engagementRate: number; impressions: number; likes: number; replies: number }>
) {
  const { data: contentGoals } = await supabase
    .from("goals")
    .select("id, title")
    .eq("user_id", userId)
    .eq("status", "active")
    .or("title.ilike.%content%,title.ilike.%creator%,title.ilike.%threads%,title.ilike.%social%")
    .limit(1);

  const goalId = contentGoals?.[0]?.id;
  if (!goalId) return;

  const avgEngagement = metrics.reduce((sum, m) => sum + m.engagementRate, 0) / metrics.length;
  const totalImpressions = metrics.reduce((sum, m) => sum + m.impressions, 0);
  const totalLikes = metrics.reduce((sum, m) => sum + m.likes, 0);
  const totalReplies = metrics.reduce((sum, m) => sum + m.replies, 0);

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

async function embedPerformanceMemories(
  userId: string,
  metrics: Array<{ contentQueueId: string; body: string; engagementRate: number; impressions: number; likes: number; platform: string }>
) {
  const sorted = [...metrics].sort((a, b) => b.engagementRate - a.engagementRate);
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.2));
  const bottomCount = Math.max(1, Math.ceil(sorted.length * 0.2));

  for (const post of sorted.slice(0, topCount)) {
    try {
      await embedAndStore(
        `[TOP PERFORMING ${post.platform.toUpperCase()} POST]\nEngagement: ${(post.engagementRate * 100).toFixed(1)}% | Impressions: ${post.impressions} | Likes: ${post.likes}\n\n${post.body}`,
        {
          userId,
          source: "manual",
          sourceId: `creator-analytics:${post.contentQueueId}`,
          category: "general",
          importance: 8,
          tags: ["content:winner", `platform:${post.platform}`, "creator-os"],
        }
      );
    } catch (err) {
      logError("jobs.embed-winner", err, { postId: post.contentQueueId });
    }
  }

  for (const post of sorted.slice(-bottomCount)) {
    try {
      await embedAndStore(
        `[UNDERPERFORMING ${post.platform.toUpperCase()} POST]\nEngagement: ${(post.engagementRate * 100).toFixed(1)}% | Impressions: ${post.impressions} | Likes: ${post.likes}\n\n${post.body}`,
        {
          userId,
          source: "manual",
          sourceId: `creator-analytics:${post.contentQueueId}`,
          category: "general",
          importance: 6,
          tags: ["content:underperformer", `platform:${post.platform}`, "creator-os"],
        }
      );
    } catch (err) {
      logError("jobs.embed-underperformer", err, { postId: post.contentQueueId });
    }
  }
}
