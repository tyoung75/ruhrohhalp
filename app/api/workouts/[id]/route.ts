import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/workouts/[id]
 *
 * Update a scheduled workout. When scheduled_date changes, returns a warning
 * if the target date already has workouts scheduled. The move always succeeds —
 * warnings are informational only. No automatic cascading of downstream workouts.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await params;
  const body = await request.json();
  const { title, workout_type, scheduled_date, goal_id, notes, sort_order, completed_at } = body;

  const supabase = await createClient();

  // Build update payload — only include fields that were provided
  const update: Record<string, unknown> = {};
  if (title !== undefined) update.title = title;
  if (workout_type !== undefined) update.workout_type = workout_type;
  if (scheduled_date !== undefined) update.scheduled_date = scheduled_date;
  if (goal_id !== undefined) update.goal_id = goal_id;
  if (notes !== undefined) update.notes = notes;
  if (sort_order !== undefined) update.sort_order = sort_order;
  if (completed_at !== undefined) update.completed_at = completed_at;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Check for date conflicts before moving
  let warning: string | undefined;
  if (scheduled_date) {
    const { count, error: countError } = await supabase
      .from("scheduled_workouts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("scheduled_date", scheduled_date)
      .neq("id", id);

    if (!countError && count && count > 0) {
      const dateLabel = new Date(scheduled_date + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      warning = `${count} workout${count > 1 ? "s" : ""} already scheduled for ${dateLabel}`;
    }
  }

  const { data, error } = await supabase
    .from("scheduled_workouts")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Workout not found" }, { status: 404 });

  return NextResponse.json({ workout: data, ...(warning ? { warning } : {}) });
}

/**
 * DELETE /api/workouts/[id]
 *
 * Remove a scheduled workout.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await params;
  const supabase = await createClient();

  const { error } = await supabase
    .from("scheduled_workouts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
