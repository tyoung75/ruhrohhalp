/**
 * POST /api/creator/media-analyze — Run Gemini Vision on a media asset
 * and generate content suggestions.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json().catch(() => null);
  const mediaUrl = body?.media_url as string;
  const mediaId = body?.media_id as string;

  if (!mediaUrl) return NextResponse.json({ error: "media_url is required" }, { status: 400 });

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 503 });

  try {
    // Call Gemini Vision to analyze the image and suggest content
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `You are Tyler Young's content strategist. Analyze this image and suggest 2-3 social media posts he could make with it.

Tyler's brand: running (Berlin Marathon training), strength training, NYC lifestyle, building in public (tech/startups), travel & food.
Style: lowercase except I, direct, specific numbers, authentic, no clichés.

For each suggestion, return:
- platform (threads, instagram, or tiktok)
- body (the post text in Tyler's voice)
- content_type (text, image, carousel)
- why (brief explanation of why this would work)

Return ONLY a JSON array of suggestions.` },
              { inline_data: { mime_type: "image/jpeg", data: mediaUrl.startsWith("data:") ? mediaUrl.split(",")[1] : mediaUrl } },
            ],
          }],
        }),
      },
    );

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    let suggestions;
    try {
      const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      suggestions = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ analysis: text, suggestions: [] });
    }

    // Optionally create draft content queue items
    if (body?.auto_draft && Array.isArray(suggestions)) {
      const supabase = await createClient();
      const now = new Date().toISOString();
      for (const s of suggestions.slice(0, 3)) {
        await supabase.from("content_queue").insert({
          user_id: user.id,
          platform: s.platform ?? "threads",
          content_type: s.content_type ?? "image",
          body: s.body ?? "",
          media_urls: mediaUrl.startsWith("http") ? [mediaUrl] : [],
          status: "draft",
          agent_reasoning: s.why ?? "Generated from media analysis",
          generated_by: "media_analyzer",
          created_at: now,
          updated_at: now,
        });
      }
    }

    return NextResponse.json({ ok: true, suggestions, media_id: mediaId });
  } catch (error) {
    logError("creator.media-analyze", error);
    return NextResponse.json({ error: "Media analysis failed", detail: String(error) }, { status: 500 });
  }
}
