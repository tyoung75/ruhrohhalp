import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { embedAndStore } from "@/lib/embedding";
import { logError } from "@/lib/logger";

/**
 * POST /api/webhook/reminder
 *
 * Expected JSON body:
 * {
 *   userId: string,
 *   title: string,
 *   body?: string,
 *   dueAt?: string,
 *   projectId?: string,
 *   tags?: string[]
 * }
 */
export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const payload = await request.json();
    const { userId, title, body, dueAt, projectId, tags } = payload;

    if (!userId || !title) {
      return NextResponse.json({ error: "userId and title are required" }, { status: 400 });
    }

    const content = [
      `Reminder: ${title}`,
      dueAt ? `Due: ${dueAt}` : null,
      body || null,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await embedAndStore(content, {
      userId,
      source: "task",
      projectId,
      category: "general",
      importance: 6,
      tags: tags ?? ["reminder"],
    });

    return NextResponse.json({
      success: true,
      memoryIds: result.memoryIds,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    logError("webhook.reminder", error);
    return NextResponse.json({ error: "Failed to process reminder webhook" }, { status: 500 });
  }
}
