/**
 * Content Feedback API — POST /api/creator/feedback (submit)
 *                        GET  /api/creator/feedback (list recent)
 *
 * Closed-loop feedback from Tyler to the content/strategy agents.
 * Supports: like, dislike (deleted posts), correction, directive.
 *
 * Feedback is stored in content_feedback AND embedded into semantic memory
 * so both the strategy agent and content generation agent can learn.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedAndStore } from "@/lib/embedding/pipeline";
import { logError } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST — submit feedback
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { contentQueueId, feedbackType, content, context, rating } = body as {
    contentQueueId?: string;
    feedbackType?: string;
    content?: string;
    context?: Record<string, unknown>;
    rating?: number; // backward compat with old UI
  };

  // Support legacy format (rating-based) and new format (type-based)
  const resolvedType = feedbackType
    ?? (rating && rating >= 4 ? "like" : rating && rating <= 2 ? "dislike" : "correction");
  const resolvedContent = content
    ?? (body.feedback as string)
    ?? (rating ? `Rating: ${rating}/5` : "");

  if (!resolvedContent) {
    return NextResponse.json(
      { error: "content (or feedback) is required" },
      { status: 400 }
    );
  }

  const validTypes = ["like", "dislike", "correction", "directive"];
  if (!validTypes.includes(resolvedType)) {
    return NextResponse.json(
      { error: `feedbackType must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Auto-capture post context if linked to a specific content_queue item
  let enrichedContext: Record<string, unknown> = context ?? {};
  if (contentQueueId) {
    const { data: post } = await supabase
      .from("content_queue")
      .select("body, content_type, platform, status, agent_reasoning")
      .eq("id", contentQueueId)
      .eq("user_id", user.id)
      .single();

    if (post) {
      enrichedContext = {
        ...enrichedContext,
        postBody: (post.body as string)?.slice(0, 500),
        contentType: post.content_type,
        platform: post.platform,
        postStatus: post.status,
        agentReasoning: post.agent_reasoning,
      };
    }
  }

  try {
    const { data: feedbackRow, error: insertError } = await supabase
      .from("content_feedback")
      .insert({
        user_id: user.id,
        content_queue_id: contentQueueId ?? null,
        feedback_type: resolvedType,
        content: resolvedContent,
        context: enrichedContext,
        active: true,
      })
      .select("id, feedback_type, content, created_at")
      .single();

    if (insertError) {
      throw new Error(`Failed to store feedback: ${insertError.message}`);
    }

    // Embed feedback into semantic memory for the content agent
    const tagMap: Record<string, string> = {
      like: "content:liked",
      dislike: "content:disliked",
      correction: "content:correction",
      directive: "content:directive",
    };

    const memoryLines = [
      `[CONTENT FEEDBACK: ${resolvedType.toUpperCase()}]`,
      resolvedContent,
      enrichedContext.platform ? `Platform: ${enrichedContext.platform}` : null,
      enrichedContext.postBody ? `\nOriginal post:\n${enrichedContext.postBody}` : null,
    ].filter(Boolean).join("\n");

    try {
      await embedAndStore(memoryLines, {
        userId: user.id,
        source: "manual",
        sourceId: `content-feedback:${feedbackRow.id}`,
        category: "general",
        importance: resolvedType === "directive" ? 9 : resolvedType === "dislike" ? 8 : 6,
        tags: [
          tagMap[resolvedType] ?? "content:reviewed",
          "creator-os",
          ...(enrichedContext.platform ? [`platform:${enrichedContext.platform}`] : []),
        ],
      });
    } catch (embedErr) {
      logError("creator.feedback.embed", embedErr, { feedbackId: feedbackRow.id });
    }

    return NextResponse.json({ success: true, feedback: feedbackRow });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Feedback failed" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET — list recent feedback
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const supabase = createAdminClient();
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const activeOnly = url.searchParams.get("active") !== "false";
  const typeFilter = url.searchParams.get("type"); // optional: "directive", "dislike", etc.
  const contentQueueId = url.searchParams.get("content_queue_id"); // filter to specific post

  let query = supabase
    .from("content_feedback")
    .select("id, content_queue_id, feedback_type, content, context, active, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (activeOnly) query = query.eq("active", true);
  if (typeFilter) query = query.eq("feedback_type", typeFilter);
  if (contentQueueId) query = query.eq("content_queue_id", contentQueueId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = data ?? [];
  return NextResponse.json({
    feedback: items,
    summary: {
      total: items.length,
      directives: items.filter((f) => f.feedback_type === "directive").length,
      dislikes: items.filter((f) => f.feedback_type === "dislike").length,
      corrections: items.filter((f) => f.feedback_type === "correction").length,
      likes: items.filter((f) => f.feedback_type === "like").length,
    },
  });
}
