import { NextResponse } from "next/server";
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

function parseDraft(text: string) {
  const lines = text.split("\n");
  const subject = lines.find((line) => line.toLowerCase().startsWith("subject:"))?.replace(/^subject:\s*/i, "").trim() ?? "Brand x Tyler Young — Partnership";
  const bodyIndex = lines.findIndex((line) => line.toLowerCase().startsWith("body:"));
  const body = (bodyIndex >= 0 ? lines.slice(bodyIndex + 1).join("\n") : text).trim();
  return { subject, body };
}

export async function POST() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const actionsTaken: Record<string, unknown[]> = { replied: [], drafted: [], archived: [], skipped: [] };

  try {
    const active = await getActivePipeline(user.id);
    const emails = active.map((d) => d.contact_email).filter((e): e is string => Boolean(e));

    // Check for replies (skips gracefully if Gmail is not configured)
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
      await createFollowUpTask(user.id, { ...matched, next_action_date: new Date().toISOString().slice(0, 10), next_action: `Respond to ${matched.brand_name}` });
      actionsTaken.replied.push({ brand: matched.brand_name, classification });
    }

    // Include deals past their next_action_date (not just 10-day-old follow-ups)
    const today = new Date().toISOString().slice(0, 10);
    const sentNeedingAction = active.filter(
      (d) => ["sent", "follow_up_1"].includes(d.status) && d.next_action_date && d.next_action_date <= today && d.follow_up_count < 2,
    );
    const dueFollowUps = await getDueFollowUps(user.id);

    const targets = [
      ...(await getReplied(user.id)),
      ...dueFollowUps,
      ...sentNeedingAction.filter((d) => !dueFollowUps.some((f) => f.id === d.id)),
      ...(await getProspects(user.id)),
    ]
      .filter((d) => d.status !== "form_submitted")
      .slice(0, 3);

    for (const target of targets) {
      if (!target.contact_email) {
        actionsTaken.skipped.push({ brand: target.brand_name, reason: "No contact email" });
        continue;
      }

      try {
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
          next_action: draft.draftId ? "Review and send draft" : "Gmail not connected — draft saved locally",
          next_action_date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
        });

        await createFollowUpTask(user.id, {
          ...target,
          next_action_date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
          next_action: `Follow up with ${target.brand_name}`,
        });

        actionsTaken.drafted.push({ brand: target.brand_name, draftId: draft.draftId, gmail: !!draft.draftId });
      } catch (draftError) {
        logError("brands.run.draft", draftError, { brand: target.brand_name });
        actionsTaken.skipped.push({ brand: target.brand_name, reason: draftError instanceof Error ? draftError.message : "Draft generation failed" });
      }
    }

    const stale = await getStaleDeals(user.id);
    for (const deal of stale) {
      await archiveDeal(deal.id, "No response after full outreach cadence");
      actionsTaken.archived.push({ brand: deal.brand_name });
    }

    const summary = await getPipelineSummary(user.id);
    return NextResponse.json({ ok: true, actions_taken: actionsTaken, pipeline_status: summary });
  } catch (error) {
    logError("brands.run", error, { userId: user.id });
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to run brand sourcing and drafting", detail }, { status: 500 });
  }
}
