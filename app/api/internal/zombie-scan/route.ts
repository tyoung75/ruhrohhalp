import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "@/lib/jobs/executor";

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use ISO week number in key so weekly scan is truly weekly, not daily-deduped
  const now = new Date();
  const weekNumber = Math.ceil(
    ((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 +
      new Date(now.getFullYear(), 0, 1).getDay() +
      1) /
      7,
  );
  const idempotencyKey = `zombie-scan-${now.getFullYear()}-W${weekNumber}`;

  const result = await runJob(
    "zombie-scan",
    async () => {
      const supabase = createAdminClient();
      const userId = process.env.CREATOR_USER_ID;

      if (!userId) {
        // Fallback: fetch first profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .limit(1)
          .single();
        if (!profile) throw new Error("No user found");
        return await runZombieScan(supabase, profile.id);
      }

      return await runZombieScan(supabase, userId);
    },
    { idempotencyKey },
  );

  return NextResponse.json(result);
}

async function runZombieScan(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: zombies, error } = await supabase
    .from("tasks")
    .select("id, title, state, updated_at, priority_score")
    .eq("user_id", userId)
    .not("state", "in", "(done,cancelled,blocked)")
    .lt("updated_at", sevenDaysAgo)
    .order("updated_at", { ascending: true });

  if (error) throw new Error(error.message);

  let alertsCreated = 0;

  for (const zombie of zombies ?? []) {
    const daysSinceUpdate = Math.floor(
      (Date.now() - new Date(zombie.updated_at).getTime()) / (1000 * 60 * 60 * 24),
    );

    await supabase.from("activity_log").insert({
      user_id: userId,
      type: "zombie_alert",
      entity_id: zombie.id,
      payload: {
        action: "zombie_alert",
        title: zombie.title,
        state: zombie.state,
        days_stale: daysSinceUpdate,
        priority_score: zombie.priority_score,
      },
    });

    alertsCreated++;
  }

  return {
    ok: true,
    job: "zombie-scan",
    zombies_found: zombies?.length ?? 0,
    alerts_created: alertsCreated,
  };
}
