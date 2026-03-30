import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildFingerprint } from "@/lib/signal-fingerprint";

/**
 * GET /api/signals/dismiss
 *
 * Returns all active dismissals for the current user.
 * Used by the signals panel to filter out dismissed signals client-side
 * and by the briefing generator to suppress dismissed topics.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("signal_dismissals")
    .select("id, fingerprint, original_text, category, source, created_at")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ dismissals: data ?? [] });
}

/**
 * POST /api/signals/dismiss
 *
 * Dismisses a signal by its content. Builds a fuzzy fingerprint
 * so similar signals won't reappear in future briefings.
 *
 * Body:
 * {
 *   text: string (required, the signal text)
 *   category?: string
 *   source?: string
 * }
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { text, category, source } = body;

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const fingerprint = buildFingerprint(text);
  const supabase = await createClient();

  // Upsert: if already dismissed, just return success
  const { data, error } = await supabase
    .from("signal_dismissals")
    .upsert(
      {
        user_id: user.id,
        fingerprint,
        original_text: text,
        category: category ?? null,
        source: source ?? null,
        active: true,
        created_at: new Date().toISOString(),
      },
      { onConflict: "user_id,fingerprint", ignoreDuplicates: true }
    )
    .select()
    .single();

  if (error && !error.message.includes("duplicate")) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ dismissal: data, fingerprint }, { status: 201 });
}

/**
 * DELETE /api/signals/dismiss
 *
 * Undismisses a signal (reactivates it).
 *
 * Body:
 * {
 *   id?: string (dismissal ID)
 *   fingerprint?: string (alternative: undismiss by fingerprint)
 * }
 */
export async function DELETE(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { id, fingerprint } = body;

  if (!id && !fingerprint) {
    return NextResponse.json({ error: "id or fingerprint is required" }, { status: 400 });
  }

  const supabase = await createClient();

  let query = supabase
    .from("signal_dismissals")
    .update({ active: false })
    .eq("user_id", user.id);

  if (id) {
    query = query.eq("id", id);
  } else {
    query = query.eq("fingerprint", fingerprint);
  }

  const { error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
