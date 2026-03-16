import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { embedAndStore } from "@/lib/embedding";
import { logError } from "@/lib/logger";

/**
 * POST /api/webhook/capture
 *
 * Quick capture — the simplest ingestion endpoint.
 * Used by iOS Shortcuts, Share Sheet, Raycast, etc.
 *
 * Expected JSON body:
 * {
 *   userId: string,
 *   text: string,
 *   projectId?: string,
 *   category?: string,
 *   tags?: string[],
 *   asIdea?: boolean
 * }
 */
export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const payload = await request.json();
    const { userId, text, projectId, category, tags, asIdea } = payload;

    if (!userId || !text) {
      return NextResponse.json({ error: "userId and text are required" }, { status: 400 });
    }

    const result = await embedAndStore(text, {
      userId,
      source: "manual",
      projectId,
      category: category ?? "general",
      importance: 5,
      tags: tags ?? ["capture"],
      extra: asIdea
        ? { asIdea: true, sourceType: "typed", title: text.slice(0, 80) }
        : undefined,
    });

    return NextResponse.json({
      success: true,
      memoryIds: result.memoryIds,
      sourceIds: result.sourceIds,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    logError("webhook.capture", error);
    return NextResponse.json({ error: "Failed to process capture webhook" }, { status: 500 });
  }
}
