import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// TODO: wrap in runJob() after Item 5
export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Find zombie tasks: not updated in 7+ days, not done/blocked
  const { data: zombies, error } = await supabase
    .from("tasks")
    .select("id, title, state, updated_at, priority_score")
    .eq("user_id", userId)
    .not("state", "in", "(done,cancelled,blocked)")
    .lt("updated_at", sevenDaysAgo)
    .order("updated_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let alertsCreated = 0;

  for (const zombie of zombies ?? []) {
    const daysSinceUpdate = Math.floor(
      (Date.now() - new Date(zombie.updated_at).getTime()) / (1000 * 60 * 60 * 24),
    );

    await supabase.from("activity_log").insert({
      user_id: userId,
      type: "zombie_alert" as never, // extend type constraint in future migration
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

  return NextResponse.json({
    ok: true,
    job: "zombie-scan",
    zombies_found: zombies?.length ?? 0,
    alerts_created: alertsCreated,
  });
}
