/**
 * Content Feedback — POST /api/creator/feedback
 *
 * Allows manual feedback on generated/posted content.
 * Stores in content_feedback and embeds into semantic memory
 * so the generation agent can learn from it.
 *
 * Body: { contentQueueId, rating (1-5), feedback (optional text) }
 *
 * Auth: Authenticated user session.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedAndStore } from "@/lib/embedding/pipeline";
import { logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await request.json().catch(() => null);
  if (!body?.contentQueueId) {
    return NextResponse.json({ error: "Missing contentQueueId" }, { status: 400 });
  }

  const { contentQueueId, rating, feedback } = body as {
    contentQueueId: string;
    rating?: number;
    feedback?: string;
  };

  if (rating !== undefined && (rating < 1 || rating > 5)) {
    return NextResponse.json({ error: "Rating must be 1-5" }, { status: 400 });
  }

  const supabase = createAdminClient();

  try {
    // Verify the post belongs to this user
    const { data: post, error: postError } = await supabase
      .from("content_queue")
      .select("id, body, platform")
      .eq("id", contentQueueId)
      .eq("user_id", user.id)
      .single();

    if (postError || !post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Store feedback
    const { data: feedbackRow, error: insertError } = await supabase
      .from("content_feedback")
      .insert({
        user_id: user.id,
        content_queue_id: contentQueueId,
        feedback_type: "manual",
        rating: rating ?? null,
        feedback: feedback ?? null,
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(`Failed to store feedback: ${insertError.message}`);
    }

    // Embed feedback into memory for the content agent to learn from
    if (rating || feedback) {
      const ratingLabel = rating
        ? rating >= 4 ? "LIKED" : rating <= 2 ? "DISLIKED" : "NEUTRAL"
        : "REVIEWED";

      const memoryContent = [
        `[CONTENT FEEDBACK: ${ratingLabel}]`,
        `Platform: ${post.platform}`,
        rating ? `Rating: ${rating}/5` : null,
        feedback ? `Feedback: ${feedback}` : null,
        `\nPost content:\n${post.body}`,
      ].filter(Boolean).join("\n");

      const tag = rating && rating >= 4
        ? "content:liked"
        : rating && rating <= 2
          ? "content:disliked"
          : "content:reviewed";

      try {
        await embedAndStore(memoryContent, {
          userId: user.id,
          source: "manual",
          sourceId: `content-feedback:${feedbackRow.id}`,
          category: "general",
          importance: rating && rating >= 4 ? 8 : rating && rating <= 2 ? 7 : 5,
          tags: [tag, `platform:${post.platform}`, "creator-os"],
        });
      } catch (embedErr) {
        // Non-fatal — feedback is stored even if embedding fails
        logError("creator.feedback.embed", embedErr, { feedbackId: feedbackRow.id });
      }
    }

    return NextResponse.json({
      success: true,
      feedbackId: feedbackRow.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Feedback failed" },
      { status: 500 }
    );
  }
}
