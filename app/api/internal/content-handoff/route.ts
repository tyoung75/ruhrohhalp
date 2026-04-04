import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "@/lib/jobs/executor";
import { postToPlatform } from "@/lib/integrations/post-to-platform";

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runJob("content-handoff", async () => {
    const supabase = createAdminClient();

    // Fetch queued content items ready for publishing
    // Only auto-publish Threads posts — other platforms stay as drafts for manual review
    // Limited to 2 per run to match the primary publish path (publishQueuedPosts)
    const { data: items, error } = await supabase
      .from("content_queue")
      .select("id, user_id, platform, body, caption, title, hashtags, media_urls, platform_spec, attempts, max_attempts")
      .eq("status", "queued")
      .eq("platform", "threads")
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .limit(2);

    if (error) throw new Error(error.message);
    if (!items || items.length === 0) {
      return { ok: true, job: "content-handoff", processed: 0, message: "No queued items" };
    }

    let succeeded = 0;
    let failed = 0;

    for (const item of items) {
      // Mark as posting
      await supabase
        .from("content_queue")
        .update({ status: "posting", attempts: (item.attempts ?? 0) + 1 })
        .eq("id", item.id);

      try {
        const postResult = await postToPlatform({
          id: item.id,
          user_id: item.user_id,
          platform: item.platform,
          body: item.body,
          caption: item.caption ?? undefined,
          title: item.title ?? undefined,
          hashtags: item.hashtags ?? undefined,
          media_urls: item.media_urls ?? undefined,
          platform_spec: item.platform_spec ?? undefined,
        });

        if (postResult.success) {
          await supabase
            .from("content_queue")
            .update({
              status: "posted",
              external_id: postResult.external_id ?? null,
              post_url: postResult.post_url ?? null,
              post_id: postResult.external_id ?? null,
            })
            .eq("id", item.id);
          succeeded++;
        } else {
          const attempts = (item.attempts ?? 0) + 1;
          const maxAttempts = item.max_attempts ?? 3;
          await supabase
            .from("content_queue")
            .update({
              status: attempts >= maxAttempts ? "failed" : "queued",
              last_error: postResult.error ?? "Unknown error",
            })
            .eq("id", item.id);
          failed++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const attempts = (item.attempts ?? 0) + 1;
        const maxAttempts = item.max_attempts ?? 3;
        await supabase
          .from("content_queue")
          .update({
            status: attempts >= maxAttempts ? "failed" : "queued",
            last_error: errMsg,
          })
          .eq("id", item.id);
        failed++;
      }
    }

    return {
      ok: true,
      job: "content-handoff",
      processed: items.length,
      succeeded,
      failed,
    };
  });

  return NextResponse.json(result);
}
