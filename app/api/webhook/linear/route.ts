import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { embedAndStore } from "@/lib/embedding";
import { processLinear } from "@/lib/processors";
import { logError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  linearStateToStatus,
  linearPriorityToTylerOS,
} from "@/lib/linear/sync";

export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const payload = await request.json();
    if (!payload.userId || !payload.data?.title) {
      return NextResponse.json({ error: "userId and data.title are required" }, { status: 400 });
    }

    // 1. Embed into memories (existing behavior)
    const { content, metadata } = await processLinear(payload);
    const result = await embedAndStore(content, metadata);

    // 2. Sync to tasks table if this issue is linked
    let taskSynced = false;
    if (payload.data?.id) {
      taskSynced = await syncLinearToTask(payload);
    }

    return NextResponse.json({
      success: true,
      memoryIds: result.memoryIds,
      chunkCount: result.chunkCount,
      taskSynced,
    });
  } catch (error) {
    logError("webhook.linear", error);
    return NextResponse.json({ error: "Failed to process linear webhook" }, { status: 500 });
  }
}

/**
 * If the Linear issue is linked to a TylerOS task, sync status/priority/title.
 * Returns true if a task was updated.
 */
async function syncLinearToTask(payload: {
  data: {
    id: string;
    title: string;
    description?: string;
    state?: { name: string; type?: string };
    priority?: number;
    url?: string;
  };
}): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = payload;

  // Find the linked task
  const { data: task } = await supabase
    .from("tasks")
    .select("id")
    .eq("linear_issue_id", data.id)
    .maybeSingle();

  if (!task) return false;

  // Build update payload
  const updates: Record<string, unknown> = {
    title: data.title,
    linear_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (data.description !== undefined) {
    updates.description = data.description ?? "";
  }

  if (data.state?.type) {
    updates.status = linearStateToStatus(data.state.type);
  }

  if (data.priority !== undefined) {
    updates.priority = linearPriorityToTylerOS(data.priority);
  }

  if (data.url) {
    updates.linear_url = data.url;
  }

  await supabase.from("tasks").update(updates).eq("id", task.id);
  return true;
}
