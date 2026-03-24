/**
 * Social Strategy Intelligence Agent
 *
 * AI-powered strategy generation that pulls from ALL context sources:
 * - Strava activities + Motus workouts (what's happening in Tyler's life)
 * - Calendar events (upcoming races, travel, meetings)
 * - Gmail (brand deals, audience DMs)
 * - Post analytics (what performs, what doesn't)
 * - Follower snapshots (growth trajectory, KPIs)
 * - Trend signals (what's trending in relevant niches)
 * - Semantic memory (historical patterns, past learnings)
 * - Existing strategy insights (what we believed before)
 *
 * Outputs: strategy_insights rows, content recommendations, and
 * a summary block for the weekly briefing.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { callClaude } from "@/lib/processors/claude";
import { generateEmbeddings } from "@/lib/embedding/openai";

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyRecommendation {
  topic: string;
  platform: "threads" | "instagram" | "tiktok";
  format: "single_post" | "thread" | "carousel" | "reel" | "story";
  suggestedTiming: string;
  rationale: string;
  trendRelevance: number; // 0-1
}

export interface StrategyOutput {
  recommendations: StrategyRecommendation[];
  insights: Array<{
    type: string;
    content: string;
    confidence: number;
    data: Record<string, unknown>;
  }>;
  velocityRec: {
    postsPerWeek: number;
    platformBreakdown: Record<string, number>;
    bestTimes: string[];
  };
  weeklyShifts: string[]; // Trend shifts for weekly briefing
}

// ---------------------------------------------------------------------------
// Strategy generation prompt
// ---------------------------------------------------------------------------

const STRATEGY_AGENT_SYSTEM = `You are Tyler Young's Social Media Strategy Agent. You analyze ALL available context to produce data-driven, adaptive content strategy recommendations.

Tyler is a NYC-based runner, software engineer, and entrepreneur (BearDuckHornEmpire LLC). His platforms: Threads (@t_young), Instagram, TikTok. His niches: running/endurance training, building in public (tech), NYC lifestyle, travel running, fitness tech (Motus app, Iron Passport).

Your job: Analyze the provided data and return a comprehensive strategy update.

ANALYSIS FRAMEWORK:
1. CONTENT PATTERNS — What types of posts get the most engagement? What gets algorithm push (high impressions relative to followers)?
2. TIMING — When do Tyler's posts perform best? What posting velocity is optimal?
3. TRENDS — What's trending in Tyler's niches that he should capitalize on?
4. GAPS — What topics/formats is Tyler underutilizing?
5. AUDIENCE — What does the data tell us about who's engaging and why?
6. PLATFORM — Where should Tyler focus more/less effort?

OUTPUT FORMAT — respond with ONLY a JSON object:
{
  "recommendations": [
    {
      "topic": "specific content idea",
      "platform": "threads|instagram|tiktok",
      "format": "single_post|thread|carousel|reel|story",
      "suggestedTiming": "day and time",
      "rationale": "why this, why now — reference specific data",
      "trendRelevance": 0.0-1.0
    }
  ],
  "insights": [
    {
      "type": "content_pattern|timing|platform_rec|trend_shift|velocity|audience|algorithm",
      "content": "the insight in plain language",
      "confidence": 0.0-1.0,
      "data": { "supporting_metrics": "here" }
    }
  ],
  "velocityRec": {
    "postsPerWeek": 14,
    "platformBreakdown": { "threads": 10, "instagram": 3, "tiktok": 1 },
    "bestTimes": ["7:30 AM ET", "12:00 PM ET", "6:00 PM ET", "9:30 PM ET"]
  },
  "weeklyShifts": [
    "Trend shift or strategic change worth noting in the weekly briefing"
  ]
}

Generate 5-7 specific content recommendations and 4-8 strategic insights. Be specific — reference actual numbers from the data, not vague generalities.`;

// ---------------------------------------------------------------------------
// Gather full context (superset of gatherDailyContext)
// ---------------------------------------------------------------------------

async function gatherStrategyContext(userId: string) {
  const supabase = createAdminClient();

  // Recent post analytics (30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: analytics } = await supabase
    .from("post_analytics")
    .select("content_queue_id, platform, impressions, likes, replies, reposts, quotes, engagement_rate, fetched_at")
    .eq("user_id", userId)
    .gte("fetched_at", thirtyDaysAgo)
    .order("fetched_at", { ascending: false })
    .limit(100);

  // Get post bodies for the analytics
  const queueIds = [...new Set((analytics ?? []).map((a) => a.content_queue_id).filter(Boolean))];
  let postBodies: Record<string, { body: string; content_type: string; created_at: string }> = {};
  if (queueIds.length) {
    const { data: posts } = await supabase
      .from("content_queue")
      .select("id, body, content_type, created_at")
      .in("id", queueIds);
    if (posts) {
      for (const p of posts) {
        postBodies[p.id] = { body: p.body, content_type: p.content_type, created_at: p.created_at };
      }
    }
  }

  // Follower snapshots (30 days)
  const { data: followerData } = await supabase
    .from("follower_snapshots")
    .select("platform, followers, engagement_rate, reach_rate, virality_rate, non_follower_pct, avg_impressions_per_post, follower_growth_rate, fetched_at")
    .eq("user_id", userId)
    .gte("fetched_at", thirtyDaysAgo)
    .order("fetched_at", { ascending: true });

  // Active trend signals
  const { data: trends } = await supabase
    .from("trend_signals")
    .select("topic, platform, relevance_score, source, context")
    .eq("user_id", userId)
    .gte("expires_at", new Date().toISOString())
    .order("relevance_score", { ascending: false })
    .limit(20);

  // Current strategy insights
  const { data: currentInsights } = await supabase
    .from("strategy_insights")
    .select("insight_type, content, confidence, data")
    .eq("user_id", userId)
    .eq("active", true);

  // Active goals
  const { data: goals } = await supabase
    .from("goals")
    .select("title, description, status, progress_metric, progress_current, progress_target, target_date")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(10);

  // Recent Strava activities (from goal_signals)
  const { data: workouts } = await supabase
    .from("goal_signals")
    .select("content, raw_data, created_at")
    .eq("user_id", userId)
    .eq("signal_type", "workout")
    .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(15);

  // Latest briefing (for calendar/email context)
  const { data: briefing } = await supabase
    .from("briefings")
    .select("content_md")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Compute top performers vs bottom performers
  const enrichedAnalytics = (analytics ?? []).map((a) => ({
    ...a,
    post: postBodies[a.content_queue_id] ?? null,
  }));

  const sorted = [...enrichedAnalytics].sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0));
  const topPerformers = sorted.slice(0, 5);
  const bottomPerformers = sorted.slice(-5).reverse();

  // Find algorithm-pushed posts (high impressions relative to followers)
  const latestFollowers: Record<string, number> = {};
  for (const f of (followerData ?? []).reverse()) {
    if (!latestFollowers[f.platform]) latestFollowers[f.platform] = f.followers;
  }

  const algoPushed = enrichedAnalytics
    .filter((a) => {
      const followers = latestFollowers[a.platform] ?? 0;
      return followers > 0 && (a.impressions ?? 0) > followers * 2;
    })
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 5);

  return {
    analytics: {
      total: enrichedAnalytics.length,
      topPerformers: topPerformers.map((a) => ({
        body: a.post?.body?.slice(0, 200),
        type: a.post?.content_type,
        impressions: a.impressions,
        likes: a.likes,
        replies: a.replies,
        reposts: a.reposts,
        engagement_rate: a.engagement_rate,
      })),
      bottomPerformers: bottomPerformers.map((a) => ({
        body: a.post?.body?.slice(0, 200),
        type: a.post?.content_type,
        impressions: a.impressions,
        likes: a.likes,
        engagement_rate: a.engagement_rate,
      })),
      algoPushed: algoPushed.map((a) => ({
        body: a.post?.body?.slice(0, 200),
        type: a.post?.content_type,
        impressions: a.impressions,
        followerCount: latestFollowers[a.platform],
        ratio: latestFollowers[a.platform] ? Math.round((a.impressions ?? 0) / latestFollowers[a.platform] * 10) / 10 : null,
      })),
    },
    followerGrowth: followerData ?? [],
    trends: trends ?? [],
    currentInsights: currentInsights ?? [],
    goals: goals ?? [],
    recentWorkouts: (workouts ?? []).map((w) => w.content),
    briefingSummary: briefing?.content_md?.slice(0, 600) ?? "",
    latestFollowers,
  };
}

// ---------------------------------------------------------------------------
// Generate strategy
// ---------------------------------------------------------------------------

export async function generateStrategy(): Promise<StrategyOutput> {
  const context = await gatherStrategyContext(TYLER_USER_ID);

  const userMessage = `Here is the full context for strategy generation:\n\n${JSON.stringify(context, null, 2)}\n\nAnalyze everything and generate an updated social media strategy. Return ONLY JSON.`;
  const rawResponse = await callClaude(STRATEGY_AGENT_SYSTEM, userMessage, 4096);

  const jsonStr = rawResponse.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  const output: StrategyOutput = JSON.parse(jsonStr);

  // Store new insights (deactivate old ones first)
  await storeInsights(output.insights);

  return output;
}

// ---------------------------------------------------------------------------
// Store strategy insights with embeddings
// ---------------------------------------------------------------------------

async function storeInsights(
  insights: StrategyOutput["insights"]
): Promise<void> {
  const supabase = createAdminClient();

  // Deactivate previous insights
  await supabase
    .from("strategy_insights")
    .update({ active: false })
    .eq("user_id", TYLER_USER_ID)
    .eq("active", true);

  // Generate embeddings for new insights
  const texts = insights.map((i) => `${i.type}: ${i.content}`);
  let embeddings: number[][] = [];
  try {
    if (process.env.HF_API_TOKEN) {
      embeddings = await generateEmbeddings(texts);
    }
  } catch (err) {
    console.error("[strategy] Embedding generation failed (non-fatal):", err);
  }

  // Insert new insights
  for (let i = 0; i < insights.length; i++) {
    const insight = insights[i];
    await supabase.from("strategy_insights").insert({
      user_id: TYLER_USER_ID,
      insight_type: insight.type,
      content: insight.content,
      data: insight.data,
      confidence: insight.confidence,
      embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
      active: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Get current strategy for dashboard
// ---------------------------------------------------------------------------

export async function getCurrentStrategy(): Promise<{
  insights: Array<{ type: string; content: string; confidence: number; data: Record<string, unknown>; created_at: string }>;
  recommendations: StrategyRecommendation[];
  velocity: StrategyOutput["velocityRec"] | null;
  trends: Array<{ topic: string; platform: string | null; relevance_score: number; context: string | null }>;
  lastUpdated: string | null;
}> {
  const supabase = createAdminClient();

  // Active insights
  const { data: insights } = await supabase
    .from("strategy_insights")
    .select("insight_type, content, confidence, data, created_at")
    .eq("user_id", TYLER_USER_ID)
    .eq("active", true)
    .order("confidence", { ascending: false });

  // Active trend signals
  const { data: trends } = await supabase
    .from("trend_signals")
    .select("topic, platform, relevance_score, context")
    .eq("user_id", TYLER_USER_ID)
    .gte("expires_at", new Date().toISOString())
    .order("relevance_score", { ascending: false })
    .limit(15);

  // Extract velocity insight if present
  const velocityInsight = (insights ?? []).find((i) => i.insight_type === "velocity");
  let velocity: StrategyOutput["velocityRec"] | null = null;
  if (velocityInsight?.data) {
    velocity = velocityInsight.data as unknown as StrategyOutput["velocityRec"];
  }

  // Map insights to recommendations (content_pattern and platform_rec types)
  const recs: StrategyRecommendation[] = (insights ?? [])
    .filter((i) => i.insight_type === "content_pattern" || i.insight_type === "platform_rec")
    .slice(0, 7)
    .map((i) => ({
      topic: i.content,
      platform: ((i.data as Record<string, unknown>)?.platform as "threads") ?? "threads",
      format: ((i.data as Record<string, unknown>)?.format as "single_post") ?? "single_post",
      suggestedTiming: ((i.data as Record<string, unknown>)?.timing as string) ?? "",
      rationale: i.content,
      trendRelevance: i.confidence,
    }));

  const lastUpdated = (insights ?? []).length
    ? (insights ?? [])[0].created_at
    : null;

  return {
    insights: (insights ?? []).map((i) => ({
      type: i.insight_type,
      content: i.content,
      confidence: i.confidence,
      data: i.data as Record<string, unknown>,
      created_at: i.created_at,
    })),
    recommendations: recs,
    velocity,
    trends: (trends ?? []).map((t) => ({
      topic: t.topic,
      platform: t.platform,
      relevance_score: t.relevance_score,
      context: t.context,
    })),
    lastUpdated,
  };
}

// ---------------------------------------------------------------------------
// Detect trends (web search + engagement velocity)
// ---------------------------------------------------------------------------

export async function detectTrends(): Promise<{ detected: number }> {
  const supabase = createAdminClient();
  let detected = 0;

  // Engagement velocity detection: find posts from last 7 days with
  // accelerating engagement (impressions growing faster than average)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: recentAnalytics } = await supabase
    .from("post_analytics")
    .select("content_queue_id, impressions, likes, replies, reposts")
    .eq("user_id", TYLER_USER_ID)
    .gte("fetched_at", sevenDaysAgo)
    .order("impressions", { ascending: false })
    .limit(20);

  if (recentAnalytics?.length) {
    const avgImpressions = recentAnalytics.reduce((sum, a) => sum + (a.impressions ?? 0), 0) / recentAnalytics.length;

    // Posts with 2x+ average impressions suggest trending topics
    const hotPosts = recentAnalytics.filter((a) => (a.impressions ?? 0) > avgImpressions * 2);
    if (hotPosts.length) {
      const queueIds = hotPosts.map((p) => p.content_queue_id).filter(Boolean);
      const { data: posts } = await supabase
        .from("content_queue")
        .select("body, content_type")
        .in("id", queueIds);

      for (const post of (posts ?? []).slice(0, 3)) {
        await supabase.from("trend_signals").insert({
          user_id: TYLER_USER_ID,
          topic: `High-velocity content: "${(post.body as string).slice(0, 80)}..."`,
          platform: "threads",
          relevance_score: 0.8,
          source: "engagement_velocity",
          context: `This ${post.content_type} post got 2x+ average impressions — the algorithm is pushing this type of content.`,
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        });
        detected++;
      }
    }
  }

  return { detected };
}
