import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

interface BrainDumpGoal {
  title: string;
  milestone: string;
}

interface BrainDumpPayload {
  goals: BrainDumpGoal[];
  weeklyContext: string;
  topOfMind: string;
}

/**
 * GET /api/brain/dump
 * Returns the most recent brain dump for the user, plus their existing goals.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();

  // Fetch latest brain dump
  const { data: dump } = await supabase
    .from("brain_dumps")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch existing goals for dropdown population
  const { data: goals } = await supabase
    .from("goals")
    .select("id, title, progress_metric, progress_current, progress_target, pillar_id")
    .eq("user_id", user.id)
    .neq("status", "abandoned")
    .order("sort_order", { ascending: true });

  return NextResponse.json({
    dump: dump ?? null,
    goals: goals ?? [],
  });
}

/**
 * POST /api/brain/dump
 * Saves a brain dump — goals snapshot, weekly context, and top-of-mind.
 * Updates goal titles/milestones in the goals table as well.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  let body: BrainDumpPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { goals, weeklyContext, topOfMind } = body;

  if (!Array.isArray(goals)) {
    return NextResponse.json({ error: "goals must be an array" }, { status: 400 });
  }
  if (typeof weeklyContext !== "string" || typeof topOfMind !== "string") {
    return NextResponse.json({ error: "weeklyContext and topOfMind are required strings" }, { status: 400 });
  }

  const supabase = await createClient();

  // Upsert goals in the goals table — update titles and progress targets
  for (const goal of goals) {
    if (!goal.title?.trim()) continue;

    // Try to find existing goal by fuzzy title match
    const { data: existing } = await supabase
      .from("goals")
      .select("id")
      .eq("user_id", user.id)
      .ilike("title", `%${goal.title.trim().slice(0, 30)}%`)
      .neq("status", "abandoned")
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Update existing goal's progress target (milestone)
      if (goal.milestone?.trim()) {
        await supabase
          .from("goals")
          .update({
            progress_target: goal.milestone.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .eq("user_id", user.id);
      }
    }
    // If no existing goal found, we still store it in the brain dump JSON
  }

  // Save the brain dump record
  const { data: dump, error } = await supabase
    .from("brain_dumps")
    .insert({
      user_id: user.id,
      goals: JSON.stringify(goals),
      weekly_context: weeklyContext,
      top_of_mind: topOfMind,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to save brain dump:", error);
    return NextResponse.json({ error: "Failed to process brain dump" }, { status: 500 });
  }

  return NextResponse.json({ dump, success: true });
}
