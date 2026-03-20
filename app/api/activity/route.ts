import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/activity
 *
 * Returns recent activity log entries
 *
 * Query params:
 * - limit=50 (pagination, default 50, max 250)
 * - offset=0 (pagination offset)
 * - type=task_completed,briefing_generated (comma-separated filter)
 * - after=2026-03-19T00:00:00Z (ISO timestamp, return activities after this)
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 250);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");
  const typeParam = url.searchParams.get("type");
  const afterParam = url.searchParams.get("after");

  const supabase = await createClient();
  let query = supabase
    .from("activity_log")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Apply type filter
  if (typeParam) {
    const types = typeParam.split(",").map(t => t.trim());
    query = query.in("type", types);
  }

  // Apply time filter
  if (afterParam) {
    query = query.gte("created_at", afterParam);
  }

  const { data, error, count } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    activity: data ?? [],
    pagination: {
      limit,
      offset,
      total: count ?? 0,
    },
  });
}
