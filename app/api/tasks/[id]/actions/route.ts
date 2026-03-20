import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type ActionBody =
  | { action: "done" }
  | { action: "cancel" }
  | { action: "snooze"; date: string }
  | { action: "reprioritize"; priority: number };

/**
 * POST /api/tasks/[id]/actions
 *
 * Quick-action endpoints for task state changes
 *
 * Body examples:
 * { action: "done" } — marks state='done', status='done'
 * { action: "cancel" } — marks state='cancelled', status='done'
 * { action: "snooze", date: "2026-03-25" } — updates due_date
 * { action: "reprioritize", priority: 2 } — updates priority_num and priority text
 *
 * All actions log to activity_log table
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = (await request.json()) as ActionBody;
  const { id } = await context.params;

  if (!body.action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Verify task belongs to user
  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  const logType = "task_action";
  let logDescription = "";

  switch (body.action) {
    case "done":
      updates.state = "done";
      updates.status = "done";
      logDescription = `Marked task as done`;
      break;

    case "cancel":
      updates.state = "cancelled";
      updates.status = "done";
      logDescription = `Cancelled task`;
      break;

    case "snooze":
      if (!body.date) {
        return NextResponse.json({ error: "date is required for snooze" }, { status: 400 });
      }
      updates.due_date = body.date;
      logDescription = `Snoozed task until ${body.date}`;
      break;

    case "reprioritize":
      if (body.priority === undefined) {
        return NextResponse.json({ error: "priority is required for reprioritize" }, { status: 400 });
      }
      updates.priority_num = body.priority;
      if (body.priority === 1 || body.priority === 2) {
        updates.priority = "high";
      } else if (body.priority === 3) {
        updates.priority = "medium";
      } else if (body.priority === 4) {
        updates.priority = "low";
      }
      logDescription = `Changed priority to ${body.priority}`;
      break;

    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Update task
  const { error: updateError } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Log to activity_log (if table exists)
  try {
    await supabase.from("activity_log").insert({
      user_id: user.id,
      type: logType,
      description: logDescription,
      task_id: id,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    // Activity logging is non-critical
    console.error("Failed to log activity:", e);
  }

  return NextResponse.json({ ok: true, action: body.action });
}
