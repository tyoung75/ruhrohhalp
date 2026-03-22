import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/goals
 *
 * Returns goals grouped by pillar for the PillarHealth sidebar.
 *
 * Query params:
 *   - withPillars=true — returns full pillar objects with nested goals
 *   - pillarId=xxx    — filter to a single pillar
 *   - withSignals=true — include recent signal counts
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const withPillars = url.searchParams.get("withPillars") === "true";
  const pillarId = url.searchParams.get("pillarId");
  const withSignals = url.searchParams.get("withSignals") === "true";

  const supabase = await createClient();

  if (withPillars) {
    // Fetch pillars + goals + task counts
    const { data: pillars, error: pillarError } = await supabase
      .from("pillars")
      .select("id, name, description, icon, color, sort_order")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: true });

    if (pillarError) return NextResponse.json({ error: pillarError.message }, { status: 500 });

    const { data: goals, error: goalError } = await supabase
      .from("goals")
      .select("id, title, pillar_id, progress_metric, current_value, target_value, methods, tags, status, created_at")
      .eq("user_id", user.id)
      .neq("status", "abandoned");

    if (goalError) return NextResponse.json({ error: goalError.message }, { status: 500 });

    // Fetch active task counts per project (proxy for pillar)
    const { data: taskCounts } = await supabase
      .from("tasks")
      .select("goal_id")
      .eq("user_id", user.id)
      .in("state", ["backlog", "unstarted", "started", "in_review"])
      .not("goal_id", "is", null);

    // Fetch recent signal counts per pillar
    const signalCounts: Record<string, number> = {};
    if (withSignals) {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: signals } = await supabase
        .from("goal_signals")
        .select("pillar_id")
        .eq("user_id", user.id)
        .gte("created_at", weekAgo);

      if (signals) {
        for (const s of signals) {
          if (s.pillar_id) signalCounts[s.pillar_id] = (signalCounts[s.pillar_id] ?? 0) + 1;
        }
      }
    }

    // Group goals by pillar
    const goalsByPillar = new Map<string, typeof goals>();
    for (const g of goals ?? []) {
      const list = goalsByPillar.get(g.pillar_id) ?? [];
      list.push(g);
      goalsByPillar.set(g.pillar_id, list);
    }

    // Count tasks per goal
    const tasksByGoal = new Map<string, number>();
    for (const t of taskCounts ?? []) {
      if (t.goal_id) tasksByGoal.set(t.goal_id, (tasksByGoal.get(t.goal_id) ?? 0) + 1);
    }

    // Build response
    const pillarData = (pillars ?? []).map((p) => {
      const pGoals = goalsByPillar.get(p.id) ?? [];
      const activeTaskCount = pGoals.reduce((sum, g) => sum + (tasksByGoal.get(g.id) ?? 0), 0);

      // Compute health: average goal progress, penalized by staleness
      const goalProgresses = pGoals.map((g) => {
        const current = parseFloat(g.current_value ?? "0");
        const target = parseFloat(g.target_value ?? "100");
        if (target === 0) return 50;
        return Math.min(100, Math.round((current / target) * 100));
      });

      const avgProgress = goalProgresses.length > 0
        ? Math.round(goalProgresses.reduce((s, v) => s + v, 0) / goalProgresses.length)
        : 0;

      // Health = average progress, boosted by recent signals, penalized by no goals
      const signalBoost = Math.min(10, (signalCounts[p.id] ?? 0) * 2);
      const health = pGoals.length === 0 ? 0 : Math.min(100, avgProgress + signalBoost);

      return {
        id: p.id,
        name: p.name,
        icon: p.icon ?? "◈",
        color: p.color ?? "#e07d4a",
        health,
        status: pGoals.length === 0
          ? "No goals tracked"
          : `${pGoals.length} goal${pGoals.length > 1 ? "s" : ""} · ${avgProgress}% avg`,
        goals: pGoals.map((g) => ({
          id: g.id,
          title: g.title,
          pillar: p.name,
          pillarColor: p.color ?? "#e07d4a",
          progress: (() => {
            const current = parseFloat(g.current_value ?? "0");
            const target = parseFloat(g.target_value ?? "100");
            if (target === 0) return 50;
            return Math.min(100, Math.round((current / target) * 100));
          })(),
          currentValue: g.current_value ?? undefined,
          targetValue: g.target_value ?? undefined,
          metricLabel: g.progress_metric ?? undefined,
          activeMethods: g.methods ?? [],
        })),
        activeTaskCount,
        recentSignalCount: signalCounts[p.id] ?? 0,
      };
    });

    return NextResponse.json({ pillars: pillarData });
  }

  // Simple goals list
  let query = supabase
    .from("goals")
    .select("*, pillars(name, color, icon)")
    .eq("user_id", user.id)
    .neq("status", "abandoned")
    .order("created_at", { ascending: false });

  if (pillarId) {
    query = query.eq("pillar_id", pillarId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ goals: data ?? [] });
}

/**
 * POST /api/goals
 *
 * Creates a new goal under a pillar.
 *
 * Body:
 * {
 *   title: string (required)
 *   pillar_id: string (required)
 *   description?: string
 *   progress_metric?: string
 *   current_value?: string
 *   target_value?: string
 *   methods?: string[]
 *   tags?: string[]
 *   deadline?: ISO date
 * }
 */
export async function POST(request: NextRequest) {
  // Dual auth
  const webhookSecret = request.headers.get("x-webhook-secret");
  let userId: string;

  if (webhookSecret) {
    const authError = validateWebhookSecret(webhookSecret);
    if (authError) return authError;
    const body = await request.json();
    if (!body.user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
    userId = body.user_id;
    // Re-create request since we consumed the body
    request = new NextRequest(request, { body: JSON.stringify(body) });
  } else {
    const { user, response } = await requireUser();
    if (response || !user) return response;
    userId = user.id;
  }

  const body = await request.json();
  const { title, pillar_id, description, progress_metric, current_value, target_value, methods, tags, deadline } = body;

  if (!title || !pillar_id) {
    return NextResponse.json({ error: "title and pillar_id are required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("goals")
    .insert({
      user_id: userId,
      title,
      pillar_id,
      description: description ?? null,
      progress_metric: progress_metric ?? null,
      current_value: current_value ?? null,
      target_value: target_value ?? null,
      methods: methods ?? [],
      tags: tags ?? [],
      deadline: deadline ?? null,
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ goal: data }, { status: 201 });
}
