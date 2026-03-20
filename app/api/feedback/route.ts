import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/feedback
 *
 * Returns unread/unapplied feedback entries
 *
 * Query params:
 * - applied=false (filter by applied status, defaults to false)
 * - limit=50 (pagination)
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const appliedParam = url.searchParams.get("applied");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 250);

  const supabase = await createClient();
  let query = supabase
    .from("feedback")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Default to unapplied feedback
  if (appliedParam === null || appliedParam === "false") {
    query = query.eq("applied", false);
  } else if (appliedParam === "true") {
    query = query.eq("applied", true);
  }

  const { data, error, count } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    feedback: data ?? [],
    total: count ?? 0,
  });
}

/**
 * POST /api/feedback
 *
 * Saves new feedback entry
 *
 * Body:
 * {
 *   section: string (required, e.g. "leverage_tasks", "open_decisions")
 *   action: string (required, e.g. "add", "remove", "modify")
 *   note: string (required, the feedback content)
 *   briefing_id?: string (optional, link to briefing)
 * }
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { section, action, note, briefing_id } = body;

  if (!section || !action || !note) {
    return NextResponse.json(
      { error: "section, action, and note are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("feedback")
    .insert({
      user_id: user.id,
      section,
      action,
      note,
      briefing_id: briefing_id ?? null,
      applied: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ feedback: data }, { status: 201 });
}

/**
 * PATCH /api/feedback
 *
 * Marks feedback entries as applied
 *
 * Body:
 * {
 *   ids: string[] (required, feedback IDs to mark as applied)
 * }
 */
export async function PATCH(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("feedback")
    .update({
      applied: true,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .in("id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: ids.length });
}
