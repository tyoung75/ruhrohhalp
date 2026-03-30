import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { runJob } from "@/lib/jobs/executor";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkSentDraft } from "@/lib/blog/gmail-draft";
import { publishEditedBlog } from "@/lib/blog/publish";
import { recordEditLearning } from "@/lib/blog/learning";

export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  const idempotencyKey = `blog-publish-check:${new Date().toISOString().slice(0, 13)}`;

  const result = await runJob(
    "blog-publish-check",
    async () => {
      const supabase = createAdminClient();
      const { data: drafts, error } = await supabase
        .from("blog_drafts")
        .select("id, slug, markdown, github_pr_number, gmail_draft_id")
        .eq("status", "pending_review")
        .not("gmail_draft_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(20);

      if (error) throw new Error(error.message);
      if (!drafts || drafts.length === 0) {
        return { ok: true, checked: 0, published: 0 };
      }

      let published = 0;

      for (const draft of drafts) {
        if (!draft.gmail_draft_id) continue;

        const sent = await checkSentDraft(draft.gmail_draft_id);
        if (!sent.sent || !sent.editedMarkdown) continue;

        await recordEditLearning(draft.id as string, (draft.markdown as string) ?? "", sent.editedMarkdown);

        const publish = await publishEditedBlog({
          prNumber: (draft.github_pr_number as number | null) ?? null,
          slug: (draft.slug as string) ?? `blog-${draft.id}`,
          editedMarkdown: sent.editedMarkdown,
        });

        await supabase
          .from("blog_drafts")
          .update({
            status: publish.ok ? "published" : "expired",
            markdown: sent.editedMarkdown,
            published_at: publish.ok ? new Date().toISOString() : null,
            gmail_message_id: sent.sentMessageId ?? null,
          })
          .eq("id", draft.id);

        if (publish.ok) published += 1;
      }

      return {
        ok: true,
        checked: drafts.length,
        published,
      };
    },
    { idempotencyKey, maxRetries: 1 },
  );

  return NextResponse.json(result);
}
