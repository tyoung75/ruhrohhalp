import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_MODELS } from "@/lib/ai-config";
import { callAI } from "@/lib/ai/providers";

/**
 * POST /api/tasks/[id]/dismiss
 * Logs task dismissal to activity_log with reason.
 * After 30 accumulated dismissals, triggers weight analysis via Sonnet.
 *
 * Body: { reason?: "not_relevant" | "too_hard" | "already_done" | "wrong_timing" | "other" }
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const reason = body.reason ?? "other";

  const supabase = await createClient();

  // Verify task exists
  const { data: task } = await supabase
    .from("tasks")
    .select("id, title")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Log dismissal to activity_log
  await supabase.from("activity_log").insert({
    user_id: user.id,
    type: "task_dismissed",
    entity_id: id,
    payload: { action: "dismiss", reason, task_title: task.title },
  });

  // Check total dismissal count
  const { count } = await supabase
    .from("activity_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("type", "task_dismissed");

  const totalDismissals = count ?? 0;

  // Trigger weight analysis after every 30 dismissals
  if (totalDismissals > 0 && totalDismissals % 30 === 0) {
    analyzeAndUpdateWeights(user.id, totalDismissals).catch(() => {});
  }

  return NextResponse.json({ ok: true, total_dismissals: totalDismissals });
}

/**
 * Analyze dismissal patterns and update scoring weights.
 */
async function analyzeAndUpdateWeights(userId: string, totalDismissals: number): Promise<void> {
  const admin = createAdminClient();

  // Get recent dismissals with reasons
  const { data: dismissals } = await admin
    .from("activity_log")
    .select("payload, created_at")
    .eq("user_id", userId)
    .eq("type", "task_dismissed")
    .order("created_at", { ascending: false })
    .limit(30);

  if (!dismissals || dismissals.length < 10) return;

  const reasonCounts: Record<string, number> = {};
  for (const d of dismissals) {
    const reason = (d.payload as Record<string, unknown>)?.reason as string ?? "other";
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }

  // Get current weights
  const { data: settings } = await admin
    .from("user_settings")
    .select("scoring_weights")
    .eq("user_id", userId)
    .single();

  const currentWeights = settings?.scoring_weights ?? {
    goal_impact: 0.4,
    urgency: 0.3,
    energy_fit: 0.2,
    recency: 0.1,
  };

  try {
    const raw = await callAI({
      model: AI_MODELS.WEIGHT_ANALYSIS,
      system: "You analyze task dismissal patterns and recommend scoring weight adjustments. Output valid JSON only.",
      messages: [{
        role: "user",
        content: `User has dismissed ${totalDismissals} tasks total. Last 30 dismissal reasons:
${JSON.stringify(reasonCounts)}

Current scoring weights: ${JSON.stringify(currentWeights)}

Based on these patterns, suggest updated weights. Weights must sum to 1.0.
Keys: goal_impact, urgency, energy_fit, recency.

If "not_relevant" is high → decrease goal_impact weight.
If "wrong_timing" is high → increase energy_fit weight.
If "too_hard" is high → decrease urgency weight.

Return JSON: {"goal_impact": 0.35, "urgency": 0.25, "energy_fit": 0.25, "recency": 0.15}
Only output the JSON.`,
      }],
      route: "dismiss-weight-analysis",
      maxTokens: 200,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const newWeights = JSON.parse(jsonMatch[0]);

    // Validate weights sum to ~1.0
    const sum = Object.values(newWeights).reduce((s: number, v) => s + (v as number), 0);
    if (Math.abs(sum - 1.0) > 0.05) return;

    await admin
      .from("user_settings")
      .upsert({
        user_id: userId,
        scoring_weights: newWeights,
      }, { onConflict: "user_id" });
  } catch {
    // Weight analysis failure is non-critical
  }
}
