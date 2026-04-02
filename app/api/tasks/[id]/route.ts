import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { taskPatchSchema } from "@/lib/validation";
import { getTierForUser } from "@/lib/profile";
import { isModelAllowedForTier } from "@/lib/tiers";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateUnblockHint } from "@/lib/ai/unblock-hint";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const parsed = taskPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { id } = await context.params;

  const updates: Record<string, string | null> = {};

  // Handle explicit state changes
  if (parsed.data.state) {
    updates.state = parsed.data.state;
    if (parsed.data.state === "done" || parsed.data.state === "cancelled") {
      updates.status = "done";
    } else {
      updates.status = "open";
    }
  }

  // Handle legacy status changes
  if (parsed.data.status) {
    updates.status = parsed.data.status;
    if (parsed.data.status === "done") updates.state = "done";
    else if (parsed.data.status === "open") updates.state = updates.state ?? "unstarted";
  }

  if (parsed.data.title) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.snoozed_until !== undefined) updates.snoozed_until = parsed.data.snoozed_until;

  if (parsed.data.selectedModel !== undefined) {
    const tier = await getTierForUser(user.id);
    if (parsed.data.selectedModel && !isModelAllowedForTier(tier, parsed.data.selectedModel)) {
      return NextResponse.json({ error: "Selected model not available for your plan." }, { status: 403 });
    }
    updates.selected_model = parsed.data.selectedModel;
  }

  updates.updated_at = new Date().toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, title, description, state, goal_id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // Auto-signal on task completion: insert goal_signal + outcome_signal when state → done and goal_id is set
  if (updates.state === "done" && data.goal_id) {
    const admin = createAdminClient();
    void (async () => {
      try {
        const { data: goal } = await admin.from("goals").select("pillar_id").eq("id", data.goal_id).single();
        if (!goal) return;
        await Promise.all([
          admin.from("goal_signals").insert({
            user_id: user.id,
            goal_id: data.goal_id,
            pillar_id: goal.pillar_id,
            signal_type: "task_completed",
            content: `Task completed: ${data.title}`,
            impact_score: 0.7,
            source_ref: data.id,
          }),
          admin.from("outcome_signals").insert({
            pillar_id: goal.pillar_id,
            goal_id: data.goal_id,
            signal_type: "task_completed",
            value: 1,
            value_text: data.title,
            source: "task_completion",
          }),
        ]);
      } catch {
        // Non-blocking side effect.
      }
    })();
  }

  // Fire-and-forget: generate unblock_hint when state → blocked
  if (updates.state === "blocked") {
    const admin = createAdminClient();
    // Fetch goal title if linked
    let goalTitle: string | undefined;
    if (data.goal_id) {
      const { data: goal } = await admin.from("goals").select("title").eq("id", data.goal_id).single();
      goalTitle = goal?.title;
    }

    generateUnblockHint({
      title: data.title,
      description: data.description ?? undefined,
      goal_title: goalTitle,
    }).then(async (hint) => {
      if (hint) {
        const { data: existing } = await admin.from("tasks").select("ai_metadata").eq("id", id).single();
        const meta = (existing?.ai_metadata as Record<string, unknown>) ?? {};
        await admin
          .from("tasks")
          .update({ ai_metadata: { ...meta, unblock_hint: hint } })
          .eq("id", id);
      }
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id).eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
