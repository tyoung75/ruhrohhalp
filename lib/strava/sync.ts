/**
 * Strava sync — imports recent activities into the brain as goal signals
 * and semantic memories. Called by the daily cron.
 *
 * Data flow:
 *   Strava API → goal_signals (type: 'workout') + memories (embedded)
 *
 * Only imports activities that haven't been synced yet (checks source_ref).
 * Scoped to Tyler's user ID and Strava athlete ID.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getActivities, type StravaActivity } from "./client";

/** Tyler's Supabase user ID. */
const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

// ---------------------------------------------------------------------------
// Activity → human description (for goal signals + embeddings)
// ---------------------------------------------------------------------------

const toMiles = (m: number) => (m / 1609.344).toFixed(1);
const toHMS = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const toPace = (mps: number) => {
  if (!mps || mps === 0) return "";
  const spm = 1609.344 / mps;
  const min = Math.floor(spm / 60);
  const sec = Math.round(spm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/mi`;
};

function describeActivity(a: StravaActivity): string {
  const date = new Date(a.start_date_local).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const parts = [`${date}: ${a.type} — "${a.name}"`];

  if (a.distance > 0) parts.push(`${toMiles(a.distance)} mi`);
  parts.push(toHMS(a.moving_time));
  if (a.type === "Run" && a.average_speed > 0) parts.push(`pace ${toPace(a.average_speed)}`);
  if (a.average_heartrate) parts.push(`avg HR ${Math.round(a.average_heartrate)}`);
  if (a.total_elevation_gain > 10) parts.push(`${Math.round(a.total_elevation_gain * 3.281)}ft elev`);
  if (a.suffer_score) parts.push(`suffer score ${a.suffer_score}`);
  if (a.pr_count > 0) parts.push(`${a.pr_count} PR${a.pr_count > 1 ? "s" : ""}!`);
  if (a.calories) parts.push(`${a.calories} cal`);

  return parts.join(" | ");
}

function sentimentForActivity(a: StravaActivity): "positive" | "neutral" | "negative" {
  if (a.pr_count > 0 || a.suffer_score && a.suffer_score > 100) return "positive";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

export async function syncStravaActivities(): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
}> {
  const supabase = createAdminClient();
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  try {
    // Fetch last 7 days of activities from Strava
    const sevenDaysAgo = Math.floor((Date.now() - 7 * 86400000) / 1000);
    const activities = await getActivities({ after: sevenDaysAgo, perPage: 50 });

    if (!activities.length) {
      return { imported: 0, skipped: 0, errors: [] };
    }

    // Check which activities are already synced (by source_ref = "strava:{id}")
    const stravaRefs = activities.map((a) => `strava:${a.id}`);
    const { data: existing } = await supabase
      .from("goal_signals")
      .select("source_ref")
      .eq("user_id", TYLER_USER_ID)
      .in("source_ref", stravaRefs);

    const existingRefs = new Set((existing ?? []).map((e: { source_ref: string }) => e.source_ref));

    // Find the fitness goal to link signals to (if one exists)
    const { data: fitnessGoals } = await supabase
      .from("goals")
      .select("id, pillar_id")
      .eq("user_id", TYLER_USER_ID)
      .eq("status", "active")
      .ilike("title", "%marathon%")
      .limit(1);

    // Fallback: any active fitness-related goal
    let goalId: string | null = fitnessGoals?.[0]?.id ?? null;
    let pillarId: string | null = fitnessGoals?.[0]?.pillar_id ?? null;

    if (!goalId) {
      const { data: anyFitnessGoal } = await supabase
        .from("goals")
        .select("id, pillar_id")
        .eq("user_id", TYLER_USER_ID)
        .eq("status", "active")
        .or("title.ilike.%run%,title.ilike.%fitness%,title.ilike.%training%")
        .limit(1);
      goalId = anyFitnessGoal?.[0]?.id ?? null;
      pillarId = anyFitnessGoal?.[0]?.pillar_id ?? null;
    }

    // Insert new activities as goal signals
    for (const activity of activities) {
      const ref = `strava:${activity.id}`;
      if (existingRefs.has(ref)) {
        skipped++;
        continue;
      }

      const description = describeActivity(activity);
      const impact = activity.type === "Run"
        ? Math.min(1, (activity.distance / 16093.44)) // 10 miles = 1.0 impact
        : activity.type === "WeightTraining"
          ? 0.6
          : 0.3;

      const { error } = await supabase.from("goal_signals").insert({
        user_id: TYLER_USER_ID,
        goal_id: goalId,
        pillar_id: pillarId,
        signal_type: "workout",
        content: description,
        sentiment: sentimentForActivity(activity),
        impact_score: Math.round(impact * 100) / 100,
        source_ref: ref,
        raw_data: {
          strava_id: activity.id,
          type: activity.type,
          sport_type: activity.sport_type,
          name: activity.name,
          distance_m: activity.distance,
          moving_time_s: activity.moving_time,
          average_speed_mps: activity.average_speed,
          average_heartrate: activity.average_heartrate,
          max_heartrate: activity.max_heartrate,
          total_elevation_gain_m: activity.total_elevation_gain,
          suffer_score: activity.suffer_score,
          calories: activity.calories,
          pr_count: activity.pr_count,
          start_date_local: activity.start_date_local,
          start_latlng: activity.start_latlng,
        },
      });

      if (error) {
        errors.push(`Signal insert for ${ref}: ${error.message}`);
      } else {
        imported++;
      }
    }

    return { imported, skipped, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Unknown sync error");
    return { imported, skipped, errors };
  }
}
