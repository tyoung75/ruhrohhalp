import { NextRequest, NextResponse } from "next/server";
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
const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

function parseDraft(text: string) {
  const lines = text.split("\n");
  const subject = lines.find((line) => line.toLowerCase().startsWith("subject:"))?.replace(/^subject:\s*/i, "").trim() ?? "Brand x Tyler Young — Partnership";
  const bodyIndex = lines.findIndex((line) => line.toLowerCase().startsWith("body:"));
  const body = (bodyIndex >= 0 ? lines.slice(bodyIndex + 1).join("\n") : text).trim();
  return { subject, body };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const actionsTaken: Record<string, unknown[]> = { replied: [], drafted: [], archived: [] };

  try {
    const active = await getActivePipeline(TYLER_USER_ID);
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
      await createFollowUpTask(TYLER_USER_ID, { ...matched, next_action_date: new Date().toISOString().slice(0, 10), next_action: `Respond to ${matched.brand_name}` });
      actionsTaken.replied.push({ brand: matched.brand_name, classification });
    }

    const targets = [
      ...(await getReplied(TYLER_USER_ID)),
      ...(await getDueFollowUps(TYLER_USER_ID)),
      ...(await getProspects(TYLER_USER_ID)),
    ]
      .filter((d) => d.status !== "form_submitted")
      .slice(0, 2);

    for (const target of targets) {
      if (!target.contact_email) continue;
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

      await createFollowUpTask(TYLER_USER_ID, {
        ...target,
        next_action_date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
        next_action: `Follow up with ${target.brand_name}`,
      });

      actionsTaken.drafted.push({ brand: target.brand_name, draftId: draft.draftId });
    }

    const stale = await getStaleDeals(TYLER_USER_ID);
    for (const deal of stale) {
      await archiveDeal(deal.id, "No response after full outreach cadence");
      actionsTaken.archived.push({ brand: deal.brand_name });
    }

    const summary = await getPipelineSummary(TYLER_USER_ID);

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      actions_taken: actionsTaken,
      pipeline_status: summary,
    });
  } catch (error) {
    logError("cron.brand-outreach", error);
    return NextResponse.json({ error: "Brand outreach cron failed" }, { status: 500 });
  }
}
