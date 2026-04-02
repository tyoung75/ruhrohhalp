/**
 * Goal Check-in Nudge — POST /api/internal/goal-nudge
 *
 * Scans all active goals and identifies those with stale check-ins (no check-in
 * in the last 7 days). Creates activity_log entries surfaced in the evening
 * briefing and optionally creates lightweight reminder tasks.
 *
 * Runs nightly at 9 PM ET via GitHub Actions cron.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "@/lib/jobs/executor";

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const result = await runJob(
    "goal-nudge",
    async () => {
      const supabase = createAdminClient();
      const userId = process.env.CREATOR_USER_ID;

      if (!userId) {
        throw new Error("CREATOR_USER_ID not configured");
      }

      // Fetch all active goals with their pillar names
      const { data: goals, error: goalsError } = await supabase
        .from("goals")
        .select("id, title, pillar_id, pillars(name)")
        .eq("user_id", userId)
        .eq("status", "active");

      if (goalsError) throw new Error(goalsError.message);
      if (!goals?.length) {
        return { ok: true, job: "goal-nudge", stale_goals: 0, nudges_created: 0 };
      }

      // For each goal, find the most recent check-in
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      let staleGoals = 0;
      let nudgesCreated = 0;

      for (const goal of goals) {
        // Check for recent check-ins
        const { data: recentCheckin } = await supabase
          .from("goal_checkins")
          .select("id")
          .eq("goal_id", goal.id)
          .gte("created_at", sevenDaysAgo)
          .limit(1);

        // Also check for recent automated signals (Strava, etc.)
        const { data: recentSignal } = await supabase
          .from("goal_signals")
          .select("id")
          .eq("goal_id", goal.id)
          .gte("created_at", sevenDaysAgo)
          .limit(1);

        // Skip if goal has had any activity in the last 7 days
        if ((recentCheckin && recentCheckin.length > 0) || (recentSignal && recentSignal.length > 0)) {
          continue;
        }

        staleGoals++;

        // Find the last check-in date for context
        const { data: lastCheckin } = await supabase
          .from("goal_checkins")
          .select("created_at")
          .eq("goal_id", goal.id)
          .order("created_at", { ascending: false })
          .limit(1);

        const lastCheckinDate = lastCheckin?.[0]?.created_at;
        const daysSinceCheckin = lastCheckinDate
          ? Math.floor((Date.now() - new Date(lastCheckinDate).getTime()) / 86400000)
          : null;

        const pillarData = goal.pillars as { name?: string } | Array<{ name?: string }> | null;
        const pillarName = Array.isArray(pillarData)
          ? (pillarData[0]?.name ?? "Unknown")
          : (pillarData?.name ?? "Unknown");

        // Create activity log entry (surfaced in evening briefing)
        await supabase.from("activity_log").insert({
          user_id: userId,
          type: "goal_nudge",
          entity_id: goal.id,
          payload: {
            action: "goal_nudge",
            goal_title: goal.title,
            pillar: pillarName,
            days_since_checkin: daysSinceCheckin,
            last_checkin: lastCheckinDate ?? "never",
          },
        });

        nudgesCreated++;
      }

      return {
        ok: true,
        job: "goal-nudge",
        total_goals: goals.length,
        stale_goals: staleGoals,
        nudges_created: nudgesCreated,
      };
    },
    { idempotencyKey: `goal-nudge-${today}` },
  );

  return NextResponse.json(result);
}
