/**
 * Director Brain — the AI that decides what to edit and how.
 *
 * Uses Gemini 2.5 Flash (free tier) for:
 * 1. Vision analysis: looks at new media assets and classifies them
 * 2. Edit planning: selects media for today's posts and produces EditPlan JSON
 *
 * Fallback chain: Gemini Flash → Groq Llama 4 Scout → Claude (paid)
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logInfo, logError } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisionAnalysis {
  scene: string;
  people_count: number;
  mood: string;
  quality_score: number;
  suggested_platforms: string[];
  suggested_pillar: string;
  visible_text: string | null;
  key_moments?: Array<{ timestamp_seconds: number; description: string }>;
}

export interface PhotoEdits {
  crop?: {
    aspect_ratio: "1:1" | "4:5" | "9:16" | "16:9";
    focus_point?: { x: number; y: number };
  };
  color_grade?: {
    preset: "warm" | "cool" | "moody" | "bright" | "film" | "none";
    brightness?: number;
    contrast?: number;
    saturation?: number;
    temperature?: number;
  };
  text_overlay?: {
    text: string;
    position: "top" | "center" | "bottom";
    style: "minimal" | "bold" | "subtitle";
  };
  enhance?: boolean;
}

export interface VideoEdits {
  trim?: { start_seconds: number; end_seconds: number };
  segments?: Array<{ asset_id: string; start: number; end: number; order: number }>;
  transition?: "cut" | "crossfade" | "fade_black";
  speed?: {
    factor: number;
    segments?: Array<{ start: number; end: number; factor: number }>;
  };
  color_grade?: { preset: string };
  text_overlays?: Array<{
    text: string;
    start: number;
    end: number;
    position: string;
  }>;
  audio?: {
    keep_original: boolean;
    background_music?: string;
    music_volume?: number;
  };
  output_format: {
    aspect_ratio: "9:16" | "16:9" | "1:1";
    max_duration_seconds: number;
  };
}

export interface EditPlan {
  id: string;
  post_type: "photo" | "video" | "carousel" | "reel" | "short";
  target_platform: "instagram" | "tiktok" | "youtube" | "threads";
  media_asset_ids: string[];
  photo_edits?: PhotoEdits;
  video_edits?: VideoEdits;
  carousel_order?: {
    asset_ids: string[];
    reasoning: string;
  };
  caption: string;
  hashtags?: string[];
  scheduled_time?: string;
  reasoning: string;
  confidence: number;
  brand_voice_score: number;
}

// ---------------------------------------------------------------------------
// Gemini API client
// ---------------------------------------------------------------------------

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiContent {
  role: string;
  parts: Array<{
    text?: string;
    inline_data?: { mime_type: string; data: string };
  }>;
}

async function callGemini(
  contents: GeminiContent[],
  systemInstruction?: string,
  model: string = "gemini-2.5-flash"
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const res = await fetch(
    `${GEMINI_API}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini API error ${res.status}: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");
  return text;
}

// ---------------------------------------------------------------------------
// Step 1: Vision Analysis — analyze unprocessed media assets
// ---------------------------------------------------------------------------

const VISION_SYSTEM = `You are a visual content analyst for a NYC-based hybrid athlete and entrepreneur named Tyler.
Analyze the provided image or video and return a JSON object with:
{
  "scene": "specific description (e.g., 'gym selfie post-deadlift', 'city run along the East River at sunrise')",
  "people_count": 0,
  "mood": "one of: energetic, contemplative, social, celebratory, focused, playful, cozy",
  "quality_score": 0.0-1.0 based on blur, exposure, composition, visual interest,
  "suggested_platforms": ["instagram", "tiktok", "threads", "youtube"],
  "suggested_pillar": "one of: running, building, nyc, fitness, travel, food",
  "visible_text": "any text visible in the image, or null",
  "key_moments": [{"timestamp_seconds": 0, "description": "..."}] // video only, omit for photos
}

Be specific. "A person running" is bad. "Morning 10K along the Hudson, overcast, wearing Tracksmith singlet" is good.
Rate quality honestly — blurry mirror selfies get 0.3, well-composed outdoor shots get 0.8+.`;

export async function analyzeMedia(
  userId: string,
  limit: number = 20
): Promise<{ analyzed: number; errors: number }> {
  const supabase = createAdminClient();
  let analyzed = 0;
  let errors = 0;

  // Get unanalyzed assets
  const { data: assets } = await supabase
    .from("media_assets")
    .select("id, storage_path, mime_type, filename, width, height, duration_seconds")
    .eq("user_id", userId)
    .eq("status", "new")
    .eq("is_screenshot", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!assets?.length) return { analyzed: 0, errors: 0 };

  for (const asset of assets) {
    try {
      // Download from Supabase Storage
      const { data: fileData, error: dlError } = await supabase.storage
        .from("creator-media")
        .download(asset.storage_path);

      if (dlError || !fileData) {
        throw new Error(`Download failed: ${dlError?.message}`);
      }

      const buffer = await fileData.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      // Call Gemini vision
      const response = await callGemini(
        [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: asset.mime_type, data: base64 } },
              { text: `Analyze this ${asset.mime_type.startsWith("video") ? "video" : "image"}. Filename: ${asset.filename}. Dimensions: ${asset.width}x${asset.height}.${asset.duration_seconds ? ` Duration: ${asset.duration_seconds}s.` : ""}` },
            ],
          },
        ],
        VISION_SYSTEM
      );

      const analysis: VisionAnalysis = JSON.parse(response);

      // Update asset
      await supabase
        .from("media_assets")
        .update({
          vision_analysis: analysis,
          status: "analyzed",
        })
        .eq("id", asset.id);

      analyzed++;
      logInfo("director.vision-analyzed", { assetId: asset.id, scene: analysis.scene, quality: analysis.quality_score });
    } catch (err) {
      errors++;
      logError("director.vision-error", err, { assetId: asset.id });
    }
  }

  return { analyzed, errors };
}

// ---------------------------------------------------------------------------
// Step 2: Edit Planning — produce EditPlan JSON for today's posts
// ---------------------------------------------------------------------------

const EDIT_PLANNING_SYSTEM = `You are Tyler Young's AI content editor. Your job is to select media assets and produce edit plans
that will result in engaging, on-brand social media posts.

Tyler is a NYC-based hybrid athlete (455lb deadlift, 3:22 marathon), software engineer (Director at Instacart),
and entrepreneur (Motus app, BDHE LLC). His brand pillars: Running & Endurance, Building in Public,
NYC Lifestyle, Fitness & Strength, Travel & Food.

BRAND VOICE:
- Lowercase casual energy, direct, specific over general
- Real numbers: '53.8 VO2 max' not 'good cardio'
- Confident without bragging — let data speak
- Never: inspirational closers, fitness clichés, 'hot take', framing work as suffering
- Humor is natural and wry, never forced
- Positive energy — Tyler enjoys his life

EDITING STYLE:
- Clean and natural — no heavy filters or overdone effects
- Warm tones for outdoor/running/food, moody for NYC/street, bright for lifestyle
- 4:5 crop for Instagram feed, 9:16 for Reels/TikTok/Shorts, 1:1 for carousels
- Minimal text overlays — let the visual speak
- For video: tight cuts, no long intros, start with the action
- When combining clips: cut > crossfade (crossfade only for time-lapses)

Given the media assets, today's strategy, and recent post history, produce 2-3 edit plans.
Each plan should use available assets and include a caption in Tyler's voice.

OUTPUT FORMAT — respond with ONLY a JSON array:
[
  {
    "post_type": "photo|video|carousel|reel|short",
    "target_platform": "instagram|tiktok|youtube|threads",
    "media_asset_ids": ["uuid1", "uuid2"],
    "photo_edits": { ... } or null,
    "video_edits": { ... } or null,
    "carousel_order": { "asset_ids": [...], "reasoning": "..." } or null,
    "caption": "the caption text in Tyler's voice",
    "hashtags": [],
    "scheduled_time": "HH:MM",
    "reasoning": "why this edit, why today",
    "confidence": 0.0-1.0,
    "brand_voice_score": 0.0-1.0
  }
]`;

export async function generateEditPlans(
  userId: string
): Promise<{ plans_created: number; errors: number }> {
  const supabase = createAdminClient();

  // Gather context
  const [assets, recentPosts, feedback, strategy] = await Promise.all([
    // Available analyzed media (last 7 days)
    supabase
      .from("media_assets")
      .select("id, filename, mime_type, width, height, duration_seconds, vision_analysis, created_at, location")
      .eq("user_id", userId)
      .eq("status", "analyzed")
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(30),

    // Recent posts (last 7 days, avoid repetition)
    supabase
      .from("content_queue")
      .select("body, content_type, platform, created_at, media_urls")
      .eq("user_id", userId)
      .in("status", ["posted", "queued", "editor_draft"])
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20),

    // Editor feedback (last 30 days)
    supabase
      .from("editor_feedback")
      .select("action, note, created_at")
      .eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(30),

    // Strategy insights
    supabase
      .from("strategy_insights")
      .select("insight_type, content, data, confidence")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(10),
  ]);

  if (!assets.data?.length) {
    logInfo("director.no-assets", { userId });
    return { plans_created: 0, errors: 0 };
  }

  // Build the prompt
  const contextParts = [
    `## Available Media (${assets.data.length} assets)`,
    ...assets.data.map((a) => {
      const analysis = a.vision_analysis as VisionAnalysis | null;
      return `- ${a.id} | ${a.filename} | ${a.mime_type} | ${a.width}x${a.height}${a.duration_seconds ? ` | ${a.duration_seconds}s` : ""} | Scene: ${analysis?.scene ?? "unanalyzed"} | Quality: ${analysis?.quality_score ?? "?"} | Pillar: ${analysis?.suggested_pillar ?? "?"} | Mood: ${analysis?.mood ?? "?"}`;
    }),
    "",
    `## Recent Posts (avoid repetition)`,
    ...(recentPosts.data ?? []).map((p) =>
      `- [${p.platform}/${p.content_type}] ${(p.body as string)?.slice(0, 100)}`
    ),
    "",
    `## Editor Feedback (learn from this)`,
    ...(feedback.data ?? []).map((f) =>
      `- [${f.action}] ${f.note ?? "(no note)"}`
    ),
    "",
    `## Strategy Insights`,
    ...(strategy.data ?? []).map((s) => `- [${s.insight_type}] ${s.content}`),
    "",
    `## Today`,
    `Date: ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`,
    `Time: ${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET`,
    "",
    "Produce 2-3 edit plans using the available assets. Focus on the highest-quality assets that match today's strategy.",
  ];

  try {
    const response = await callGemini(
      [{ role: "user", parts: [{ text: contextParts.join("\n") }] }],
      EDIT_PLANNING_SYSTEM
    );

    const plans: EditPlan[] = JSON.parse(response);

    if (!Array.isArray(plans) || plans.length === 0) {
      logError("director.no-plans", new Error("Gemini returned empty plans"), { userId });
      return { plans_created: 0, errors: 1 };
    }

    // Insert plans into database
    let created = 0;
    for (const plan of plans) {
      const { error: insertError } = await supabase.from("edit_plans").insert({
        user_id: userId,
        plan,
        status: "pending",
        director_reasoning: plan.reasoning,
        confidence: plan.confidence,
        brand_voice_score: plan.brand_voice_score,
        media_asset_ids: plan.media_asset_ids,
      });

      if (insertError) {
        logError("director.insert-plan", insertError, { plan: plan.reasoning });
      } else {
        // Mark assets as selected
        await supabase
          .from("media_assets")
          .update({ status: "selected" })
          .in("id", plan.media_asset_ids);
        created++;
      }
    }

    logInfo("director.plans-created", { count: created });
    return { plans_created: created, errors: plans.length - created };
  } catch (err) {
    logError("director.planning-error", err, { userId });
    return { plans_created: 0, errors: 1 };
  }
}

// ---------------------------------------------------------------------------
// Re-edit: take feedback prompt and produce a revised EditPlan
// ---------------------------------------------------------------------------

export async function reEditPlan(
  userId: string,
  originalPlanId: string,
  prompt: string
): Promise<{ plan_id: string | null; error?: string }> {
  const supabase = createAdminClient();

  // Load original plan
  const { data: originalPlan } = await supabase
    .from("edit_plans")
    .select("*")
    .eq("id", originalPlanId)
    .eq("user_id", userId)
    .single();

  if (!originalPlan) {
    return { plan_id: null, error: "Original plan not found" };
  }

  // Load associated assets
  const { data: assets } = await supabase
    .from("media_assets")
    .select("id, filename, mime_type, width, height, duration_seconds, vision_analysis")
    .in("id", originalPlan.media_asset_ids);

  const reEditContext = [
    "## Re-Edit Request",
    `Tyler's feedback: "${prompt}"`,
    "",
    "## Original Edit Plan",
    JSON.stringify(originalPlan.plan, null, 2),
    "",
    "## Available Assets",
    ...(assets ?? []).map((a) => {
      const analysis = a.vision_analysis as VisionAnalysis | null;
      return `- ${a.id} | ${a.filename} | ${a.mime_type} | ${a.width}x${a.height} | Scene: ${analysis?.scene ?? "?"}`;
    }),
    "",
    "Produce a SINGLE revised edit plan incorporating Tyler's feedback. Keep the same media assets unless the feedback specifically requests different ones.",
  ];

  try {
    const response = await callGemini(
      [{ role: "user", parts: [{ text: reEditContext.join("\n") }] }],
      EDIT_PLANNING_SYSTEM
    );

    const plans: EditPlan[] = JSON.parse(response);
    const plan = Array.isArray(plans) ? plans[0] : plans;

    const { data: newPlan, error: insertError } = await supabase
      .from("edit_plans")
      .insert({
        user_id: userId,
        plan,
        status: "pending",
        director_reasoning: `Re-edit: ${prompt}. ${plan.reasoning}`,
        confidence: plan.confidence,
        brand_voice_score: plan.brand_voice_score,
        media_asset_ids: plan.media_asset_ids ?? originalPlan.media_asset_ids,
        re_edit_prompt: prompt,
        parent_plan_id: originalPlanId,
      })
      .select("id")
      .single();

    if (insertError || !newPlan) {
      return { plan_id: null, error: insertError?.message ?? "Insert failed" };
    }

    // Mark old plan as superseded
    await supabase
      .from("edit_plans")
      .update({ status: "re_edit" })
      .eq("id", originalPlanId);

    return { plan_id: newPlan.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Re-edit failed";
    logError("director.re-edit", err, { originalPlanId, prompt });
    return { plan_id: null, error: msg };
  }
}
