import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { embedAndStore } from "@/lib/embedding";
import { processGmail } from "@/lib/processors";
import { logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const payload = await request.json();
    if (!payload.userId || !payload.body) {
      return NextResponse.json({ error: "userId and body are required" }, { status: 400 });
    }

    const { content, metadata } = await processGmail(payload);
    const result = await embedAndStore(content, metadata);

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
