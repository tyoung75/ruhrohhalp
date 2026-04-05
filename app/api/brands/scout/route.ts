import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { callClaude } from "@/lib/processors/claude";
import { TYLER_STATS, formatStatsBlock } from "@/lib/brands/voice";
import { logError } from "@/lib/logger";

export const maxDuration = 120;

interface ScoutRecommendation {
  brand_name: string;
  contact_email: string | null;
  contact_source: string;
  why: string;
  relationship_type: string;
  product_usage: string;
  angle: string;
  estimated_value_low: number;
  estimated_value_high: number;
  priority: string;
  source: "claude" | "chatgpt";
}

const SCOUT_SYSTEM_PROMPT = `You are a brand partnership scout for Tyler Young, a fitness micro-creator.

YOUR #1 JOB: Find brands that ACTIVELY partner with micro-creators (under 10K followers) and are most likely to result in a deal.

Tyler's stats:
{STATS}

RULES:
1. Recommend brands known to work with micro-creators or that have creator/ambassador programs
2. For contact_email: use the brand's real partnerships email if you know it (partnerships@, creators@, ambassadors@ patterns). If unsure, set null.
3. contact_source: explain where you'd find the contact (e.g. "Brand website /partnerships page", "Creator program application", "Instagram bio link"). If guessing the email pattern, say so.
4. Focus on: running, HYROX, strength training, nutrition, recovery, tech/productivity brands
5. Prioritize brands Tyler already uses or would genuinely use
6. Think DTC and emerging brands — they're more likely to work with micro-creators than Nike or Adidas
7. Factor in realistic deal sizes: $200-2000 per deal, product seeding, or affiliate
8. You MUST return exactly 3 brands. Do not return an empty array.

Output EXACTLY a JSON array of 3 objects with these fields:
brand_name, contact_email (string or null), contact_source (string), why, relationship_type ("active_user"|"regular_buyer"|"new"|"long_term"), product_usage, angle, estimated_value_low (number), estimated_value_high (number), priority ("P0"|"P1"|"P2")

Return ONLY the JSON array, no markdown fences, no explanation.`;

async function scoutWithClaude(
  existingContext: string,
  feedbackContext: string,
  focus: string,
): Promise<ScoutRecommendation[]> {
  const systemPrompt = SCOUT_SYSTEM_PROMPT.replace("{STATS}", formatStatsBlock(TYLER_STATS));

  const userPrompt = `Find exactly 3 brand partnership prospects for Tyler Young — a fitness micro-creator with ~6K TikTok followers who runs marathons, does HYROX, and strength trains.

${focus ? `Focus area: ${focus}` : ""}

IMPORTANT: Only include brands where:
- The brand has a known creator/ambassador program OR has worked with micro-creators before
- You can provide a REAL contact email or application URL (not guessed)
- The partnership is realistic for someone with ~6K followers

CRITICAL — DO NOT recommend ANY of these brands (they are already in Tyler's pipeline):
${existingContext || "None yet"}
${feedbackContext}

You MUST find brands NOT on the above list. Think beyond the obvious — find emerging DTC brands, local Austin brands, or niche fitness/running brands that most people wouldn't think of.`;

  const raw = await callClaude(systemPrompt, userPrompt, 2048);
  const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) throw new Error("No JSON array found in Claude response");
    parsed = JSON.parse(arrayMatch[0]);
  }
  if (!Array.isArray(parsed)) throw new Error("Claude response is not an array");
  return parsed.slice(0, 3).map((r: ScoutRecommendation) => ({ ...r, source: "claude" as const }));
}

async function scoutWithChatGPT(
  existingContext: string,
  feedbackContext: string,
  focus: string,
): Promise<ScoutRecommendation[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const statsBlock = formatStatsBlock(TYLER_STATS);

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(55_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      instructions: `You are a brand partnership scout. Use web search to find REAL brands with active creator/ambassador programs for micro-creators (under 10K followers).

SEARCH STRATEGY:
- Search for "micro creator ambassador program fitness 2025 2026"
- Search for "running brand ambassador program small creators"
- Search for "HYROX sponsor micro influencer program"
- Search for "fitness brand creator partnerships application"
- Search for "DTC fitness brand ambassador program"

For each brand you find, VERIFY:
1. They actually have a creator program or work with small creators
2. Find the REAL contact email or application URL from their website
3. The contact_source must cite WHERE you found this info (URL or page name)

Tyler's stats:
${statsBlock}`,
      input: `Search the web and find exactly 3 fitness/running/HYROX/nutrition brands that:
1. Have ACTIVE creator or ambassador programs accepting micro-creators (~6K TikTok followers)
2. Have a VERIFIED contact method (real email or application form you found on their site)
3. Would be a genuine fit for a marathon runner / HYROX athlete / strength training creator

${focus ? `Focus area: ${focus}` : ""}

CRITICAL — DO NOT recommend ANY of these brands (they are already in Tyler's pipeline):
${existingContext || "None yet"}
${feedbackContext}

You MUST find brands NOT on the above list. Search for emerging DTC brands, local Austin brands, or niche fitness/running/HYROX brands.

Return ONLY a JSON array of exactly 3 objects with these fields:
brand_name, contact_email (real verified email or null), contact_source (the URL or page where you found the contact), why, relationship_type ("active_user"|"regular_buyer"|"new"|"long_term"), product_usage (specific products Tyler could use), angle (specific pitch angle), estimated_value_low (number in dollars), estimated_value_high (number in dollars), priority ("P0"|"P1"|"P2")

Return ONLY the raw JSON array — no markdown, no explanation.`,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `ChatGPT web search failed (${res.status})`);
  }

  // Extract text from the Responses API output
  const outputText =
    data.output?.find((o: { type: string }) => o.type === "message")?.content?.find(
      (c: { type: string }) => c.type === "output_text",
    )?.text ?? "";

  if (!outputText) throw new Error("Empty response from ChatGPT web search");

  const cleaned = outputText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) throw new Error("No JSON array found in ChatGPT response");
    parsed = JSON.parse(arrayMatch[0]);
  }
  if (!Array.isArray(parsed)) throw new Error("ChatGPT response is not an array");
  return parsed.slice(0, 3).map((r: ScoutRecommendation) => ({ ...r, source: "chatgpt" as const }));
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json().catch(() => null);
  const focus = (body?.focus as string) ?? "";

  try {
    const supabase = await createClient();

    // Load existing pipeline to avoid duplicates
    const { data: existing, error: existingErr } = await supabase
      .from("brand_deals")
      .select("brand_name, status, priority, relationship_type, archive_reason")
      .eq("user_id", user.id);

    if (existingErr) {
      logError("brands.scout.load_existing", new Error(existingErr.message));
      return NextResponse.json({ error: "Failed to load existing brands", detail: existingErr.message }, { status: 500 });
    }

    const existingBrands = (existing ?? []).map((d: { brand_name: string }) => d.brand_name);
    const existingContext = (existing ?? [])
      .map((d: { brand_name: string; status: string; archive_reason: string | null }) => `${d.brand_name} (${d.status}${d.archive_reason ? ` — archived: ${d.archive_reason}` : ""})`)
      .join("\n");

    // Load past brand feedback to inform scouting
    let feedbackContext = "";
    const { data: feedback, error: fbErr } = await supabase
      .from("brand_outreach_feedback")
      .select("brand_deal_id, feedback_type, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (fbErr) {
      // Non-fatal — continue without feedback context
      logError("brands.scout.load_feedback", new Error(fbErr.message));
    } else if (feedback && feedback.length > 0) {
      feedbackContext = "\n\nPast brand feedback (learn from this):\n" + feedback.map((f: { feedback_type: string; content: string }) =>
        `- [${f.feedback_type}] ${f.content}`
      ).join("\n");
    }

    // Run Claude and ChatGPT scouts in parallel
    const [claudeResult, chatgptResult] = await Promise.allSettled([
      scoutWithClaude(existingContext, feedbackContext, focus),
      scoutWithChatGPT(existingContext, feedbackContext, focus),
    ]);

    const claudeBrands: ScoutRecommendation[] = claudeResult.status === "fulfilled" ? claudeResult.value : [];
    const chatgptBrands: ScoutRecommendation[] = chatgptResult.status === "fulfilled" ? chatgptResult.value : [];

    if (claudeResult.status === "rejected") {
      logError("brands.scout.claude", new Error(String(claudeResult.reason)));
    }
    if (chatgptResult.status === "rejected") {
      logError("brands.scout.chatgpt", new Error(String(chatgptResult.reason)));
    }

    // Deduplicate across providers — prefer ChatGPT (web-searched) over Claude
    const seen = new Set<string>();
    const deduped: ScoutRecommendation[] = [];
    for (const rec of [...chatgptBrands, ...claudeBrands]) {
      const key = rec.brand_name.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(rec);
      }
    }

    // Filter out any that match existing brands
    const filteredOut = deduped
      .filter((r) => existingBrands.some((name: string) => name.toLowerCase() === r.brand_name.toLowerCase()))
      .map((r) => r.brand_name);
    const filtered = deduped.filter(
      (r) => !existingBrands.some((name: string) => name.toLowerCase() === r.brand_name.toLowerCase()),
    );

    // Persist scouted brands as 'scouted' status
    const now = new Date().toISOString();
    let persisted = 0;
    const insertErrors: { brand: string; error: string }[] = [];
    for (const rec of filtered) {
      const row = {
        user_id: user.id,
        brand_name: rec.brand_name,
        contact_email: rec.contact_email ?? null,
        status: "scouted" as const,
        priority: rec.priority ?? null,
        relationship_type: rec.relationship_type ?? null,
        product_usage: rec.product_usage ?? null,
        angle: rec.angle ?? null,
        estimated_value_low: typeof rec.estimated_value_low === "number" ? rec.estimated_value_low : null,
        estimated_value_high: typeof rec.estimated_value_high === "number" ? rec.estimated_value_high : null,
        scout_reason: `[${rec.source.toUpperCase()}] ${rec.why}${rec.contact_source ? ` | Contact via: ${rec.contact_source}` : ""}`,
      };
      const { error: insertErr } = await supabase.from("brand_deals").insert(row);
      if (insertErr) {
        logError("brands.scout.insert", new Error(insertErr.message), { brand: rec.brand_name, row });
        insertErrors.push({ brand: rec.brand_name, error: insertErr.message });
      } else {
        persisted++;
      }
    }

    const errors = {
      claude: claudeResult.status === "rejected" ? String(claudeResult.reason) : null,
      chatgpt: chatgptResult.status === "rejected" ? String(chatgptResult.reason) : null,
    };

    // If both providers failed, return 500 with details
    if (claudeBrands.length === 0 && chatgptBrands.length === 0 && (errors.claude || errors.chatgpt)) {
      return NextResponse.json({
        error: "Both brand scouts failed",
        detail: [errors.claude, errors.chatgpt].filter(Boolean).join("; "),
        errors,
      }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      recommendations: filtered,
      claude_brands: claudeBrands,
      chatgpt_brands: chatgptBrands,
      persisted,
      attempted: filtered.length,
      filtered_out: filteredOut,
      insert_errors: insertErrors,
      existing_in_db: existingBrands,
      focus: focus || null,
      existing_count: existingBrands.length,
      errors,
    });
  } catch (error) {
    logError("brands.scout", error);
    return NextResponse.json({ error: "Brand scouting failed", detail: String(error) }, { status: 500 });
  }
}
