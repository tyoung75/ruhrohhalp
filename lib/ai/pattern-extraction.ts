import { createAdminClient } from "@/lib/supabase/admin";
import { AI_MODELS } from "@/lib/ai-config";
import { callAI } from "@/lib/ai/providers";

type PlatformPatterns = {
  best_posting_times: string[];
  top_content_types: string[];
  avg_engagement_rate: number;
  top_hooks: string[];
  voice_observations: string[];
  content_mix_recommendation: Record<string, number>;
};

/**
 * Extract content performance patterns from the last 90 days.
 * Uses Opus to analyze performance data and generate actionable patterns.
 * Respects manual overrides (30-day protection).
 */
export async function extractPatterns(userId: string): Promise<Record<string, PlatformPatterns>> {
  const supabase = createAdminClient();

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch performance data with content details
  const { data: analytics } = await supabase
    .from("post_analytics")
    .select(`
      platform, impressions, likes, replies, reposts, views, saves, shares,
      engagement_rate, engagement_score, hook, content_category,
      watch_through_rate, follower_delta, fetched_at,
      content_queue_id
    `)
    .eq("user_id", userId)
    .gte("fetched_at", ninetyDaysAgo)
    .order("fetched_at", { ascending: false });

  if (!analytics || analytics.length === 0) {
    return {};
  }

  // Get content body for context
  const queueIds = analytics.map(a => a.content_queue_id).filter(Boolean);
  const bodyMap = new Map<string, { body: string; topic: string; platform_format: string }>();

  if (queueIds.length > 0) {
    const { data: posts } = await supabase
      .from("content_queue")
      .select("id, body, topic, platform_format")
      .in("id", queueIds);
    for (const p of posts ?? []) {
      bodyMap.set(p.id, { body: p.body, topic: p.topic ?? "", platform_format: p.platform_format ?? "" });
    }
  }

  // Group by platform
  const byPlatform = new Map<string, typeof analytics>();
  for (const a of analytics) {
    const list = byPlatform.get(a.platform) ?? [];
    list.push(a);
    byPlatform.set(a.platform, list);
  }

  // Call Opus to analyze patterns for each platform
  const patterns: Record<string, PlatformPatterns> = {};

  for (const [platform, data] of byPlatform) {
    const summary = data.slice(0, 30).map(d => ({
      engagement_rate: d.engagement_rate,
      likes: d.likes,
      impressions: d.impressions,
      hook: d.hook ?? bodyMap.get(d.content_queue_id ?? "")?.body?.slice(0, 60) ?? "",
      category: d.content_category ?? bodyMap.get(d.content_queue_id ?? "")?.topic ?? "",
      format: bodyMap.get(d.content_queue_id ?? "")?.platform_format ?? "",
      time: d.fetched_at,
    }));

    try {
      const raw = await callAI({
        model: AI_MODELS.PATTERN_EXTRACTION,
        system: `You analyze social media content performance data and extract actionable patterns. Output valid JSON only.`,
        messages: [{
          role: "user",
          content: `Analyze this ${platform} performance data (last 90 days, ${data.length} posts) and extract patterns.

Data (top 30 by recency):
${JSON.stringify(summary, null, 2)}

Return JSON:
{
  "best_posting_times": ["9am ET", "6pm ET"],
  "top_content_types": ["thread", "carousel"],
  "avg_engagement_rate": 0.045,
  "top_hooks": ["opening lines that work well"],
  "voice_observations": ["what resonates with audience"],
  "content_mix_recommendation": {"threads": 0.4, "carousels": 0.3, "reels": 0.3}
}

Only output the JSON.`,
        }],
        route: "pattern-extraction",
        maxTokens: 1500,
        timeoutMs: 45000,
      });

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        patterns[platform] = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Skip platform if analysis fails
    }
  }

  // Save patterns to user_settings, respecting manual overrides
  const { data: settings } = await supabase
    .from("user_settings")
    .select("content_patterns_manual_override, content_patterns_updated_at")
    .eq("user_id", userId)
    .single();

  const overrides = (settings?.content_patterns_manual_override as Record<string, unknown>) ?? {};

  // Don't overwrite manually set patterns within 30 days
  const mergedPatterns = { ...patterns };
  for (const [key, value] of Object.entries(overrides)) {
    if (value) {
      mergedPatterns[key] = value as PlatformPatterns;
    }
  }

  await supabase
    .from("user_settings")
    .upsert({
      user_id: userId,
      content_patterns: mergedPatterns,
      content_patterns_updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  return mergedPatterns;
}

/**
 * Compute engagement_score for a post analytics row.
 * Weighted formula: (likes × 1) + (replies × 3) + (reposts × 2) + (saves × 4) + (shares × 2)
 * Normalized by impressions.
 */
export function computeEngagementScore(row: {
  impressions: number;
  likes: number;
  replies: number;
  reposts: number;
  saves?: number;
  shares?: number;
}): number {
  const weighted =
    (row.likes ?? 0) * 1 +
    (row.replies ?? 0) * 3 +
    (row.reposts ?? 0) * 2 +
    (row.saves ?? 0) * 4 +
    (row.shares ?? 0) * 2;

  if (!row.impressions || row.impressions === 0) return 0;
  return Math.round((weighted / row.impressions) * 10000) / 10000;
}
