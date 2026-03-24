/**
 * Cron: Creator Publish — runs every 5 minutes via Vercel Cron.
 *
 * Processes up to 3 queued posts per invocation:
 * 1. Finds posts where scheduled_for <= now and status = 'queued'
 * 2. Publishes each via the platform adapter
 * 3. Updates status and logs results
 *
 * Add to vercel.json:
 * { "crons": [{ "path": "/api/cron/creator-publish", "schedule": "every 5 min" }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdapter } from "@/lib/creator/platforms";

const MAX_PER_RUN = 3; // Don't publish more than 3 per 5-min window

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const now = new Date().toISOString();

    // Find queued posts ready for publishing
    const { data: posts, error: fetchError } = await supabase
      .from("content_queue")
      .select("*")
      .eq("status", "queued")
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true })
      .limit(MAX_PER_RUN);

    if (fetchError) {
      console.error("[cron-creator-publish] Fetch error:", fetchError);
      return NextResponse.json({ error: "Failed to fetch queue" }, { status: 500 });
    }

    if (!posts?.length) {
      return NextResponse.json({ message: "No posts to publish", published: 0 });
    }

    const results: Array<{ id: string; success: boolean; postId?: string; error?: string }> = [];

    for (const post of posts) {
      // Mark as posting
      await supabase
        .from("content_queue")
        .update({ status: "posting", updated_at: new Date().toISOString() })
        .eq("id", post.id);

      // Get platform token
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

      // Publish
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
          results.push({ id: post.id, success: true, postId: result.postId });
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

    const published = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      published,
      failed,
      total: results.length,
      results,
    });
  } catch (error) {
    console.error("[cron-creator-publish] Error:", error);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
