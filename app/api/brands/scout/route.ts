import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/processors/claude";
import { TYLER_STATS, formatStatsBlock } from "@/lib/brands/voice";
import { logError } from "@/lib/logger";

export const maxDuration = 60;

interface ScoutRecommendation {
  brand_name: string;
  contact_email: string | null;
  why: string;
  relationship_type: string;
  product_usage: string;
  angle: string;
  estimated_value_low: number;
  estimated_value_high: number;
  priority: string;
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json().catch(() => null);
  const focus = (body?.focus as string) ?? "";

  try {
    const supabase = await createClient();

    // Load existing pipeline to avoid duplicates
    const { data: existing } = await supabase
      .from("brand_deals")
      .select("brand_name, status, priority, relationship_type, archive_reason")
      .eq("user_id", user.id);

    const existingBrands = (existing ?? []).map((d) => d.brand_name);
    const existingContext = (existing ?? [])
      .map((d) => `${d.brand_name} (${d.status}${d.archive_reason ? ` — archived: ${d.archive_reason}` : ""})`)
      .join("\n");

    // Load past brand feedback to inform scouting
    let feedbackContext = "";
    const { data: feedback, error: fbErr } = await supabase
      .from("brand_outreach_feedback")
      .select("brand_deal_id, feedback_type, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!fbErr && feedback && feedback.length > 0) {
      feedbackContext = "\n\nPast brand feedback (learn from this):\n" + feedback.map((f) =>
        `- [${f.feedback_type}] ${f.content}`
      ).join("\n");
    }

    const systemPrompt = `You are a brand partnership scout for Tyler Young, a fitness content creator.
Your job is to find brands that authentically align with Tyler's life, training, and content.

CRITICAL RULES:
- Only recommend brands Tyler actually uses OR would genuinely use
- Every recommendation must have a real, specific product usage angle — not generic "Tyler could promote this"
- Prioritize brands where Tyler is already a customer or has genuine experience
- Consider Tyler's content pillars: running (Berlin Marathon training), HYROX, strength training, nutrition, recovery, tech/productivity
- Think about brands at all levels — emerging DTC brands are often better fits than mega-corps
- Factor in realistic deal sizes for a creator with ~6K TikTok followers (not mega-influencer rates)

Tyler's stats:
${formatStatsBlock(TYLER_STATS)}

Output EXACTLY a JSON array of objects with these fields:
brand_name, contact_email (null if unknown), why, relationship_type ("active_user"|"regular_buyer"|"new"|"long_term"), product_usage, angle, estimated_value_low (number), estimated_value_high (number), priority ("P0"|"P1"|"P2")

Return ONLY the JSON array, no markdown fences, no explanation.`;

    const userPrompt = `Find 3-5 brand partnership prospects for Tyler Young.
${focus ? `\nFocus area: ${focus}` : ""}

Already in pipeline (DO NOT recommend these):
${existingContext || "None yet"}
${feedbackContext}

Recommend brands that are:
1. Authentic — Tyler uses or would genuinely use the product
2. Realistic — appropriate for a micro-creator (~6K followers)
3. Specific — include exact product usage and pitch angle
4. Actionable — include a contact email if you can reasonably guess it (partnerships@brand.com pattern)`;

    const raw = await callClaude(systemPrompt, userPrompt, 2048);

    // Parse the JSON response — extract the JSON array even if Claude adds surrounding text
    let recommendations: ScoutRecommendation[];
    try {
      const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      // Try direct parse first, then extract the JSON array from surrounding text
      try {
        recommendations = JSON.parse(cleaned);
      } catch {
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (!arrayMatch) throw new Error("No JSON array found in response");
        recommendations = JSON.parse(arrayMatch[0]);
      }
      if (!Array.isArray(recommendations)) {
        throw new Error("Response is not an array");
      }
    } catch (parseErr) {
      logError("brands.scout.parse", parseErr instanceof Error ? parseErr : new Error("Failed to parse scout response"), { raw: raw.slice(0, 500) });
      return NextResponse.json({ error: "Failed to parse brand recommendations", raw: raw.slice(0, 500) }, { status: 500 });
    }

    // Filter out any that match existing brands
    const filtered = recommendations.filter(
      (r) => !existingBrands.some((name) => name.toLowerCase() === r.brand_name.toLowerCase()),
    );

    // Persist scouted brands as 'scouted' status so they don't vanish
    const now = new Date().toISOString();
    let persisted = 0;
    for (const rec of filtered) {
      const { error: insertErr } = await supabase.from("brand_deals").insert({
        user_id: user.id,
        brand_name: rec.brand_name,
        contact_email: rec.contact_email,
        status: "scouted",
        priority: rec.priority,
        relationship_type: rec.relationship_type,
        product_usage: rec.product_usage,
        angle: rec.angle,
        estimated_value_low: rec.estimated_value_low,
        estimated_value_high: rec.estimated_value_high,
        scout_reason: rec.why,
        created_at: now,
        updated_at: now,
      });
      if (insertErr) {
        logError("brands.scout.insert", new Error(insertErr.message), { brand: rec.brand_name });
      } else {
        persisted++;
      }
    }

    return NextResponse.json({
      ok: true,
      recommendations: filtered,
      persisted,
      focus: focus || null,
      existing_count: existingBrands.length,
    });
  } catch (error) {
    logError("brands.scout", error);
    return NextResponse.json({ error: "Brand scouting failed", detail: String(error) }, { status: 500 });
  }
}
