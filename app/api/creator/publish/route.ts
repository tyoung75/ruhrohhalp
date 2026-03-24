/**
 * Content Publishing Service — POST /api/creator/publish
 *
 * Picks the next queued post from content_queue and publishes it
 * via the appropriate platform adapter. Handles retries and rate limits.
 *
 * Auth: Cron secret or authenticated user.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdapter } from "@/lib/creator/platforms";
import { limitByKey } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  // Auth: user session or cron secret
  const cronSecret = request.headers.get("x-cron-secret");
  let userId: string;

  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
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

  // Rate limit publishing: 250 per day (Threads limit)
  const { ok, retryAfterMs } = limitByKey(`creator-publish:${userId}`, 250, 24 * 60 * 60 * 1000);
  if (!ok) {
    return NextResponse.json(
      { error: "Daily post limit reached (250/day)", retryAfterMs },
      { status: 429 }
    );
  }

  try {
    const supabase = createAdminClient();

    // Find next queued post ready for publishing
    const now = new Date().toISOString();
    const { data: post, error: fetchError } = await supabase
      .from("content_queue")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "queued")
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true })
      .limit(1)
      .single();

    if (fetchError || !post) {
      return NextResponse.json({ message: "No posts ready for publishing" }, { status: 200 });
    }

    // Mark as posting (prevent double-publish)
    await supabase
      .from("content_queue")
      .update({ status: "posting", updated_at: new Date().toISOString() })
      .eq("id", post.id);

    // Get platform token
    const { data: token, error: tokenError } = await supabase
      .from("platform_tokens")
      .select("access_token, platform_user_id, expires_at")
      .eq("user_id", userId)
      .eq("platform", post.platform)
      .single();

    if (tokenError || !token) {
      await supabase
        .from("content_queue")
        .update({
          status: "failed",
          last_error: "No platform token found. Please reconnect your account.",
          attempts: post.attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", post.id);

      return NextResponse.json({ error: "No platform token found" }, { status: 400 });
    }

    // Check token expiry
    if (token.expires_at && new Date(token.expires_at) < new Date()) {
      await supabase
        .from("content_queue")
        .update({
          status: "failed",
          last_error: "Platform token expired. Please reconnect.",
          attempts: post.attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", post.id);

      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }

    // Publish via platform adapter
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

      return NextResponse.json({
        success: true,
        postId: result.postId,
        postUrl: result.postUrl,
        queueId: post.id,
      });
    } else {
      // Failed — check if retryable
      const newAttempts = post.attempts + 1;
      const maxedOut = newAttempts >= (post.max_attempts ?? 3);

      await supabase
        .from("content_queue")
        .update({
          status: maxedOut ? "failed" : "queued",
          last_error: result.error,
          attempts: newAttempts,
          // Exponential backoff: retry in 5min, 25min, 125min
          scheduled_for: maxedOut
            ? post.scheduled_for
            : new Date(Date.now() + 5 * 60 * 1000 * Math.pow(5, newAttempts - 1)).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", post.id);

      return NextResponse.json(
        {
          success: false,
          error: result.error,
          attempt: newAttempts,
          maxAttempts: post.max_attempts ?? 3,
          willRetry: !maxedOut,
        },
        { status: 502 }
      );
    }
  } catch (error) {
    console.error("[creator-publish] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Publish failed" },
      { status: 500 }
    );
  }
}
