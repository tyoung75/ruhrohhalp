import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { computePriorityScore, parseWeights } from "@/lib/ai/scoring";
import { generateLeverageReason } from "@/lib/ai/leverage-reason";

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

  // Fetch all open tasks (include title, description, leverage_reason for enrichment)
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, title, description, priority_num, due_date, goal_id, state, created_at, updated_at, ai_metadata, priority_score, leverage_reason")
    .eq("user_id", userId)
    .not("state", "in", "(done,cancelled)");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Pre-fetch goal titles for leverage reason context
  const goalIds = [...new Set((tasks ?? []).map(t => t.goal_id).filter(Boolean))];
  const goalTitleMap = new Map<string, string>();
  if (goalIds.length > 0) {
    const { data: goals } = await supabase
      .from("goals")
      .select("id, title")
      .in("id", goalIds);
    for (const g of goals ?? []) {
      goalTitleMap.set(g.id, g.title);
    }
  }

  let scored = 0;
  let enriched = 0;
  const leveragePromises: Promise<void>[] = [];

  for (const task of tasks ?? []) {
    const newScore = computePriorityScore(task, weights);
    const oldScore = task.priority_score ?? 0;
    const scoreDelta = Math.abs(newScore - oldScore);

    const { error: updateError } = await supabase
      .from("tasks")
      .update({ priority_score: newScore })
      .eq("id", task.id);

    if (!updateError) scored++;

    // Enrich leverage_reason if score changed >0.1 or leverage_reason is empty
    const needsReason = scoreDelta > 0.1 || !task.leverage_reason;
    if (needsReason) {
      const goalTitle = task.goal_id ? goalTitleMap.get(task.goal_id) : undefined;
      leveragePromises.push(
        generateLeverageReason({
          title: task.title,
          description: task.description ?? undefined,
          priority_score: newScore,
          goal_title: goalTitle,
        }).then(async (reason) => {
          if (reason) {
            await supabase
              .from("tasks")
              .update({
                leverage_reason: reason,
                ai_metadata: { ...(task.ai_metadata as Record<string, unknown> ?? {}), leverage_reason: reason },
              })
              .eq("id", task.id);
            enriched++;
          }
        }),
      );
    }
  }

  // Wait for all leverage reason enrichments (fire-and-forget style but still await)
  await Promise.allSettled(leveragePromises);

  return NextResponse.json({
    ok: true,
    job: "score-tasks",
    scored,
    enriched,
    total: tasks?.length ?? 0,
  });
}
