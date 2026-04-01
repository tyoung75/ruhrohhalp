import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/tasks/[id]/replies
 *
 * Returns replies for a specific task.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id: taskId } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("task_replies")
    .select("id, reply, applied, created_at")
    .eq("task_id", taskId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ replies: data ?? [] });
}

/**
 * POST /api/tasks/[id]/replies
 *
 * Submits a reply/feedback on a specific task. This feedback
 * is surfaced during briefing generation and task prioritization
 * so the AI can adapt its recommendations.
 *
 * Body:
 * {
 *   reply: string (required)
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id: taskId } = await params;
  const body = await request.json();
  const { reply } = body;

  if (!reply || typeof reply !== "string" || !reply.trim()) {
    return NextResponse.json({ error: "reply is required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Verify the task exists and belongs to the user
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (taskErr) return NextResponse.json({ error: taskErr.message }, { status: 500 });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("task_replies")
    .insert({
      user_id: user.id,
      task_id: taskId,
      reply: reply.trim(),
      applied: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("[task_replies.insert]", JSON.stringify(error));
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reply: data }, { status: 201 });
}
