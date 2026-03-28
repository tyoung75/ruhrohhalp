import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { computePriorityScore, parseWeights } from "@/lib/ai/scoring";

// TODO: wrap in runJob() after Item 5
export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get the single user (single-user system)
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .limit(1)
    .single();

  if (!profiles) {
    return NextResponse.json({ error: "No user found" }, { status: 404 });
  }

  const userId = profiles.id;

  // Load scoring weights from user_settings
  const { data: settings } = await supabase
    .from("user_settings")
    .select("scoring_weights")
    .eq("user_id", userId)
    .single();

  const weights = parseWeights(settings?.scoring_weights);

  // Fetch all open tasks
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, priority_num, due_date, goal_id, state, created_at, updated_at, ai_metadata, priority_score")
    .eq("user_id", userId)
    .not("state", "in", "(done,cancelled)");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let scored = 0;
  const updates: { id: string; priority_score: number; old_score: number }[] = [];

  for (const task of tasks ?? []) {
    const newScore = computePriorityScore(task, weights);
    const oldScore = task.priority_score ?? 0;

    updates.push({ id: task.id, priority_score: newScore, old_score: oldScore });

    const { error: updateError } = await supabase
      .from("tasks")
      .update({ priority_score: newScore })
      .eq("id", task.id);

    if (!updateError) scored++;
  }

  return NextResponse.json({
    ok: true,
    job: "score-tasks",
    scored,
    total: tasks?.length ?? 0,
  });
}
