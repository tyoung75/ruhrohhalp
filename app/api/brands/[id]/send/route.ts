import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getGmailClient, encodeMessage } from "@/lib/google/gmail";
import { logError } from "@/lib/logger";

/**
 * POST /api/brands/[id]/send — Send a Gmail draft for a brand deal.
 * Looks up the most recent outbound email with a gmail_draft_id and sends it.
 * Alternatively accepts { gmail_draft_id } in the body to send a specific draft.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const supabase = await createClient();

  // Verify deal ownership
  const { data: deal } = await supabase
    .from("brand_deals")
    .select("id, brand_name, contact_email, follow_up_count")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!deal) return NextResponse.json({ error: "Brand deal not found" }, { status: 404 });

  // Find the draft to send
  let draftId = body.gmail_draft_id as string | undefined;
  if (!draftId) {
    const { data: latestEmail } = await supabase
      .from("brand_outreach_emails")
      .select("gmail_draft_id")
      .eq("brand_deal_id", id)
      .eq("direction", "outbound")
      .not("gmail_draft_id", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .single();

    draftId = latestEmail?.gmail_draft_id ?? undefined;
  }

  if (!draftId) {
    return NextResponse.json({ error: "No draft found to send. Generate a draft first." }, { status: 400 });
  }

  const gmail = getGmailClient();
  if (!gmail) {
    return NextResponse.json({ error: "Gmail not configured" }, { status: 503 });
  }

  try {
    const sent = await gmail.users.drafts.send({
      userId: "me",
      requestBody: { id: draftId },
    });

    const now = new Date().toISOString();
    const newStatus = deal.follow_up_count === 0 ? "sent" : `follow_up_${Math.min(deal.follow_up_count, 2)}`;

    await supabase
      .from("brand_deals")
      .update({
        status: newStatus,
        last_contact_date: now,
        follow_up_count: deal.follow_up_count + 1,
        next_action: "Wait for reply",
        next_action_date: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
        updated_at: now,
      })
      .eq("id", id);

    // Update the email record to clear draft_id (it's been sent)
    await supabase
      .from("brand_outreach_emails")
      .update({ gmail_draft_id: null, gmail_message_id: sent.data.message?.id ?? null })
      .eq("brand_deal_id", id)
      .eq("gmail_draft_id", draftId);

    return NextResponse.json({
      ok: true,
      message_id: sent.data.message?.id,
      brand: deal.brand_name,
      new_status: newStatus,
    });
  } catch (error) {
    logError("brands.send", error);
    return NextResponse.json({ error: "Failed to send email", detail: String(error) }, { status: 500 });
  }
}
