import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { embedAndStore } from "@/lib/embedding";
import { logError } from "@/lib/logger";

/**
 * POST /api/webhook/gmail
 *
 * Expected JSON body:
 * {
 *   userId: string,
 *   subject: string,
 *   body: string,
 *   from: string,
 *   threadId?: string,
 *   projectId?: string,
 *   tags?: string[]
 * }
 */
export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const payload = await request.json();
    const { userId, subject, body, from, threadId, projectId, tags } = payload;

    if (!userId || !body) {
      return NextResponse.json({ error: "userId and body are required" }, { status: 400 });
    }

    const content = [
      subject ? `Subject: ${subject}` : null,
      from ? `From: ${from}` : null,
      "",
      body,
    ]
      .filter((line) => line !== null)
      .join("\n");

    const result = await embedAndStore(content, {
      userId,
      source: "manual",
      sourceId: threadId ?? undefined,
      projectId,
      category: "work",
      importance: 5,
      tags: tags ?? ["gmail"],
    });

    return NextResponse.json({
      success: true,
      memoryIds: result.memoryIds,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    logError("webhook.gmail", error);
    return NextResponse.json({ error: "Failed to process gmail webhook" }, { status: 500 });
  }
}
