import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { runJob } from "@/lib/jobs/executor";
import { createAdminClient } from "@/lib/supabase/admin";
import { gatherWeeklyActivity } from "@/lib/blog/gather-activity";
import { loadStyleMemory } from "@/lib/blog/learning";
import { generateBlogPost } from "@/lib/blog/generate";
import { createBlogPR } from "@/lib/blog/github-pr";
import { createBlogDraftEmail } from "@/lib/blog/gmail-draft";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const lookbackDays = body.lookback_days ? Number(body.lookback_days) : undefined;
  const dryRun = Boolean(body.dry_run ?? false);
  const force = Boolean(body.force ?? false);

  const idempotencyKey = force
    ? undefined
    : `weekly-dev-log:${new Date().toISOString().slice(0, 10)}:${lookbackDays ?? "sun"}:${dryRun}`;

  const result = await runJob(
    "weekly-dev-log",
    async () => {
      const supabase = createAdminClient();

      const activity = await gatherWeeklyActivity(lookbackDays);
      const styleMemory = await loadStyleMemory();
      const post = await generateBlogPost(activity, styleMemory);

      const { data: draft, error: draftError } = await supabase
        .from("blog_drafts")
        .insert({
          week_start: activity.weekStartIso.slice(0, 10),
          week_end: activity.weekEndIso.slice(0, 10),
          status: dryRun ? "draft" : "pending_review",
          title: post.title,
          slug: post.slug,
          markdown: post.markdown,
          teaser: post.teaser,
          metadata: {
            tags: post.tags,
            metaDescription: post.metaDescription,
            dryRun,
          },
          source_activity: activity,
          expires_at: new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString(),
        })
        .select("id, slug")
        .single();

      if (draftError || !draft) throw new Error(draftError?.message ?? "Failed to save blog_draft");

      let prResult: Awaited<ReturnType<typeof createBlogPR>> | null = null;
      let gmailResult: Awaited<ReturnType<typeof createBlogDraftEmail>> | null = null;

      if (!dryRun) {
        try {
          prResult = await createBlogPR(post.slug, post.markdown, post.title);
        } catch (err) {
          console.error("[weekly-dev-log] createBlogPR threw:", err);
          prResult = { ok: false as const, error: err instanceof Error ? err.message : "unknown_pr_error" };
        }

        try {
          gmailResult = await createBlogDraftEmail(post, draft.id, activity.weekStartIso);
        } catch (err) {
          console.error("[weekly-dev-log] createBlogDraftEmail threw:", err);
          gmailResult = { ok: false as const, error: err instanceof Error ? err.message : "unknown_gmail_error" };
        }
      }

      const hasCriticalFailure = !dryRun && (!prResult?.ok || !gmailResult?.ok);

      // Always save partial results for debugging
      await supabase
        .from("blog_drafts")
        .update({
          github_pr_url: prResult && prResult.ok ? prResult.url : null,
          github_pr_number: prResult && prResult.ok ? prResult.number : null,
          gmail_draft_id: gmailResult && gmailResult.ok ? gmailResult.draftId : null,
          gmail_message_id: gmailResult && gmailResult.ok ? gmailResult.messageId : null,
        })
        .eq("id", draft.id);

      // Throw on partial failure so runJob retries instead of caching a broken result
      if (hasCriticalFailure) {
        const failures: string[] = [];
        if (!prResult?.ok) failures.push(`PR: ${prResult?.error ?? "null"}`);
        if (!gmailResult?.ok) failures.push(`Gmail: ${gmailResult?.error ?? "null"}`);
        throw new Error(`Partial failure — ${failures.join(", ")}. Draft saved as ${draft.id}`);
      }

      return {
        ok: true,
        dryRun,
        draftId: draft.id,
        pr: prResult,
        gmail: gmailResult,
        stats: activity.stats,
      };
    },
    { idempotencyKey, maxRetries: 1 },
  );

  return NextResponse.json(result);
}
