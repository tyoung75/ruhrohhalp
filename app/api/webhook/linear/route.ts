import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { embedAndStore } from "@/lib/embedding";
import { logError } from "@/lib/logger";

/**
 * POST /api/webhook/linear
 *
 * Expected JSON body (Linear webhook payload, simplified):
 * {
 *   userId: string,
 *   action: string,           // "create" | "update" | "remove"
 *   type: string,             // "Issue" | "Comment" | "Project"
 *   data: {
 *     id: string,
 *     title: string,
 *     description?: string,
 *     state?: { name: string },
 *     priority?: number,
 *     assignee?: { name: string },
 *     labels?: { name: string }[],
 *     team?: { name: string },
 *     url?: string,
 *   },
 *   projectId?: string,
 *   tags?: string[]
 * }
 */
export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const payload = await request.json();
    const { userId, action, type, data, projectId, tags } = payload;

    if (!userId || !data?.title) {
      return NextResponse.json({ error: "userId and data.title are required" }, { status: 400 });
    }

    const labels = (data.labels ?? []).map((l: { name: string }) => l.name).join(", ");

    const content = [
      `[Linear ${type}] ${data.title}`,
      `Action: ${action}`,
      data.state?.name ? `Status: ${data.state.name}` : null,
      data.assignee?.name ? `Assignee: ${data.assignee.name}` : null,
      data.team?.name ? `Team: ${data.team.name}` : null,
      labels ? `Labels: ${labels}` : null,
      data.url ? `URL: ${data.url}` : null,
      data.description ? `\n${data.description}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await embedAndStore(content, {
      userId,
      source: "task",
      sourceId: data.id,
      projectId,
      category: "work",
      importance: data.priority != null && data.priority <= 2 ? 8 : 5,
      tags: tags ?? ["linear", ...(labels ? labels.split(", ") : [])],
    });

    return NextResponse.json({
      success: true,
      memoryIds: result.memoryIds,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    logError("webhook.linear", error);
    return NextResponse.json({ error: "Failed to process linear webhook" }, { status: 500 });
  }
}
