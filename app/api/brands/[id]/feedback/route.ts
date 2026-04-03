import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedAndStore } from "@/lib/embedding/pipeline";
import { logError } from "@/lib/logger";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id: brandDealId } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { feedback_type, content, email_id } = body as {
    feedback_type?: string;
    content?: string;
    email_id?: string;
  };

  const validTypes = ["like", "dislike", "correction", "directive", "voice_note"];
  const resolvedType = feedback_type ?? "correction";
  if (!validTypes.includes(resolvedType)) {
    return NextResponse.json({ error: `feedback_type must be one of: ${validTypes.join(", ")}` }, { status: 400 });
  }

  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Verify deal belongs to user
  const { data: deal } = await supabase
    .from("brand_deals")
    .select("id, brand_name, status, angle, relationship_notes")
    .eq("id", brandDealId)
    .eq("user_id", user.id)
    .single();

  if (!deal) return NextResponse.json({ error: "Brand deal not found" }, { status: 404 });

  // Get email context if provided
  let emailContext: Record<string, unknown> = {};
  if (email_id) {
    const { data: email } = await supabase
      .from("brand_outreach_emails")
      .select("subject, summary, email_type, direction")
      .eq("id", email_id)
      .eq("brand_deal_id", brandDealId)
      .single();
    if (email) emailContext = email;
  }

  try {
    // Store feedback — use brand_outreach_feedback table if it exists, otherwise content_feedback
    const feedbackRow = {
      user_id: user.id,
      brand_deal_id: brandDealId,
      email_id: email_id ?? null,
      feedback_type: resolvedType,
      content,
      context: { brand_name: deal.brand_name, ...emailContext },
      created_at: new Date().toISOString(),
    };

    // Try brand-specific table first
    let stored: { id: string } | null = null;
    const { data: row, error: brandErr } = await supabase
      .from("brand_outreach_feedback")
      .insert(feedbackRow)
      .select("id")
      .single();

    if (brandErr) {
      // Table might not exist yet — fall back to content_feedback
      const { data: fallback, error: fallbackErr } = await supabase
        .from("content_feedback")
        .insert({
          user_id: user.id,
          content_queue_id: null,
          feedback_type: resolvedType,
          content,
          context: { source: "brand_outreach", brand_deal_id: brandDealId, brand_name: deal.brand_name, ...emailContext },
          active: true,
        })
        .select("id")
        .single();

      if (fallbackErr) throw new Error(fallbackErr.message);
      stored = fallback;
    } else {
      stored = row;
    }

    // Embed into semantic memory with UNIFIED tags so feedback cascades
    // across content, brand, and strategy systems
    const tagMap: Record<string, string> = {
      like: "feedback:liked",
      dislike: "feedback:disliked",
      correction: "feedback:correction",
      directive: "feedback:directive",
      voice_note: "feedback:correction",
    };

    const memoryText = [
      `[BRAND OUTREACH FEEDBACK: ${resolvedType.toUpperCase()}]`,
      `Brand: ${deal.brand_name}`,
      content,
      emailContext.subject ? `Email subject: ${emailContext.subject}` : null,
      emailContext.summary ? `Draft preview: ${emailContext.summary}` : null,
    ].filter(Boolean).join("\n");

    try {
      await embedAndStore(memoryText, {
        userId: user.id,
        source: "manual",
        sourceId: `brand-feedback:${stored!.id}`,
        category: "general",
        importance: resolvedType === "directive" ? 9 : resolvedType === "dislike" ? 8 : 6,
        tags: [
          tagMap[resolvedType] ?? "feedback:correction",
          "domain:brand",
          "system:feedback",
          `brand:${deal.brand_name.toLowerCase().replace(/\s+/g, "-")}`,
        ],
      });
    } catch (embedErr) {
      logError("brands.feedback.embed", embedErr, { feedbackId: stored!.id });
    }

    return NextResponse.json({ ok: true, feedback_id: stored!.id });
  } catch (error) {
    logError("brands.feedback", error);
    return NextResponse.json({ error: "Failed to store feedback" }, { status: 500 });
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id: brandDealId } = await context.params;
  const supabase = createAdminClient();

  // Try brand-specific table first
  const { data, error } = await supabase
    .from("brand_outreach_feedback")
    .select("id, feedback_type, content, email_id, created_at")
    .eq("brand_deal_id", brandDealId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    // Fall back to content_feedback
    const { data: fallback } = await supabase
      .from("content_feedback")
      .select("id, feedback_type, content, created_at")
      .eq("user_id", user.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(20);

    const brandFeedback = (fallback ?? []).filter(
      (f) => (f as unknown as { context?: { brand_deal_id?: string } }).context?.brand_deal_id === brandDealId,
    );
    return NextResponse.json({ feedback: brandFeedback });
  }

  return NextResponse.json({ feedback: data ?? [] });
}
