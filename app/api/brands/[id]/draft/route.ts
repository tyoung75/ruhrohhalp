import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/processors/claude";
import { BRAND_VOICE_SYSTEM_PROMPT, TYLER_STATS, buildFollowUpPrompt, buildInitialOutreachPrompt } from "@/lib/brands/voice";
import { createBrandDraft } from "@/lib/brands/gmail";

function parseDraft(text: string) {
  const lines = text.split("\n");
  const subjectLine = lines.find((line) => line.toLowerCase().startsWith("subject:"));
  const subject = subjectLine?.replace(/^subject:\s*/i, "").trim() || "Brand x Tyler Young — Partnership";
  const bodyIndex = lines.findIndex((line) => line.toLowerCase().startsWith("body:"));
  const body = (bodyIndex >= 0 ? lines.slice(bodyIndex + 1).join("\n") : text).trim();
  return { subject, body };
}

export async function POST(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const supabase = await createClient();
  const { data: brand, error } = await supabase.from("brand_deals").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  if (!brand.contact_email) return NextResponse.json({ error: "Missing contact email" }, { status: 400 });

  const { data: emails } = await supabase.from("brand_outreach_emails").select("*").eq("brand_deal_id", brand.id).order("sent_at", { ascending: false }).limit(1);
  const emailType = !brand.last_contact_date ? "initial" : brand.follow_up_count === 0 ? "follow_up_1" : "follow_up_2";
  const prompt = emailType === "initial"
    ? buildInitialOutreachPrompt(brand, TYLER_STATS)
    : buildFollowUpPrompt(brand, (emails?.[0] ?? { sent_at: new Date().toISOString(), subject: null, summary: null }), brand.follow_up_count === 0 ? 1 : 2, TYLER_STATS);

  const drafted = await callClaude(BRAND_VOICE_SYSTEM_PROMPT, prompt, 1024);
  const { subject, body } = parseDraft(drafted);
  const gmail = await createBrandDraft(brand.contact_email, subject, body);

  const now = new Date().toISOString();
  await supabase.from("brand_outreach_emails").insert({
    brand_deal_id: brand.id,
    sent_at: now,
    email_type: emailType,
    subject,
    gmail_draft_id: gmail.draftId,
    gmail_message_id: gmail.messageId,
    direction: "outbound",
    summary: body.slice(0, 280),
  });

  await supabase.from("brand_deals").update({ status: "draft_ready", next_action: "Review and send draft", updated_at: now }).eq("id", brand.id);

  return NextResponse.json({ draft_preview: body, gmail_draft_id: gmail.draftId, subject });
}
