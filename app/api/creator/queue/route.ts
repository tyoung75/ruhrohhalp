/**
 * Content Queue Management — GET & PATCH /api/creator/queue
 *
 * GET: Returns queue items with filtering
 *   ?status=draft,queued,posted,failed  (comma-separated, default: all)
 *   ?limit=50  (default 50, max 200)
 *   ?offset=0
 *   ?sort=recent|scheduled  (default: scheduled)
 *
 * PATCH: Update a queue item (status, body, scheduled_for)
 *   { id, status?, body?, scheduled_for? }
 *
 * Auth: Authenticated user session.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status")?.split(",").filter(Boolean);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const sort = url.searchParams.get("sort") === "recent" ? "recent" : "scheduled";

  const supabase = createAdminClient();

  let query = supabase
    .from("content_queue")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .range(offset, offset + limit - 1);

  if (sort === "recent") {
    query = query
      .order("scheduled_for", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
  } else {
    query = query
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
  }

  if (statusFilter?.length) {
    query = query.in("status", statusFilter);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}

export async function PATCH(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await request.json().catch(() => null);
  if (!body?.id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { id, status, body: postBody, scheduled_for } = body as {
    id: string;
    status?: string;
    body?: string;
    scheduled_for?: string;
  };

  const validStatuses = ["draft", "queued", "approved", "rejected"];
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from("content_queue")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // Don't allow editing already-posted content
  if (existing.status === "posted" && (postBody || scheduled_for)) {
    return NextResponse.json({ error: "Cannot edit posted content" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (status) updates.status = status;
  if (postBody !== undefined) updates.body = postBody;
  if (scheduled_for) updates.scheduled_for = scheduled_for;

  const { data: updated, error: updateError } = await supabase
    .from("content_queue")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, item: updated });
}
