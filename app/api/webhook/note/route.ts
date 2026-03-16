import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { embedAndStore } from "@/lib/embedding";
import { logError } from "@/lib/logger";

/**
 * POST /api/webhook/note
 *
 * Expected JSON body:
 * {
 *   userId: string,
 *   title?: string,
 *   content: string,
 *   projectId?: string,
 *   category?: string,
 *   tags?: string[]
 * }
 */
export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const payload = await request.json();
    const { userId, title, content, projectId, category, tags } = payload;

    if (!userId || !content) {
      return NextResponse.json({ error: "userId and content are required" }, { status: 400 });
    }

    const fullContent = title ? `${title}\n\n${content}` : content;

    const result = await embedAndStore(fullContent, {
      userId,
      source: "manual",
      projectId,
      category: category ?? "general",
      importance: 5,
      tags: tags ?? ["note"],
    });

    return NextResponse.json({
      success: true,
      memoryIds: result.memoryIds,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    logError("webhook.note", error);
    return NextResponse.json({ error: "Failed to process note webhook" }, { status: 500 });
  }
}
