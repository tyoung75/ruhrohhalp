/**
 * Content Generation Agent — POST /api/creator/generate
 *
 * Takes daily context (calendar, strava, recent posts, goals) and generates
 * a batch of cross-platform posts from multiple models. Each post passes
 * through safety and brand/timeliness audits before being queued.
 *
 * Auth: Requires authenticated user OR cron secret.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { callClaude } from "@/lib/processors/claude";
import { AI_MODELS } from "@/lib/ai-config";
import { CONTENT_AGENT_SYSTEM, SAFETY_AUDIT_SYSTEM, BRAND_VOICE_AUDIT_SYSTEM } from "@/lib/creator/prompts";
import { limitByKey } from "@/lib/security/rate-limit";
import { generateEmbeddings } from "@/lib/embedding/openai";
import { buildTrainingSummary } from "@/lib/strava/client";

interface GeneratedPost {
  body: string | string[]; // string for single posts, string[] for threads
  type: string;
  confidence: number;
  brand_voice_score?: number;
  timeliness_score?: number;
  reasoning: string;
  suggested_time: string;
  needs_media: boolean;
}
interface GeneratedPostCandidate extends GeneratedPost {
  model_source: ContentGeneratorSource;
}

interface AuditResult {
  index: number;
  status: "approved" | "flagged" | "rejected";
  reason: string;
}

interface BrandVoiceAuditResult {
  index: number;
  verdict: "approve" | "flag" | "reject";
  ai_detectability: number;
  brand_voice_match: number;
  factual_grounding: number;
  issues: string[];
  suggestion?: string;
}

type ContentGeneratorSource = "internal" | "chatgpt" | "claude";

async function callChatGPT(system: string, userMessage: string, maxTokens = 2048): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY for content generation");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      max_tokens: maxTokens,
      temperature: 0.8,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `ChatGPT call failed (${res.status})`);
  }

  return data.choices?.[0]?.message?.content ?? "";
}

async function callClaudeDirect(system: string, userMessage: string, maxTokens = 2048): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY for content generation");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODELS.PRIMARY,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Claude call failed (${res.status})`);
  }

  return data.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
}

function parseGeneratedPosts(rawResponse: string, source: ContentGeneratorSource): GeneratedPostCandidate[] {
  const jsonStr = rawResponse.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      console.error(`[creator-generate] ${source} returned non-array payload`);
      return [];
    }
    return (parsed as GeneratedPost[]).map((post) => ({
      ...post,
      model_source: source,
    }));
  } catch {
    console.error(`[creator-generate] Failed to parse ${source} response:`, rawResponse.slice(0, 500));
    return [];
  }
}

export async function POST(request: NextRequest) {
  // Auth: user session or cron secret
  const cronSecret = request.headers.get("x-cron-secret");
  let userId: string;

  // Seed params for single-post generation from Strategy "Generate This" buttons
  let seedTopic: string | undefined;
  let seedPlatform: string | undefined;
  let seedFormat: string | undefined;
  let seedRationale: string | undefined;

  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    // Cron invocation — use hardcoded user ID (Tyler)
    const body = await request.json().catch(() => ({}));
    userId = body.userId ?? process.env.CREATOR_USER_ID ?? "";
    seedTopic = body.seedTopic;
    seedPlatform = body.seedPlatform;
    seedFormat = body.seedFormat;
    seedRationale = body.seedRationale;
    if (!userId) {
      return NextResponse.json({ error: "Missing userId for cron" }, { status: 400 });
    }
  } else {
    const { user, response } = await requireUser();
    if (!user) return response!;
    userId = user.id;
    // Parse body for seed params (from Strategy tab)
    try {
      const body = await request.json().catch(() => ({}));
      seedTopic = body.seedTopic;
      seedPlatform = body.seedPlatform;
      seedFormat = body.seedFormat;
      seedRationale = body.seedRationale;
    } catch {
      // No body or invalid JSON — that's fine, default batch generation
    }
  }

  // Rate limit: 5 generations per hour
  const { ok } = limitByKey(`creator-generate:${userId}`, 5, 60 * 60 * 1000);
  if (!ok) {
    return NextResponse.json({ error: "Rate limited. Max 5 generations per hour." }, { status: 429 });
  }

  try {
    const supabase = createAdminClient();

    // 1. Gather daily context + content performance memories
    const context = await gatherDailyContext(supabase, userId);
    const contentMemories = await searchContentMemories(supabase, userId);

    // 2. Generate posts from three sources (internal agent + ChatGPT + Claude API)
    const isSeedMode = !!(seedTopic || seedPlatform);
    const memoryBlock = contentMemories.length
      ? `\n\n--- CONTENT PERFORMANCE LEARNINGS (from semantic memory) ---\n${contentMemories.join("\n\n")}`
      : "";

    let userMessage: string;
    if (isSeedMode) {
      // Single-post generation seeded from Strategy recommendation
      userMessage = `Here is today's context for content generation:\n\n${JSON.stringify(context, null, 2)}${memoryBlock}\n\nGenerate exactly 1 post based on this specific strategy recommendation:\n- Topic: ${seedTopic ?? "your best judgment"}\n- Platform: ${seedPlatform ?? "threads"}\n- Format: ${seedFormat ?? "text"}\n- Rationale from strategy agent: ${seedRationale ?? "N/A"}\n\nCreate the BEST possible post for this specific recommendation. Match the platform's voice and format expectations. Return ONLY a JSON array with 1 item.`;
    } else {
      userMessage = `Here is today's context for content generation:\n\n${JSON.stringify(context, null, 2)}${memoryBlock}\n\nGenerate 5 posts across platforms based on this context. Learn from the performance data above — lean into patterns that worked and avoid patterns that didn't. Return ONLY a JSON array.`;
    }
    const sourceCalls: Array<Promise<{ source: ContentGeneratorSource; raw: string }>> = [
      callClaude(CONTENT_AGENT_SYSTEM, userMessage, 2048).then((raw) => ({ source: "internal" as const, raw })),
      callChatGPT(CONTENT_AGENT_SYSTEM, userMessage, 2048).then((raw) => ({ source: "chatgpt" as const, raw })),
      callClaudeDirect(CONTENT_AGENT_SYSTEM, userMessage, 2048).then((raw) => ({ source: "claude" as const, raw })),
    ];

    const settledResponses = await Promise.allSettled(sourceCalls);
    const posts: GeneratedPostCandidate[] = [];
    const generatedByModel: Record<ContentGeneratorSource, number> = {
      internal: 0,
      chatgpt: 0,
      claude: 0,
    };

    for (const result of settledResponses) {
      if (result.status === "fulfilled") {
        const parsed = parseGeneratedPosts(result.value.raw, result.value.source);
        posts.push(...parsed);
        generatedByModel[result.value.source] += parsed.length;
      } else {
        console.error("[creator-generate] Model call failed:", result.reason);
      }
    }

    if (!Array.isArray(posts) || posts.length === 0) {
      return NextResponse.json({ error: "No posts generated" }, { status: 500 });
    }

    // 3. Safety audit + brand voice audit (run in parallel)
    const [auditResults, brandVoiceResults] = await Promise.all([
      auditPosts(posts),
      auditBrandVoice(posts, context),
    ]);

    // 4. Queue approved posts (must pass BOTH audits)
    const today = new Date();
    const queued: string[] = [];
    const flagged: string[] = [];
    const rejected: string[] = [];

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const audit = auditResults.find((a) => a.index === i);
      const brandAudit = brandVoiceResults.find((a) => a.index === i);

      // Merge both audit layers: brand voice rejection/flag overrides safety approval
      let status = audit?.status ?? "approved";
      if (brandAudit?.verdict === "reject") {
        status = "rejected";
      } else if (brandAudit?.verdict === "flag" && status === "approved") {
        status = "flagged";
      }

      // Determine content type and normalize body
      const isThread = post.type === "thread" || Array.isArray(post.body);
      let bodyStr: string;
      let contentType: string;

      if (isThread) {
        // Thread: body is an array of strings — store as JSON
        const parts = Array.isArray(post.body) ? post.body : [post.body];
        bodyStr = JSON.stringify(parts);
        contentType = "thread";
      } else {
        bodyStr = post.body as string;
        contentType = post.needs_media ? "image" : "text";
      }

      if (status === "rejected") {
        rejected.push(bodyStr.slice(0, 50));
        continue;
      }

      // Calculate scheduled_for from suggested_time
      const [hours, minutes] = (post.suggested_time ?? "12:00").split(":").map(Number);
      const scheduledFor = new Date(today);
      scheduledFor.setHours(hours, minutes, 0, 0);

      // If the time has already passed today, schedule for tomorrow
      if (scheduledFor < new Date()) {
        scheduledFor.setDate(scheduledFor.getDate() + 1);
      }

      const queueStatus = status === "flagged" ? "draft" : "queued";
      if (status === "flagged") flagged.push(bodyStr.slice(0, 50));

      // Use seed platform if provided, otherwise check post for platform field, default to threads
      const postPlatform = seedPlatform ?? (post as unknown as Record<string, unknown>).platform as string ?? "threads";
      // Use the independent brand voice audit score if available, fallback to self-reported
      const auditedBrandScore = brandAudit
        ? brandAudit.brand_voice_match
        : (post.brand_voice_score ?? null);

      const brandAuditMeta = brandAudit
        ? {
            ai_detectability: brandAudit.ai_detectability,
            brand_voice_match: brandAudit.brand_voice_match,
            factual_grounding: brandAudit.factual_grounding,
            issues: brandAudit.issues,
            suggestion: brandAudit.suggestion,
          }
        : null;

      // Build reasoning with brand audit context
      let reasoning = post.reasoning;
      if (brandAudit?.issues?.length) {
        reasoning += ` | Brand audit issues: ${brandAudit.issues.join("; ")}`;
      }

      const { data, error } = await supabase.from("content_queue").insert({
        user_id: userId,
        platform: postPlatform,
        content_type: contentType,
        body: bodyStr,
        model_source: post.model_source,
        scheduled_for: scheduledFor.toISOString(),
        status: queueStatus,
        confidence_score: post.confidence,
        brand_voice_score: auditedBrandScore,
        timeliness_score: post.timeliness_score ?? null,
        agent_reasoning: reasoning,
        context_snapshot: { ...context, brand_audit: brandAuditMeta, model_source: post.model_source },
      }).select("id").single();

      if (error) {
        console.error("[creator-generate] Queue insert error:", error);
      } else if (data) {
        queued.push(data.id);
      }
    }

    return NextResponse.json({
      success: true,
      generated: posts.length,
      generatedByModel,
      queued: queued.length,
      flagged: flagged.length,
      rejected: rejected.length,
      queueIds: queued,
    });
  } catch (error) {
    console.error("[creator-generate] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Generation failed" },
      { status: 500 }
    );
  }
}

/**
 * Gather today's context for the content agent.
 */
async function gatherDailyContext(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string
) {
  const today = new Date().toISOString().split("T")[0];

  // Recent posts (last 14 days) — includes drafts to prevent regenerating similar content
  const { data: recentPosts } = await supabase
    .from("content_queue")
    .select("body, platform, status, created_at, topic")
    .eq("user_id", userId)
    .in("status", ["posted", "queued", "approved", "draft"])
    .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(30);

  // Active goals and pillars
  const { data: goals } = await supabase
    .from("goals")
    .select("title, pillar_id, status, progress")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(10);

  // Today's tasks
  const { data: tasks } = await supabase
    .from("tasks")
    .select("title, status, priority")
    .eq("user_id", userId)
    .in("status", ["started", "in_review"])
    .limit(10);

  // Latest briefing
  const { data: briefing } = await supabase
    .from("briefings")
    .select("content_md")
    .eq("user_id", userId)
    .eq("period", "daily")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Top performing past posts (for learning)
  const { data: topPosts } = await supabase
    .from("post_analytics")
    .select("content_queue_id, engagement_rate, likes, replies")
    .eq("user_id", userId)
    .order("engagement_rate", { ascending: false })
    .limit(5);

  let topPostBodies: string[] = [];
  if (topPosts?.length) {
    const ids = topPosts.map((p: Record<string, unknown>) => p.content_queue_id).filter(Boolean);
    if (ids.length) {
      const { data: bodies } = await supabase
        .from("content_queue")
        .select("body")
        .in("id", ids);
      topPostBodies = bodies?.map((b: Record<string, unknown>) => b.body as string) ?? [];
    }
  }

  // --- Voice references: Tyler's own ad-hoc posts (external/manual) ---
  let voiceReferences: string[] = [];
  try {
    const { data: externalPosts } = await supabase
      .from("content_queue")
      .select("body, platform")
      .eq("user_id", userId)
      .eq("source", "external")
      .order("created_at", { ascending: false })
      .limit(10);

    voiceReferences = (externalPosts ?? [])
      .filter((p: Record<string, unknown>) => p.body && (p.body as string).length > 20)
      .map((p: Record<string, unknown>) => `[${(p.platform as string).toUpperCase()}] ${p.body as string}`)
      .slice(0, 8);
  } catch (err) {
    console.error("[creator-generate] Voice refs fetch failed (non-fatal):", err);
  }

  // --- Strava: recent training data ---
  let stravaData: { recentActivities: string[]; weeklyStats: string } | null = null;
  try {
    if (process.env.STRAVA_CLIENT_ID) {
      const summary = await buildTrainingSummary();
      stravaData = {
        recentActivities: summary.recentActivities,
        weeklyStats: summary.weeklyStats,
      };
    }
  } catch (err) {
    console.error("[creator-generate] Strava fetch failed (non-fatal):", err);
  }

  // --- Motus: today's scheduled workouts and recent workout signals ---
  let motusData: { appStats: unknown; recentWorkoutSignals: unknown[] } | null = null;
  try {
    const { data: motusStats } = await supabase
      .from("app_stats")
      .select("stats, updated_at")
      .eq("app", "motus")
      .limit(1)
      .single();

    const { data: workoutSignals } = await supabase
      .from("goal_signals")
      .select("content, sentiment, impact_score, raw_data, created_at")
      .eq("user_id", userId)
      .eq("signal_type", "workout")
      .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10);

    if (motusStats || workoutSignals?.length) {
      motusData = {
        appStats: motusStats?.stats ?? null,
        recentWorkoutSignals: workoutSignals ?? [],
      };
    }
  } catch (err) {
    console.error("[creator-generate] Motus fetch failed (non-fatal):", err);
  }

  // --- Active strategy insights (adaptive learnings) ---
  let strategyInsights: string[] = [];
  try {
    const { data: insights } = await supabase
      .from("strategy_insights")
      .select("insight_type, content")
      .eq("user_id", userId)
      .eq("active", true)
      .order("confidence", { ascending: false })
      .limit(8);

    strategyInsights = (insights ?? []).map(
      (i: { insight_type: string; content: string }) => `[${i.insight_type}] ${i.content}`
    );
  } catch (err) {
    console.error("[creator-generate] Strategy insights fetch failed (non-fatal):", err);
  }

  // --- Active trend signals (from detectTrends + external analysis) ---
  let activeTrends: string[] = [];
  try {
    const { data: trends } = await supabase
      .from("trend_signals")
      .select("topic, platform, relevance_score, context")
      .eq("user_id", userId)
      .gte("expires_at", new Date().toISOString())
      .order("relevance_score", { ascending: false })
      .limit(10);

    activeTrends = (trends ?? []).map(
      (t: { topic: string; platform: string | null; relevance_score: number; context: string | null }) =>
        `[${t.platform ?? "general"}] (relevance: ${t.relevance_score}) ${t.topic}${t.context ? ` — ${t.context}` : ""}`
    );
  } catch (err) {
    console.error("[creator-generate] Trend signals fetch failed (non-fatal):", err);
  }

  // --- Creator feedback (directives, dislikes, corrections, likes) ---
  interface FeedbackRow { feedback_type: string; content: string; context: Record<string, unknown> | null }
  let creatorFeedback: {
    directives: string[];
    dislikes: Array<{ feedback: string; postBody: string | null }>;
    corrections: Array<{ feedback: string; postBody: string | null }>;
    likes: Array<{ feedback: string; postBody: string | null }>;
  } = { directives: [], dislikes: [], corrections: [], likes: [] };
  try {
    const { data: feedback } = await supabase
      .from("content_feedback")
      .select("feedback_type, content, context")
      .eq("user_id", userId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(20);

    if (feedback?.length) {
      const fb = feedback as FeedbackRow[];
      creatorFeedback = {
        directives: fb.filter((f) => f.feedback_type === "directive").map((f) => f.content),
        dislikes: fb.filter((f) => f.feedback_type === "dislike").map((f) => ({
          feedback: f.content,
          postBody: (f.context?.postBody as string) ?? null,
        })),
        corrections: fb.filter((f) => f.feedback_type === "correction").map((f) => ({
          feedback: f.content,
          postBody: (f.context?.postBody as string) ?? null,
        })),
        likes: fb.filter((f) => f.feedback_type === "like").map((f) => ({
          feedback: f.content,
          postBody: (f.context?.postBody as string) ?? null,
        })),
      };
    }
  } catch (err) {
    console.error("[creator-generate] Feedback fetch failed (non-fatal):", err);
  }

  return {
    date: today,
    dayOfWeek: new Date().toLocaleDateString("en-US", { weekday: "long" }),
    recentPosts: recentPosts?.map((p: Record<string, unknown>) => {
      const body = (p.body as string) ?? "";
      const preview = body.startsWith("[") ? body.slice(0, 200) : body.slice(0, 150);
      return `[${p.status}/${p.platform}] ${preview}`;
    }).slice(0, 20) ?? [],
    activeGoals: goals ?? [],
    currentTasks: tasks ?? [],
    briefingSummary: briefing?.content_md?.slice(0, 500) ?? "",
    topPerformingPosts: topPostBodies,
    voiceReferences,
    strava: stravaData,
    motus: motusData,
    strategyInsights,
    activeTrends,
    creatorFeedback,
  };
}

/**
 * Run safety audit on generated posts via Groq (Llama).
 */
async function auditPosts(posts: GeneratedPost[]): Promise<AuditResult[]> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    // No audit layer configured — approve all
    return posts.map((_, i) => ({ index: i, status: "approved" as const, reason: "No audit configured" }));
  }

  try {
    const postList = posts.map((p, i) => {
      const bodyText = Array.isArray(p.body)
        ? p.body.map((part, j) => `  Part ${j + 1}: ${part}`).join("\n")
        : p.body;
      return `[${i}] ${bodyText}`;
    }).join("\n");
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: AI_MODELS.AUDIT,
        max_tokens: 1024,
        messages: [
          { role: "system", content: SAFETY_AUDIT_SYSTEM },
          { role: "user", content: `Audit these posts:\n\n${postList}` },
        ],
      }),
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    return parsed.results ?? [];
  } catch (error) {
    console.error("[creator-audit] Audit failed, approving all:", error);
    return posts.map((_, i) => ({ index: i, status: "approved" as const, reason: "Audit unavailable" }));
  }
}

/**
 * Run independent brand voice audit via Claude.
 * Checks AI-detectability, brand voice match, and factual grounding.
 */
async function auditBrandVoice(
  posts: GeneratedPost[],
  context: Record<string, unknown>
): Promise<BrandVoiceAuditResult[]> {
  try {
    const postList = posts
      .map((p, i) => {
        const bodyText = Array.isArray(p.body)
          ? p.body.map((part, j) => `  Part ${j + 1}: ${part}`).join("\n")
          : p.body;
        return `[${i}] ${bodyText}`;
      })
      .join("\n\n");

    // Include voice references and top posts for comparison, plus a context summary
    // so the auditor can verify factual claims
    const voiceRefs = (context.voiceReferences as string[]) ?? [];
    const topPosts = (context.topPerformingPosts as string[]) ?? [];
    const strava = context.strava ? JSON.stringify(context.strava) : "No Strava data today.";
    const motus = context.motus ? JSON.stringify(context.motus) : "No Motus data today.";
    const recentPosts = (context.recentPosts as string[]) ?? [];

    const auditContext = [
      `--- VOICE REFERENCES (Tyler's own writing — ground truth) ---`,
      voiceRefs.length ? voiceRefs.join("\n") : "No voice references available.",
      `\n--- TOP PERFORMING POSTS ---`,
      topPosts.length ? topPosts.join("\n") : "No top posts available.",
      `\n--- TODAY'S FACTUAL CONTEXT (for grounding checks) ---`,
      `Date: ${context.date}`,
      `Strava: ${strava}`,
      `Motus: ${motus}`,
      `\n--- RECENT POSTS (check for redundancy) ---`,
      recentPosts.slice(0, 15).join("\n"),
    ].join("\n");

    const userMessage = `Audit these generated posts for brand voice quality, AI-detectability, and factual grounding.\n\n${auditContext}\n\n--- POSTS TO AUDIT ---\n${postList}`;

    const rawResponse = await callClaude(BRAND_VOICE_AUDIT_SYSTEM, userMessage, 2048);

    const jsonStr = rawResponse.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    return parsed.results ?? [];
  } catch (error) {
    console.error("[creator-brand-audit] Brand voice audit failed, passing all:", error);
    // Fail open but log — we don't want to block publishing if audit breaks
    return posts.map((_, i) => ({
      index: i,
      verdict: "approve" as const,
      ai_detectability: 0.7,
      brand_voice_match: 0.7,
      factual_grounding: 0.7,
      issues: ["Brand voice audit unavailable — defaulting to approve"],
    }));
  }
}

/**
 * Search semantic memory for content performance learnings.
 * Returns embedded memories tagged with content:winner, content:underperformer,
 * content:liked, or content:disliked.
 */
async function searchContentMemories(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<string[]> {
  if (!process.env.HF_API_TOKEN) return [];

  try {
    const query = "What kind of social media posts perform well? What content patterns get high engagement?";
    const [embedding] = await generateEmbeddings([query]);

    const { data: matches } = await supabase.rpc("search_by_embedding", {
      p_user_id: userId,
      p_table_name: "memories",
      p_embedding: JSON.stringify(embedding),
      p_match_count: 10,
      p_match_threshold: 0.55,
    });

    if (!matches?.length) return [];

    const ids = (matches as Array<{ id: string }>).map((m) => m.id);
    const { data: rows } = await supabase
      .from("memories")
      .select("content, tags")
      .in("id", ids);

    if (!rows?.length) return [];

    // Filter to only content-related memories
    return (rows as Array<{ content: string; tags: string[] | null }>)
      .filter((r) => {
        const tags = r.tags ?? [];
        return tags.some((t) =>
          t.startsWith("content:") || t === "creator-os"
        );
      })
      .map((r) => r.content)
      .slice(0, 8);
  } catch (err) {
    console.error("[creator-generate] Content memory search failed:", err);
    return [];
  }
}
