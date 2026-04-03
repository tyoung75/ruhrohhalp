import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/processors/claude";
import { BRAND_VOICE_SYSTEM_PROMPT, TYLER_STATS, formatStatsBlock } from "@/lib/brands/voice";
import { createBrandDraft } from "@/lib/brands/gmail";
import { logError } from "@/lib/logger";

function parseDraft(text: string) {
  const lines = text.split("\n");
  const subject = lines.find((line) => line.toLowerCase().startsWith("subject:"))?.replace(/^subject:\s*/i, "").trim() ?? "Brand x Tyler Young — Partnership";
  const bodyIndex = lines.findIndex((line) => line.toLowerCase().startsWith("body:"));
  const body = (bodyIndex >= 0 ? lines.slice(bodyIndex + 1).join("\n") : text).trim();
  return { subject, body };
}

/**
 * POST /api/brands/[id]/revise — Revise a draft based on feedback.
 * Body: { feedback: string, email_id?: string }
 * Loads the current draft, applies the feedback, generates a new version.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body?.feedback) return NextResponse.json({ error: "feedback is required" }, { status: 400 });

  const feedback = body.feedback as string;
  const supabase = await createClient();

  const { data: deal } = await supabase
    .from("brand_deals")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!deal) return NextResponse.json({ error: "Brand deal not found" }, { status: 404 });
  if (!deal.contact_email) return NextResponse.json({ error: "Missing contact email" }, { status: 400 });

  // Get the most recent outbound email (the draft to revise)
  const { data: latestEmail } = await supabase
    .from("brand_outreach_emails")
    .select("*")
    .eq("brand_deal_id", id)
    .eq("direction", "outbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .single();

  try {
    const revisePrompt = `Revise this brand outreach email based on Tyler's feedback.

ORIGINAL EMAIL:
Subject: ${latestEmail?.subject ?? "unknown"}
Body:
${latestEmail?.summary ?? "No draft found — write a new initial outreach."}

TYLER'S FEEDBACK:
${feedback}

Brand context:
- Brand: ${deal.brand_name}
- Relationship: ${deal.relationship_notes ?? "none"}
- Product usage: ${deal.product_usage ?? "none"}
- Angle: ${deal.angle ?? "none"}
- Avoid: ${deal.dont_say?.length ? deal.dont_say.join(" | ") : "none"}

Tyler's stats:
${formatStatsBlock(TYLER_STATS)}

Apply the feedback precisely. Keep the same general structure unless the feedback says otherwise. Output the revised email in SUBJECT: / BODY: format.`;

    const generated = await callClaude(BRAND_VOICE_SYSTEM_PROMPT, revisePrompt, 1024);
    const parsed = parseDraft(generated);
    const gmail = await createBrandDraft(deal.contact_email, parsed.subject, parsed.body);

    const now = new Date().toISOString();
    await supabase.from("brand_outreach_emails").insert({
      brand_deal_id: deal.id,
      sent_at: now,
      email_type: latestEmail?.email_type ?? "initial",
      subject: parsed.subject,
      gmail_draft_id: gmail.draftId,
      gmail_message_id: gmail.messageId,
      direction: "outbound",
      summary: parsed.body.slice(0, 280),
    });

    await supabase
      .from("brand_deals")
      .update({ status: "draft_ready", next_action: "Review revised draft", updated_at: now })
      .eq("id", deal.id);

    return NextResponse.json({
      ok: true,
      draft_preview: parsed.body,
      subject: parsed.subject,
      gmail_draft_id: gmail.draftId,
      revision_based_on: feedback,
    });
  } catch (error) {
    logError("brands.revise", error);
    return NextResponse.json({ error: "Failed to revise draft", detail: String(error) }, { status: 500 });
  }
}
