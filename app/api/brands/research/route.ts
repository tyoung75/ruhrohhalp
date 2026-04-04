import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/processors/claude";
import { TYLER_STATS, formatStatsBlock } from "@/lib/brands/voice";
import { logError } from "@/lib/logger";

export const maxDuration = 60;

/**
 * POST /api/brands/research
 * Takes a free-text prompt (e.g. "I want to work with Hyperice") and returns
 * a researched outreach strategy + pre-filled brand deal data.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json().catch(() => null);
  const prompt = (body?.prompt as string)?.trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

  try {
    const supabase = await createClient();

    // Load existing deals for context
    const { data: existing } = await supabase
      .from("brand_deals")
      .select("brand_name, status, relationship_notes, angle")
      .eq("user_id", user.id);

    // Load past feedback to inform strategy
    let feedbackContext = "";
    const { data: feedback } = await supabase
      .from("brand_outreach_feedback")
      .select("feedback_type, content")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (feedback && feedback.length > 0) {
      feedbackContext = "\n\nPast outreach feedback (learn from this for tone/approach):\n" +
        feedback.map((f) => `- [${f.feedback_type}] ${f.content}`).join("\n");
    }

    const existingNames = (existing ?? []).map((d) => d.brand_name).join(", ");

    const systemPrompt = `You are a brand partnership strategist for Tyler Young, a fitness content creator.

Tyler's stats:
${formatStatsBlock(TYLER_STATS)}

Your job is to research a brand Tyler wants to work with and create a complete outreach strategy.

RULES:
- Be specific and actionable — not generic advice
- Research the brand's likely partnership structure, creator programs, and contact channels
- The contact_email should be your best guess (partnerships@, creators@, influencer@, etc.) — use common patterns for that brand
- The angle must be authentic to Tyler's actual life and content, not a generic pitch
- Relationship notes should capture any existing connection (even if just "active customer")
- product_usage should be specific: what products, how Tyler uses them, how often
- dont_say should include any phrases that would sound inauthentic or generic for this brand
- Think about what makes Tyler different from other micro-creators pitching this brand
- Include outreach_strategy with specific steps and timing

Output EXACTLY this JSON (no markdown fences):
{
  "brand_name": "string",
  "contact_email": "string or null",
  "contact_name": "string or null",
  "contact_confidence": "high|medium|low",
  "priority": "P0|P1|P2",
  "relationship_type": "active_user|regular_buyer|new|long_term|competitor",
  "relationship_notes": "string",
  "product_usage": "string",
  "angle": "string",
  "dont_say": ["string"],
  "estimated_value_low": number,
  "estimated_value_high": number,
  "deal_type": "one_time|monthly|affiliate|product_seeding|ambassador",
  "outreach_strategy": {
    "approach": "string — the overall strategy",
    "best_contact_method": "string — email, DM, form, etc.",
    "alternative_contacts": ["string"],
    "timing_notes": "string — when to reach out and why",
    "key_differentiators": ["string — what makes Tyler stand out for this brand"],
    "suggested_subject": "string",
    "talking_points": ["string"]
  }
}`;

    const userPrompt = `Tyler says: "${prompt}"

Already in pipeline (for context, not to re-recommend): ${existingNames || "none"}
${feedbackContext}

Research this brand and create a full outreach strategy. Be specific to Tyler's actual life, training, and content.`;

    const raw = await callClaude(systemPrompt, userPrompt, 2048);

    let result;
    try {
      const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      try {
        result = JSON.parse(cleaned);
      } catch {
        const objMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!objMatch) throw new Error("No JSON object found in response");
        result = JSON.parse(objMatch[0]);
      }
    } catch (parseErr) {
      logError("brands.research.parse", parseErr instanceof Error ? parseErr : new Error("Failed to parse"), { raw: raw.slice(0, 500) });
      return NextResponse.json({ error: "Failed to parse research results", raw: raw.slice(0, 500) }, { status: 500 });
    }

    return NextResponse.json({ ok: true, research: result });
  } catch (error) {
    logError("brands.research", error);
    return NextResponse.json({ error: "Brand research failed", detail: String(error) }, { status: 500 });
  }
}
