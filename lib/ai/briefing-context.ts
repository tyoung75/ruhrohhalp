import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Load cross-system snapshot for weekly briefings.
 * Includes outcome_signals, content queue, content performance, patterns.
 */
export async function loadBriefingContext(userId: string) {
  const supabase = createAdminClient();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    goalsRes,
    tasksCompletedRes,
    tasksCreatedRes,
    outcomeSignalsRes,
    goalSignalsRes,
    contentQueueRes,
    analyticsRes,
    settingsRes,
  ] = await Promise.all([
    // Active goals with progress
    supabase
      .from("goals")
      .select("id, title, progress_current, progress_target, progress_metric, status")
      .eq("user_id", userId)
      .eq("status", "active"),

    // Tasks completed this week
    supabase
      .from("tasks")
      .select("id, title, goal_id, priority_score")
      .eq("user_id", userId)
      .eq("state", "done")
      .gte("updated_at", weekAgo),

    // Tasks created this week
    supabase
      .from("tasks")
      .select("id, title, state, priority_score")
      .eq("user_id", userId)
      .gte("created_at", weekAgo),

    // Outcome signals this week
    supabase
      .from("outcome_signals")
      .select("signal_type, value, value_text, goal_id, recorded_at, source")
      .gte("recorded_at", weekAgo)
      .order("recorded_at", { ascending: false }),

    // Goal signals this week
    supabase
      .from("goal_signals")
      .select("signal_type, content, impact_score, goal_id, created_at")
      .eq("user_id", userId)
      .gte("created_at", weekAgo),

    // Content queue status
    supabase
      .from("content_queue")
      .select("platform, status, ai_audit_passed")
      .eq("user_id", userId)
      .gte("created_at", weekAgo),

    // Top performing content this week
    supabase
      .from("post_analytics")
      .select("platform, likes, impressions, engagement_score, content_queue_id")
      .eq("user_id", userId)
      .gte("fetched_at", weekAgo)
      .order("engagement_score", { ascending: false })
      .limit(10),

    // User settings (patterns, brain dump)
    supabase
      .from("user_settings")
      .select("brain_dump_week, top_of_mind, content_patterns")
      .eq("user_id", userId)
      .single(),
  ]);

  return {
    goals: goalsRes.data ?? [],
    tasks_completed: tasksCompletedRes.data ?? [],
    tasks_created: tasksCreatedRes.data ?? [],
    outcome_signals: outcomeSignalsRes.data ?? [],
    goal_signals: goalSignalsRes.data ?? [],
    content_queue_summary: {
      total: contentQueueRes.data?.length ?? 0,
      by_status: groupBy(contentQueueRes.data ?? [], "status"),
      by_platform: groupBy(contentQueueRes.data ?? [], "platform"),
    },
    top_content: analyticsRes.data ?? [],
    brain_dump_week: settingsRes.data?.brain_dump_week ?? null,
    top_of_mind: settingsRes.data?.top_of_mind ?? null,
    content_patterns: settingsRes.data?.content_patterns ?? {},
  };
}

function groupBy<T extends Record<string, unknown>>(items: T[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const val = String(item[key] ?? "unknown");
    counts[val] = (counts[val] ?? 0) + 1;
  }
  return counts;
}
