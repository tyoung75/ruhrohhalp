import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildFingerprint } from "@/lib/signal-fingerprint";

/**
 * GET /api/signals/reply
 *
 * Returns replies for a specific signal (by fingerprint) or all unapplied replies.
 *
 * Query params:
 * - fingerprint: filter to replies for a specific signal
 * - applied: "true" | "false" (default: all)
 * - limit: number (default: 50)
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const fingerprint = url.searchParams.get("fingerprint");
  const appliedParam = url.searchParams.get("applied");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 250);

  const supabase = createAdminClient();

  let query = supabase
    .from("signal_replies")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (fingerprint) {
    query = query.eq("signal_fingerprint", fingerprint);
  }
  if (appliedParam === "false") {
    query = query.eq("applied", false);
  } else if (appliedParam === "true") {
    query = query.eq("applied", true);
  }

  const { data, error, count } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ replies: data ?? [], total: count ?? 0 });
}

/**
 * POST /api/signals/reply
 *
 * Submits a reply to a specific signal. The reply is stored with
 * the signal's fingerprint so the briefing generator can incorporate
 * this feedback when generating future signals on the same topic.
 *
 * Body:
 * {
 *   signal_text: string (required, the signal being replied to)
 *   reply: string (required, the user's response)
 *   signal_category?: string
 *   scope?: "specific" | "broad" (default: "specific")
 * }
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { signal_text, reply, signal_category, scope } = body;

  if (!signal_text || !reply) {
    return NextResponse.json(
      { error: "signal_text and reply are required" },
      { status: 400 }
    );
  }

  const fingerprint = buildFingerprint(signal_text);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("signal_replies")
    .insert({
      user_id: user.id,
      signal_fingerprint: fingerprint,
      signal_text,
      signal_category: signal_category ?? null,
      reply,
      scope: scope ?? "specific",
      applied: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("[signal_replies.insert]", JSON.stringify(error));
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reply: data }, { status: 201 });
}

/**
 * PATCH /api/signals/reply
 *
 * Marks replies as applied (used by the briefing generator after
 * incorporating feedback).
 *
 * Body:
 * {
 *   ids: string[] (required, reply IDs to mark as applied)
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

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("signal_replies")
    .update({ applied: true })
    .eq("user_id", user.id)
    .in("id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: ids.length });
}
