import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/system-alerts
 * Returns recent system alerts (zombie_alert, dead-letter job_runs, etc.)
 *
 * Query params:
 *   - type: filter by alert type (e.g. "zombie_alert")
 *   - hours: lookback window in hours (default 48)
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const hours = parseInt(url.searchParams.get("hours") ?? "48");

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const supabase = await createClient();

  // Fetch zombie alerts from activity_log
  let query = supabase
    .from("activity_log")
    .select("id, type, entity_id, payload, created_at")
    .eq("user_id", user.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);

  if (type) {
    // Filter by payload.action since activity_log.type has a check constraint
    query = query.contains("payload", { action: type });
  }

  const { data: alerts, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also check for dead-letter job_runs (from Item 5)
  let deadLetterJobs: unknown[] = [];
  try {
    const { data: jobs } = await supabase
      .from("job_runs")
      .select("id, job_type, status, error, created_at")
      .eq("status", "dead_letter")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    deadLetterJobs = jobs ?? [];
  } catch {
    // job_runs table may not exist yet
  }

  return NextResponse.json({
    alerts: alerts ?? [],
    dead_letter_jobs: deadLetterJobs,
  });
}
