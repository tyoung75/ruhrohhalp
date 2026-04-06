import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
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

// Use "prospect" as default status — "scouted" may not exist in older DB schemas
const INSERT_STATUS = "prospect";
const VALID_PRIORITIES = ["P0", "P1", "P2"];
const VALID_RELATIONSHIP_TYPES = ["long_term", "active_user", "new", "regular_buyer", "competitor"];

function buildSystemPrompt(): string {
  return `You are a brand partnership scout for Tyler Young, a fitness content creator based in Austin, TX.

Tyler's stats:
${formatStatsBlock(TYLER_STATS)}

Find brands that would genuinely partner with a micro-creator (~6K TikTok followers).

For each brand return a JSON object with:
- brand_name: the brand
- contact_email: partnerships/creator email if known, otherwise null
- contact_source: where to find contact info (website URL, page name, or "guessed pattern")
- why: one sentence on why this is a good fit
- relationship_type: one of "active_user", "regular_buyer", "new", "long_term"
- product_usage: what specific products Tyler would use
- angle: the pitch angle
- estimated_value_low: realistic low deal value in dollars
- estimated_value_high: realistic high deal value in dollars
- priority: "P0" (best fit), "P1" (good), or "P2" (worth trying)

Return ONLY a JSON array of exactly 3 objects. No markdown, no explanation.`;
}

async function scoutWithClaude(
  existingNames: string[],
  feedbackContext: string,
  focus: string,
): Promise<ScoutRecommendation[]> {
  const systemPrompt = buildSystemPrompt();
  const excludeList = existingNames.length > 0 ? existingNames.join(", ") : "none";

  const userPrompt = `Find 3 brand partnership prospects for Tyler.
${focus ? `\nFocus: ${focus}` : ""}

Brands already in his pipeline (DO NOT suggest these): ${excludeList}
${feedbackContext}

Think creatively — DTC brands, Austin-local brands, niche running/HYROX/strength brands, supplement brands, recovery tools, fitness tech, meal prep, coffee, athleisure. Any brand Tyler genuinely uses or would use.`;

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
  return parsed.slice(0, 3).map((r: Record<string, unknown>) => ({ ...r, source: "claude" as const }) as ScoutRecommendation);
}

async function scoutWithChatGPT(
  existingNames: string[],
  feedbackContext: string,
  focus: string,
): Promise<ScoutRecommendation[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const excludeList = existingNames.length > 0 ? existingNames.join(", ") : "none";

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
      instructions: `You are a brand partnership scout. Search the web for fitness/wellness brands with creator or ambassador programs that accept micro-creators (under 10K followers).

Tyler Young is a fitness creator in Austin TX: ~6K TikTok, marathon runner (3:23), HYROX competitor, 455lb deadlift, builds a fitness app called Motus.

${formatStatsBlock(TYLER_STATS)}`,
      input: `Search for 3 brands with creator/ambassador programs for micro-creators in fitness, running, HYROX, strength training, nutrition, or recovery.
${focus ? `Focus: ${focus}` : ""}

DO NOT suggest: ${excludeList}
${feedbackContext}

For each brand return JSON with: brand_name, contact_email (or null), contact_source (URL where you found it), why, relationship_type ("active_user"|"regular_buyer"|"new"|"long_term"), product_usage, angle, estimated_value_low (number), estimated_value_high (number), priority ("P0"|"P1"|"P2")

Return ONLY a JSON array of 3 objects, no markdown.`,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `ChatGPT web search failed (${res.status})`);
  }

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
  return parsed.slice(0, 3).map((r: Record<string, unknown>) => ({ ...r, source: "chatgpt" as const }) as ScoutRecommendation);
}

function sanitizeRow(rec: ScoutRecommendation, userId: string) {
  return {
    user_id: userId,
    brand_name: String(rec.brand_name || "Unknown Brand").slice(0, 200),
    contact_email: rec.contact_email ? String(rec.contact_email).slice(0, 200) : null,
    status: INSERT_STATUS,
    priority: VALID_PRIORITIES.includes(rec.priority) ? rec.priority : "P2",
    relationship_type: VALID_RELATIONSHIP_TYPES.includes(rec.relationship_type) ? rec.relationship_type : "new",
    product_usage: rec.product_usage ? String(rec.product_usage).slice(0, 1000) : null,
    angle: rec.angle ? String(rec.angle).slice(0, 1000) : null,
    estimated_value_low: typeof rec.estimated_value_low === "number" && rec.estimated_value_low > 0 ? Math.round(rec.estimated_value_low) : null,
    estimated_value_high: typeof rec.estimated_value_high === "number" && rec.estimated_value_high > 0 ? Math.round(rec.estimated_value_high) : null,
    scout_reason: `[${rec.source.toUpperCase()}] ${rec.why || "AI-recommended"}${rec.contact_source ? ` | Contact: ${rec.contact_source}` : ""}`.slice(0, 2000),
  };
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json().catch(() => null);
  const focus = (body?.focus as string) ?? "";

  try {
    const supabase = createAdminClient();

    // Load existing brand names (just names, minimal query)
    const { data: existing } = await supabase
      .from("brand_deals")
      .select("brand_name")
      .eq("user_id", user.id);

    const existingNames = (existing ?? []).map((d: { brand_name: string }) => d.brand_name);

    // Load feedback to inform scouting
    let feedbackContext = "";
    const { data: feedback } = await supabase
      .from("brand_outreach_feedback")
      .select("feedback_type, content")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (feedback && feedback.length > 0) {
      const likes = feedback.filter((f: { feedback_type: string }) => f.feedback_type === "like").map((f: { content: string }) => f.content);
      const dislikes = feedback.filter((f: { feedback_type: string }) => f.feedback_type === "dislike").map((f: { content: string }) => f.content);
      if (likes.length) feedbackContext += `\n\nTyler LIKED these past recommendations (find more like these): ${likes.join("; ")}`;
      if (dislikes.length) feedbackContext += `\nTyler DISLIKED these (avoid similar): ${dislikes.join("; ")}`;
    }

    // Run Claude and ChatGPT in parallel
    const [claudeResult, chatgptResult] = await Promise.allSettled([
      scoutWithClaude(existingNames, feedbackContext, focus),
      scoutWithChatGPT(existingNames, feedbackContext, focus),
    ]);

    const claudeBrands: ScoutRecommendation[] = claudeResult.status === "fulfilled" ? claudeResult.value : [];
    const chatgptBrands: ScoutRecommendation[] = chatgptResult.status === "fulfilled" ? chatgptResult.value : [];

    if (claudeResult.status === "rejected") logError("brands.scout.claude", new Error(String(claudeResult.reason)));
    if (chatgptResult.status === "rejected") logError("brands.scout.chatgpt", new Error(String(chatgptResult.reason)));

    // Deduplicate — prefer ChatGPT (web-searched)
    const seen = new Set<string>();
    const deduped: ScoutRecommendation[] = [];
    for (const rec of [...chatgptBrands, ...claudeBrands]) {
      const key = rec.brand_name.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(rec);
      }
    }

    // Filter out existing brands
    const filtered = deduped.filter(
      (r) => !existingNames.some((name: string) => name.toLowerCase() === r.brand_name.toLowerCase()),
    );

    // Insert — try each brand, collect errors
    let persisted = 0;
    const insertErrors: { brand: string; error: string }[] = [];
    for (const rec of filtered) {
      const row = sanitizeRow(rec, user.id);
      const { error: err } = await supabase.from("brand_deals").insert(row);
      if (err) {
        // If "scouted"/"prospect" status fails, try without status (let DB default handle it)
        const { error: retryErr } = await supabase.from("brand_deals").insert({
          user_id: row.user_id,
          brand_name: row.brand_name,
          contact_email: row.contact_email,
          scout_reason: row.scout_reason,
        });
        if (retryErr) {
          logError("brands.scout.insert", new Error(retryErr.message), { brand: rec.brand_name });
          insertErrors.push({ brand: rec.brand_name, error: `${err.message} (retry: ${retryErr.message})` });
        } else {
          persisted++;
        }
      } else {
        persisted++;
      }
    }

    return NextResponse.json({
      ok: true,
      persisted,
      attempted: filtered.length,
      filtered_out: deduped.length - filtered.length,
      insert_errors: insertErrors,
      claude_count: claudeBrands.length,
      chatgpt_count: chatgptBrands.length,
      recommendations: filtered.map((r) => ({ brand_name: r.brand_name, source: r.source, why: r.why })),
      errors: {
        claude: claudeResult.status === "rejected" ? String(claudeResult.reason) : null,
        chatgpt: chatgptResult.status === "rejected" ? String(chatgptResult.reason) : null,
      },
    });
  } catch (error) {
    logError("brands.scout", error);
    return NextResponse.json({ error: "Brand scouting failed", detail: String(error) }, { status: 500 });
  }
}
