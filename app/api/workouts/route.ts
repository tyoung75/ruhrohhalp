import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/workouts?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns scheduled workouts within the given date range.
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "from and to query params required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scheduled_workouts")
    .select("*")
    .eq("user_id", user.id)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to)
    .order("scheduled_date", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ workouts: data });
}

/**
 * POST /api/workouts
 *
 * Create a new scheduled workout.
 * Body: { title, workout_type?, scheduled_date, goal_id?, notes?, sort_order? }
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { title, workout_type, scheduled_date, goal_id, notes, sort_order } = body;

  if (!title || !scheduled_date) {
    return NextResponse.json({ error: "title and scheduled_date are required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scheduled_workouts")
    .insert({
      user_id: user.id,
      title,
      workout_type: workout_type || "strength",
      scheduled_date,
      goal_id: goal_id || null,
      notes: notes || "",
      sort_order: sort_order ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ workout: data }, { status: 201 });
}
