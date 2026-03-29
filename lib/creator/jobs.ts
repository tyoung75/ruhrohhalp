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
// Publish queued posts (smart-ranked, 3/day limit for automated runs)
// ---------------------------------------------------------------------------

/** Default posts per job for automated publishing. Manual "Publish Now" can override. */
const DEFAULT_POSTS_PER_JOB = 2;

/**
 * Score a post for predicted performance.
 *
 * Factors (8 total):
 * 1. Agent confidence score (0-1)    — weighted 15%
 * 2. Content type diversity bonus    — weighted 10%
 * 3. Time-of-day fit                 — weighted 10%
 * 4. Post length sweet spot          — weighted 10%
 * 5. Analytics boost (engagement)    — weighted 10%
 * 6. Freshness (age decay)           — weighted 10%
 * 7. Brand voice alignment           — weighted 20%
 * 8. Timeliness (current events)     — weighted 15%
 */
function scorePost(
  post: Record<string, unknown>,
  alreadySelectedTypes: Set<string>,
  typeEngagement: Map<string, number>,
  medianEngagement: number,
  staleAfterDays: number
): number {
  // 1. Agent confidence (default 0.5 if not scored)
  const confidence = (post.confidence_score as number) ?? 0.5;

  // 2. Type diversity: bonus if we haven't picked this type yet
  const postType = (post.content_type as string) ?? "text";
  const diversityBonus = alreadySelectedTypes.has(postType) ? 0 : 1;

  // 3. Time-of-day fit: posts scheduled closer to peak hours score higher
  // Peak Threads hours (ET): 7-9, 12-13, 17-19, 21-22
  const scheduledHour = post.scheduled_for
    ? new Date(post.scheduled_for as string).getHours()
    : 12;
  const peakHours = [7, 8, 12, 13, 17, 18, 19, 21, 22];
  const timeFit = peakHours.includes(scheduledHour) ? 1 : 0.5;

  // 4. Post length: short punchy posts (50-200 chars) tend to perform best on Threads
  const bodyLen = ((post.body as string) ?? "").length;
  const lengthScore =
    bodyLen >= 50 && bodyLen <= 200 ? 1 :
    bodyLen >= 30 && bodyLen <= 280 ? 0.7 :
    0.4;

  // 5. Analytics boost: if we have historical engagement data for this content_type,
  //    posts of types that average above-median engagement get 1.0, at median get 0.5, below get 0.2
  const typeAvgEngagement = typeEngagement.get(postType) ?? -1;
  const analyticsBoost =
    typeAvgEngagement < 0
      ? 0.5
      : typeAvgEngagement > medianEngagement
        ? 1.0
        : typeAvgEngagement === medianEngagement
          ? 0.5
          : 0.2;

  // 6. Freshness: score = max(0, 1 - (ageInDays / staleAfterDays))
  //    A brand new post gets 1.0, a post at the stale threshold gets 0.0
  const createdAt = post.created_at
    ? new Date(post.created_at as string)
    : new Date();
  const ageInDays = (Date.now() - createdAt.getTime()) / 86400000;
  const freshness = Math.max(0, 1 - ageInDays / staleAfterDays);

  // 7. Brand voice alignment: how well this sounds like Tyler
  //    Scored 0-1 by the generation agent. Default 0.5 if not scored (legacy posts).
  const brandVoice = (post.brand_voice_score as number) ?? 0.5;

  // 8. Timeliness: how relevant to current events / today's context
  //    Scored 0-1 by the generation agent. Default 0.3 for legacy posts (assume evergreen).
  const timeliness = (post.timeliness_score as number) ?? 0.3;

  return (
    confidence * 0.15 +
    diversityBonus * 0.10 +
    timeFit * 0.10 +
    lengthScore * 0.10 +
    analyticsBoost * 0.10 +
    freshness * 0.10 +
    brandVoice * 0.20 +
    timeliness * 0.15
  );
}

/**
 * Select the top N posts from a candidate pool using performance scoring.
 * Greedy selection: pick highest-scored, add its type to the diversity set, re-score, repeat.
 */
function selectTopPosts(
  candidates: Array<Record<string, unknown>>,
  limit: number,
  typeEngagement: Map<string, number>,
  medianEngagement: number,
  staleAfterDays: number
): Array<Record<string, unknown>> {
  const selected: Array<Record<string, unknown>> = [];
  const selectedTypes = new Set<string>();
  const remaining = [...candidates];

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      const score = scorePost(
        remaining[i],
        selectedTypes,
        typeEngagement,
        medianEngagement,
        staleAfterDays
      );
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const picked = remaining.splice(bestIdx, 1)[0];
    selectedTypes.add((picked.content_type as string) ?? "text");
    selected.push(picked);
  }

  return selected;
}

export async function publishQueuedPosts(
  userId: string,
  options: { manual?: boolean; source?: "cron" | "cowork" | "manual"; platformFilter?: string } = {}
): Promise<{
  published: number;
  failed: number;
  skipped: number;
  results: Array<{ id: string; success: boolean; error?: string }>;
}> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  // Fetch user's posts per job and stale threshold from settings
  const { data: settings } = await supabase
    .from("creator_settings")
    .select("posts_per_job, stale_after_days, max_backfill")
    .eq("user_id", userId)
    .single();

  const postsPerJob = settings?.posts_per_job ?? DEFAULT_POSTS_PER_JOB;
  const staleAfterDays = settings?.stale_after_days ?? 7;
  const maxBackfill = settings?.max_backfill ?? 6;

  // Determine remaining slots based on source
  let remainingSlots: number;

  if (options.manual) {
    remainingSlots = 100; // Manual override: no practical limit
  } else if (options.source === "cowork") {
    // Count total posts published today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: totalPublishedToday } = await supabase
      .from("content_queue")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "posted")
      .gte("updated_at", todayStart.toISOString());

    const alreadyPublished = totalPublishedToday ?? 0;
    // Cron gets its own postsPerJob allocation; cowork gets up to maxBackfill total for the day
    // Subtract the cron allocation from total to estimate cowork's contribution
    const estimatedCoworkPublished = Math.max(0, alreadyPublished - postsPerJob);
    const coworkRemaining = Math.max(0, maxBackfill - estimatedCoworkPublished);
    remainingSlots = Math.min(postsPerJob, coworkRemaining);
  } else {
    // Cron source: just use postsPerJob directly
    remainingSlots = postsPerJob;
  }

  if (remainingSlots === 0 && !options.manual) {
    return { published: 0, failed: 0, skipped: 0, results: [] };
  }

  // Pull publish candidates
  // Manual trigger: publish all queued posts regardless of schedule
  // Automated cron: only posts whose scheduled time has arrived
  let query = supabase
    .from("content_queue")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "queued")
    .order("scheduled_for", { ascending: true })
    .limit(50);

  // Filter to specific platform (e.g., "threads") for automated runs
  // Non-Threads content stays in queue as drafts for manual review
  if (options.platformFilter) {
    query = query.eq("platform", options.platformFilter);
  }

  if (!options.manual) {
    query = query.lte("scheduled_for", now);
  }

  const { data: candidates, error: fetchError } = await query;

  if (fetchError || !candidates?.length) {
    return { published: 0, failed: 0, skipped: 0, results: [] };
  }

  // Fetch analytics by content type for smart scoring
  const typeEngagement = new Map<string, number>();
  const { data: typeStats } = await supabase
    .from("post_analytics")
    .select("content_queue_id, engagement_rate")
    .eq("user_id", userId);

  // Join with content_queue to get content_type
  if (typeStats?.length) {
    // Get content types for these posts
    const queueIds = typeStats.map((s: Record<string, unknown>) => s.content_queue_id as string);
    const { data: queuePosts } = await supabase
      .from("content_queue")
      .select("id, content_type")
      .in("id", queueIds);

    if (queuePosts?.length) {
      const typeRates: Record<string, number[]> = {};
      const postTypeMap = new Map(
        queuePosts.map((p: Record<string, unknown>) => [p.id as string, p.content_type as string])
      );
      for (const stat of typeStats) {
        const ct = postTypeMap.get(stat.content_queue_id as string);
        if (ct) {
          if (!typeRates[ct]) typeRates[ct] = [];
          typeRates[ct].push(stat.engagement_rate as number);
        }
      }
      for (const [type, rates] of Object.entries(typeRates)) {
        typeEngagement.set(type, rates.reduce((a, b) => a + b, 0) / rates.length);
      }
    }
  }

  const allEngagements = [...typeEngagement.values()].sort((a, b) => a - b);
  const medianEngagement = allEngagements.length > 0
    ? allEngagements[Math.floor(allEngagements.length / 2)]
    : 0;

  // Smart-rank and select the best posts for this run
  const postsToPublish = options.manual
    ? candidates
    : selectTopPosts(candidates, remainingSlots, typeEngagement, medianEngagement, staleAfterDays);

  const skipped = candidates.length - postsToPublish.length;
  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  for (const post of postsToPublish) {
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
    skipped,
    results,
  };
}

// ---------------------------------------------------------------------------
// Publish a single specific post on demand
// ---------------------------------------------------------------------------

export async function publishSinglePost(
  userId: string,
  postId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();

  // Fetch the post and verify ownership
  const { data: post, error: fetchError } = await supabase
    .from("content_queue")
    .select("*")
    .eq("id", postId)
    .eq("user_id", userId)
    .single();

  if (fetchError || !post) {
    return { success: false, error: "Post not found or access denied" };
  }

  if (post.status === "posted") {
    return { success: false, error: "Post already published" };
  }

  if (post.status === "rejected") {
    return { success: false, error: "Post was rejected" };
  }

  // Mark as posting
  await supabase
    .from("content_queue")
    .update({ status: "posting", updated_at: new Date().toISOString() })
    .eq("id", postId);

  // Get platform token
  const { data: token } = await supabase
    .from("platform_tokens")
    .select("access_token, platform_user_id, expires_at")
    .eq("user_id", userId)
    .eq("platform", post.platform)
    .single();

  if (!token || (token.expires_at && new Date(token.expires_at) < new Date())) {
    await supabase
      .from("content_queue")
      .update({
        status: post.status === "posting" ? "queued" : post.status,
        last_error: token ? "Token expired" : "No token found",
        attempts: (post.attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);
    return { success: false, error: token ? "Token expired" : "No platform token found" };
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
          attempts: (post.attempts ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId);
      return { success: true };
    } else {
      const newAttempts = (post.attempts ?? 0) + 1;
      const maxedOut = newAttempts >= (post.max_attempts ?? 3);
      await supabase
        .from("content_queue")
        .update({
          status: maxedOut ? "failed" : "queued",
          last_error: result.error,
          attempts: newAttempts,
          updated_at: new Date().toISOString(),
        })
        .eq("id", postId);
      return { success: false, error: result.error ?? "Publish failed" };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    await supabase
      .from("content_queue")
      .update({
        status: "queued",
        last_error: errorMsg,
        attempts: (post.attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", postId);
    return { success: false, error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// Sync external posts (manual posts made in-app, not through Creator OS)
// ---------------------------------------------------------------------------

export async function syncExternalPosts(
  userId: string
): Promise<{ imported: number; errors: number }> {
  const supabase = createAdminClient();

  // Get all connected platforms
  const { data: tokens } = await supabase
    .from("platform_tokens")
    .select("platform, access_token, platform_user_id, expires_at")
    .eq("user_id", userId);

  // Build unified list: platform_tokens + API-key-only platforms (YouTube)
  const platformEntries: Array<{ platform: string; access_token: string; platform_user_id: string; expires_at: string | null }> =
    (tokens ?? []).map((t) => ({
      platform: t.platform as string,
      access_token: t.access_token as string,
      platform_user_id: t.platform_user_id as string,
      expires_at: t.expires_at as string | null,
    }));

  const hasYouTubeToken = platformEntries.some((t) => t.platform === "youtube");
  if (!hasYouTubeToken && process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_CHANNEL_ID) {
    platformEntries.push({
      platform: "youtube",
      access_token: "",
      platform_user_id: process.env.YOUTUBE_CHANNEL_ID,
      expires_at: null,
    });
  }

  if (!platformEntries.length) return { imported: 0, errors: 0 };

  let imported = 0;
  let errors = 0;

  for (const token of platformEntries) {
    if (token.expires_at && new Date(token.expires_at) < new Date()) {
      continue; // skip expired tokens
    }

    try {
      const adapter = getPlatformAdapter(token.platform as string);

      // Get the most recent post we already know about to avoid re-importing
      const { data: latestKnown } = await supabase
        .from("content_queue")
        .select("created_at")
        .eq("user_id", userId)
        .eq("platform", token.platform)
        .eq("status", "posted")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      // Fetch posts from the platform, going back 30 days if no known posts
      const since = latestKnown?.created_at
        ? new Date(new Date(latestKnown.created_at as string).getTime() - 86400000).toISOString()
        : new Date(Date.now() - 30 * 86400000).toISOString();

      const platformPosts = await adapter.listUserPosts({
        accessToken: token.access_token as string,
        userId: token.platform_user_id as string,
        since,
        limit: 100,
      });

      if (!platformPosts.length) continue;

      // Get all post_ids we already track for this platform
      const { data: existing } = await supabase
        .from("content_queue")
        .select("post_id")
        .eq("user_id", userId)
        .eq("platform", token.platform)
        .not("post_id", "is", null);

      const knownPostIds = new Set(
        (existing ?? []).map((e: Record<string, unknown>) => e.post_id as string)
      );

      // Import posts we don't already have
      for (const post of platformPosts) {
        if (knownPostIds.has(post.postId)) continue;

        const { error: insertError } = await supabase
          .from("content_queue")
          .insert({
            user_id: userId,
            platform: token.platform,
            content_type: post.contentType,
            body: post.body,
            status: "posted",
            post_id: post.postId,
            post_url: post.permalink ?? null,
            source: "external",
            scheduled_for: post.timestamp,
            created_at: post.timestamp,
            updated_at: new Date().toISOString(),
            attempts: 0,
          });

        if (insertError) {
          errors++;
          logError("jobs.sync-external.insert", insertError, { postId: post.postId });
        } else {
          imported++;

          // Embed external posts into semantic memory for voice/brand learning.
          // Tyler's ad-hoc posts are the purest signal of his authentic voice —
          // the content agent should study them to match his tone, style, and topics.
          if (post.body && post.body.length > 20) {
            try {
              await embedAndStore(
                `[TYLER'S OWN ${(token.platform as string).toUpperCase()} POST — voice reference]\n${post.body}`,
                {
                  userId,
                  source: "manual",
                  sourceId: `external-post:${post.postId}`,
                  category: "general",
                  importance: 7,
                  tags: [
                    "content:voice-reference",
                    `platform:${token.platform}`,
                    "creator-os",
                    "external",
                  ],
                }
              );
            } catch (embedErr) {
              // Non-fatal: post is already saved to content_queue
              logError("jobs.sync-external.embed", embedErr, { postId: post.postId });
            }
          }
        }
      }
    } catch (err) {
      errors++;
      logError("jobs.sync-external", err, { platform: token.platform });
    }
  }

  return { imported, errors };
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

  // Ensure YouTube is in tokenMap even without a platform_tokens entry (API-key-only)
  if (!tokenMap.has("youtube") && process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_CHANNEL_ID) {
    tokenMap.set("youtube", { accessToken: "", platformUserId: process.env.YOUTUBE_CHANNEL_ID });
  }

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
// Expire stale queued drafts
// ---------------------------------------------------------------------------

export async function expireStaleDrafts(
  userId: string
): Promise<{ expired: number }> {
  const supabase = createAdminClient();

  // Get staleness threshold from settings
  const { data: settings } = await supabase
    .from("creator_settings")
    .select("stale_after_days")
    .eq("user_id", userId)
    .single();

  const staleAfterDays = settings?.stale_after_days ?? 7;
  const cutoff = new Date(Date.now() - staleAfterDays * 86400000).toISOString();

  const { data: staleItems, error } = await supabase
    .from("content_queue")
    .update({
      status: "expired",
      last_error: `Auto-expired after ${staleAfterDays} days in queue`,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "queued")
    .lt("created_at", cutoff)
    .select("id");

  if (error) {
    logError("jobs.expire-stale", error, { userId });
    return { expired: 0 };
  }

  return { expired: staleItems?.length ?? 0 };
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

// ---------------------------------------------------------------------------
// Collect extended analytics (audience, trends, revenue)
// ---------------------------------------------------------------------------

export async function collectExtendedAnalytics(
  userId: string
): Promise<{ platforms: string[]; errors: string[] }> {
  const supabase = createAdminClient();
  const platforms: string[] = [];
  const errors: string[] = [];

  // Get all connected platforms with active tokens
  const { data: tokens } = await supabase
    .from("platform_tokens")
    .select("platform, access_token, platform_user_id, expires_at")
    .eq("user_id", userId);

  if (!tokens?.length) return { platforms, errors };

  const endDate = new Date().toISOString();
  const startDate = new Date(Date.now() - 30 * 86400000).toISOString();

  for (const token of tokens) {
    if (token.expires_at && new Date(token.expires_at as string) < new Date()) {
      continue;
    }

    try {
      const adapter = getPlatformAdapter(token.platform as string);

      // Only call if the adapter supports extended analytics
      if (!adapter.getExtendedAnalytics) continue;

      const extended = await adapter.getExtendedAnalytics({
        accessToken: token.access_token as string,
        userId: token.platform_user_id as string,
        startDate,
        endDate,
      });

      // Store in strategy_insights as structured data for the strategy agent
      // Upsert by platform so we always have the latest snapshot

      if (extended.audience) {
        await supabase
          .from("strategy_insights")
          .upsert(
            {
              user_id: userId,
              insight_type: "audience",
              content: `${(token.platform as string).toUpperCase()} audience: Peak hours ${extended.audience.peakHours.join(", ")} UTC. Top countries: ${extended.audience.topCountries.slice(0, 3).map((c) => c.country).join(", ") || "N/A"}.`,
              data: {
                platform: token.platform,
                ...extended.audience,
                period: extended.period,
              },
              confidence: 0.85,
              active: true,
            },
            { onConflict: "user_id,insight_type" }
          );
      }

      if (extended.contentTrends) {
        const topFormat = extended.contentTrends.topFormats[0];
        await supabase.from("strategy_insights").insert({
          user_id: userId,
          insight_type: "content_pattern",
          content: `${(token.platform as string).toUpperCase()} content trends: Best format is ${topFormat?.format ?? "unknown"} (${topFormat?.avgViews ?? 0} avg views). Avg watch time: ${extended.contentTrends.avgWatchTimeSec}s. Completion rate: ${Math.round((extended.contentTrends.avgCompletionRate ?? 0) * 100)}%.`,
          data: {
            platform: token.platform,
            ...extended.contentTrends,
            period: extended.period,
          },
          confidence: 0.8,
          active: true,
        });
      }

      if (extended.revenue && extended.revenue.totalRevenue > 0) {
        await supabase.from("strategy_insights").insert({
          user_id: userId,
          insight_type: "platform_rec",
          content: `${(token.platform as string).toUpperCase()} revenue: $${extended.revenue.totalRevenue.toFixed(2)} over 30 days. RPM: $${extended.revenue.rpm.toFixed(2)}. CPM: $${extended.revenue.cpm.toFixed(2)}.`,
          data: {
            platform: token.platform,
            ...extended.revenue,
            period: extended.period,
          },
          confidence: 0.95,
          active: true,
        });
      }

      platforms.push(token.platform as string);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${token.platform}: ${msg}`);
      logError("jobs.extended-analytics", err, { platform: token.platform });
    }
  }

  return { platforms, errors };
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
