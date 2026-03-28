import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/content-queue/[id]
 * Update content queue item (e.g. approve for publishing: { status: "queued" })
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { id } = await context.params;
  const body = await request.json();

  const allowedFields = ["status", "body", "caption", "title", "hashtags", "scheduled_for", "platform_spec"];
  const updates: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const validStatuses = ["draft", "approved", "queued", "posting", "posted", "failed"];
  if (updates.status && !validStatuses.includes(updates.status as string)) {
    return NextResponse.json({ error: `Invalid status: ${updates.status}` }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_queue")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, platform, status")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Content item not found" }, { status: 404 });

  return NextResponse.json({ ok: true, item: data });
}
