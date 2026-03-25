/**
 * Content Generation Agent — POST /api/creator/generate
 *
 * Takes daily context (calendar, strava, recent posts, goals) and generates
 * a batch of Threads posts using Claude. Each post passes through the
 * Groq audit layer for safety before being queued.
 *
 * Auth: Requires authenticated user OR cron secret.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { callClaude } from "@/lib/processors/claude";
import { AI_MODELS } from "@/lib/ai-config";
import { CONTENT_AGENT_SYSTEM, SAFETY_AUDIT_SYSTEM } from "@/lib/creator/prompts";
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

interface AuditResult {
  index: number;
  status: "approved" | "flagged" | "rejected";
  reason: string;
}

export async function POST(request: NextRequest) {
  // Auth: user session or cron secret
  const cronSecret = request.headers.get("x-cron-secret");
  let userId: string;

  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    // Cron invocation — use hardcoded user ID (Tyler)
    const body = await request.json().catch(() => ({}));
    userId = body.userId ?? process.env.CREATOR_USER_ID ?? "";
    if (!userId) {
      return NextResponse.json({ error: "Missing userId for cron" }, { status: 400 });
    }
  } else {
    const { user, response } = await requireUser();
    if (!user) return response!;
    userId = user.id;
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

    // 2. Generate posts with Claude
    const memoryBlock = contentMemories.length
      ? `\n\n--- CONTENT PERFORMANCE LEARNINGS (from semantic memory) ---\n${contentMemories.join("\n\n")}`
      : "";
    const userMessage = `Here is today's context for content generation:\n\n${JSON.stringify(context, null, 2)}${memoryBlock}\n\nGenerate 5 Threads posts based on this context. Learn from the performance data above — lean into patterns that worked and avoid patterns that didn't. Return ONLY a JSON array.`;
    const rawResponse = await callClaude(CONTENT_AGENT_SYSTEM, userMessage, 2048);

    // Parse JSON from response (handle markdown code blocks)
    const jsonStr = rawResponse.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    let posts: GeneratedPost[];
    try {
      posts = JSON.parse(jsonStr);
    } catch {
      console.error("[creator-generate] Failed to parse AI response:", rawResponse.slice(0, 500));
      return NextResponse.json({ error: "Failed to parse generated content" }, { status: 500 });
    }

    if (!Array.isArray(posts) || posts.length === 0) {
      return NextResponse.json({ error: "No posts generated" }, { status: 500 });
    }

    // 3. Safety audit via Groq (Llama)
    const auditResults = await auditPosts(posts);

    // 4. Queue approved posts
    const today = new Date();
    const queued: string[] = [];
    const flagged: string[] = [];
    const rejected: string[] = [];

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const audit = auditResults.find((a) => a.index === i);
      const status = audit?.status ?? "approved";

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

      const { data, error } = await supabase.from("content_queue").insert({
        user_id: userId,
        platform: "threads",
        content_type: contentType,
        body: bodyStr,
        scheduled_for: scheduledFor.toISOString(),
        status: queueStatus,
        confidence_score: post.confidence,
        brand_voice_score: post.brand_voice_score ?? null,
        timeliness_score: post.timeliness_score ?? null,
        agent_reasoning: post.reasoning,
        context_snapshot: context,
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

  // Recent posts (last 7 days) to avoid repetition
  const { data: recentPosts } = await supabase
    .from("content_queue")
    .select("body, platform, status, created_at")
    .eq("user_id", userId)
    .in("status", ["posted", "queued", "approved"])
    .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(20);

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
    recentPosts: recentPosts?.map((p: Record<string, unknown>) => p.body as string).slice(0, 10) ?? [],
    activeGoals: goals ?? [],
    currentTasks: tasks ?? [],
    briefingSummary: briefing?.content_md?.slice(0, 500) ?? "",
    topPerformingPosts: topPostBodies,
    strava: stravaData,
    motus: motusData,
    strategyInsights,
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
