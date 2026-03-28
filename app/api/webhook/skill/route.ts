import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { computePriorityScore, parseWeights } from "@/lib/ai/scoring";
import { generateLeverageReason } from "@/lib/ai/leverage-reason";

type SkillAction = "create_task" | "update_task_state" | "add_goal_signal";

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const action = body.action as SkillAction;

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Get the single user
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .limit(1)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "No user found" }, { status: 404 });
  }

  const userId = profile.id;

  switch (action) {
    case "create_task":
      return handleCreateTask(supabase, userId, body);
    case "update_task_state":
      return handleUpdateTaskState(supabase, userId, body);
    case "add_goal_signal":
      return handleAddGoalSignal(supabase, userId, body);
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}

async function handleCreateTask(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const { title, description, priority, priority_num, goal_id, source, due_date, project_slug } = body;

  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  // Map priority
  let priorityText = "medium";
  const pNum = typeof priority_num === "number" ? priority_num : 3;
  if (pNum <= 2) priorityText = "high";
  else if (pNum === 4) priorityText = "low";
  if (typeof priority === "string") priorityText = priority;

  // Resolve project by slug
  let projectId = null;
  if (project_slug) {
    const { data: proj } = await supabase
      .from("projects")
      .select("id")
      .eq("user_id", userId)
      .eq("slug", project_slug)
      .single();
    if (proj) projectId = proj.id;
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title,
      description: (description as string) ?? "",
      priority: priorityText,
      priority_num: pNum,
      state: "unstarted",
      status: "open",
      goal_id: (goal_id as string) ?? null,
      project_id: projectId,
      due_date: (due_date as string) ?? null,
      source: (source as string) ?? "api",
      type: "task",
      recommended_ai: "claude",
      recommended_model: "claude-sonnet-4-6",
      ai_reason: "",
      how_to: "",
      audit_notes: "",
      memory_key: "",
      source_text: title,
      is_open_loop: false,
    })
    .select("id, identifier, priority_num, due_date, goal_id, state, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Immediately score the task
  const { data: settings } = await supabase
    .from("user_settings")
    .select("scoring_weights")
    .eq("user_id", userId)
    .single();

  const weights = parseWeights(settings?.scoring_weights);
  const score = computePriorityScore(task, weights);

  await supabase
    .from("tasks")
    .update({ priority_score: score })
    .eq("id", task.id);

  // Log activity
  await supabase.from("activity_log").insert({
    user_id: userId,
    type: "task_created",
    entity_id: task.id,
    payload: { source: source ?? "skill", action: "create_task" },
  });

  // Fire-and-forget: enrich leverage_reason via Sonnet
  generateLeverageReason({
    title: title as string,
    description: (description as string) ?? undefined,
    priority_score: score,
  }).then(async (reason) => {
    if (reason) {
      await supabase
        .from("tasks")
        .update({ leverage_reason: reason, ai_metadata: { leverage_reason: reason } })
        .eq("id", task.id);
    }
  }).catch(() => {});

  return NextResponse.json(
    {
      ok: true,
      task_id: `[RRH:${task.id}]`,
      identifier: task.identifier,
      priority_score: score,
    },
    { status: 201 },
  );
}

async function handleUpdateTaskState(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const rawTaskId = body.task_id as string;
  const newState = body.state as string;

  if (!rawTaskId || !newState) {
    return NextResponse.json({ error: "task_id and state are required" }, { status: 400 });
  }

  // Parse [RRH:uuid] format
  const taskId = rawTaskId.replace(/^\[RRH:/, "").replace(/\]$/, "");

  const validStates = ["backlog", "unstarted", "started", "in_review", "done", "cancelled", "blocked"];
  if (!validStates.includes(newState)) {
    return NextResponse.json({ error: `Invalid state: ${newState}` }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    state: newState,
    updated_at: new Date().toISOString(),
  };

  // Sync status with state
  if (newState === "done") updates.status = "done";
  else if (newState === "cancelled") updates.status = "done";
  else updates.status = "open";

  // Fetch task details (including goal_id and title for signal)
  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", taskId)
    .eq("user_id", userId)
    .select("id, state, title, goal_id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // Log activity
  const activityType = newState === "done" ? "task_completed" : newState === "cancelled" ? "task_cancelled" : "task_updated";
  await supabase.from("activity_log").insert({
    user_id: userId,
    type: activityType,
    entity_id: taskId,
    payload: { new_state: newState, source: "skill" },
  });

  // Auto-signal on task completion: insert goal_signal + outcome_signal
  if (newState === "done" && data.goal_id) {
    supabase.from("goals").select("pillar_id").eq("id", data.goal_id).single().then(async ({ data: goal }) => {
      if (!goal) return;
      await Promise.all([
        supabase.from("goal_signals").insert({
          user_id: userId,
          goal_id: data.goal_id,
          pillar_id: goal.pillar_id,
          signal_type: "task_completed",
          content: `Task completed: ${data.title}`,
          impact_score: 0.7,
          source_ref: data.id,
        }),
        supabase.from("outcome_signals").insert({
          pillar_id: goal.pillar_id,
          goal_id: data.goal_id,
          signal_type: "task_completed",
          value: 1,
          value_text: data.title,
          source: "task_completion",
        }),
      ]);
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    task_id: `[RRH:${taskId}]`,
    state: newState,
  });
}

async function handleAddGoalSignal(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const { goal_id, signal_type, value, content } = body;

  if (!goal_id || !signal_type) {
    return NextResponse.json({ error: "goal_id and signal_type are required" }, { status: 400 });
  }

  // Validate signal_type against the check constraint
  const validTypes = ["email", "calendar", "social_post", "purchase", "workout", "task_completed", "manual", "webhook"];
  if (!validTypes.includes(signal_type as string)) {
    return NextResponse.json({ error: `Invalid signal_type: ${signal_type}` }, { status: 400 });
  }

  // Get the goal to find pillar_id
  const { data: goal } = await supabase
    .from("goals")
    .select("id, pillar_id")
    .eq("id", goal_id)
    .eq("user_id", userId)
    .single();

  if (!goal) {
    return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  }

  const { data: signal, error } = await supabase
    .from("goal_signals")
    .insert({
      user_id: userId,
      goal_id: goal.id,
      pillar_id: goal.pillar_id,
      signal_type,
      content: (content as string) ?? `Signal: ${signal_type}`,
      impact_score: typeof value === "number" ? value : 0.5,
      raw_data: body,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    signal_id: signal.id,
    goal_id,
  });
}
