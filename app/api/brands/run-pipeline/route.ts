import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { callClaude } from "@/lib/processors/claude";
import { createBrandDraft, searchForBrandReplies, classifyReply } from "@/lib/brands/gmail";
import {
  archiveDeal,
  createFollowUpTask,
  getActivePipeline,
  getDueFollowUps,
  getPipelineSummary,
  getProspects,
  getReplied,
  getStaleDeals,
  recordEmail,
  updateDealStatus,
} from "@/lib/brands/pipeline";
import { BRAND_VOICE_SYSTEM_PROMPT, TYLER_STATS, buildFollowUpPrompt, buildInitialOutreachPrompt } from "@/lib/brands/voice";

export const maxDuration = 60;

function parseDraft(text: string) {
  const lines = text.split("\n");
  const subject = lines.find((line) => line.toLowerCase().startsWith("subject:"))?.replace(/^subject:\s*/i, "").trim() ?? "Brand x Tyler Young — Partnership";
  const bodyIndex = lines.findIndex((line) => line.toLowerCase().startsWith("body:"));
  const body = (bodyIndex >= 0 ? lines.slice(bodyIndex + 1).join("\n") : text).trim();
  return { subject, body };
}

/** Manual pipeline trigger — same logic as the cron but uses user auth instead of CRON_SECRET */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const userId = user.id;
  const actionsTaken: Record<string, unknown[]> = { replied: [], drafted: [], archived: [], skipped: [] };

  try {
    // 1. Check for replies from brand contacts
    const active = await getActivePipeline(userId);
    const emails = active.map((d) => d.contact_email).filter((e): e is string => Boolean(e));

    const replies = await searchForBrandReplies(emails);
    for (const reply of replies) {
      const matched = active.find((d) => d.contact_email && reply.from.includes(d.contact_email));
      if (!matched) continue;

      const classification = await classifyReply(reply.subject, reply.body);
      await updateDealStatus(matched.id, "replied", { last_reply_date: new Date().toISOString(), next_action: `Reply needed (${classification})` });
      await recordEmail({
        brand_deal_id: matched.id,
        sent_at: new Date().toISOString(),
        email_type: "response",
        subject: reply.subject,
        gmail_thread_id: reply.threadId,
        gmail_message_id: reply.messageId,
        gmail_draft_id: null,
        direction: "inbound",
        summary: reply.body.slice(0, 280),
      });
      await createFollowUpTask(userId, { ...matched, next_action_date: new Date().toISOString().slice(0, 10), next_action: `Respond to ${matched.brand_name}` });
      actionsTaken.replied.push({ brand: matched.brand_name, classification });
    }

    // 2. Select targets for draft generation
    // Include: prospects needing initial outreach, deals needing follow-ups, and replied deals needing responses
    const prospects = await getProspects(userId);
    const dueFollowUps = await getDueFollowUps(userId);
    const replied = await getReplied(userId);

    // Also include "sent" deals that have a next_action_date <= today (even if < 10 days)
    const today = new Date().toISOString().slice(0, 10);
    const sentDealsNeedingAction = active.filter(
      (d) => ["sent", "follow_up_1"].includes(d.status) && d.next_action_date && d.next_action_date <= today && d.follow_up_count < 2,
    );

    const targets = [
      ...replied,
      ...dueFollowUps,
      ...sentDealsNeedingAction.filter((d) => !dueFollowUps.some((f) => f.id === d.id)),
      ...prospects,
    ]
      .filter((d) => d.status !== "form_submitted")
      .slice(0, 3);

    for (const target of targets) {
      if (!target.contact_email) {
        actionsTaken.skipped.push({ brand: target.brand_name, reason: "No contact email" });
        continue;
      }
      const emailType = !target.last_contact_date ? "initial" : target.follow_up_count === 0 ? "follow_up_1" : "follow_up_2";
      const prompt = emailType === "initial"
        ? buildInitialOutreachPrompt(target, TYLER_STATS)
        : buildFollowUpPrompt(
            target,
            {
              id: "",
              brand_deal_id: target.id,
              sent_at: target.last_contact_date ?? new Date().toISOString(),
              email_type: emailType,
              subject: null,
              gmail_thread_id: null,
              gmail_message_id: null,
              gmail_draft_id: null,
              direction: "outbound",
              summary: null,
              created_at: new Date().toISOString(),
            },
            target.follow_up_count === 0 ? 1 : 2,
            TYLER_STATS,
          );
      const generated = await callClaude(BRAND_VOICE_SYSTEM_PROMPT, prompt, 1024);
      const parsed = parseDraft(generated);
      const draft = await createBrandDraft(target.contact_email, parsed.subject, parsed.body);

      await recordEmail({
        brand_deal_id: target.id,
        sent_at: new Date().toISOString(),
        email_type: emailType,
        subject: parsed.subject,
        gmail_thread_id: null,
        gmail_message_id: draft.messageId,
        gmail_draft_id: draft.draftId,
        direction: "outbound",
        summary: parsed.body.slice(0, 280),
      });

      await updateDealStatus(target.id, "draft_ready", {
        next_action: "Review and send draft",
        next_action_date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
      });

      actionsTaken.drafted.push({ brand: target.brand_name, subject: parsed.subject, draftId: draft.draftId, preview: parsed.body.slice(0, 200) });
    }

    // 3. Archive stale deals
    const stale = await getStaleDeals(userId);
    for (const deal of stale) {
      await archiveDeal(deal.id, "No response after full outreach cadence");
      actionsTaken.archived.push({ brand: deal.brand_name });
    }

    const summary = await getPipelineSummary(userId);

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      actions_taken: actionsTaken,
      pipeline_status: summary,
    });
  } catch (error) {
    logError("brands.run-pipeline", error);
    return NextResponse.json({ error: "Pipeline run failed", detail: String(error) }, { status: 500 });
  }
}
