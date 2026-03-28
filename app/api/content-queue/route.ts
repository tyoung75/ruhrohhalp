import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/content-queue
 * Returns content queue items with optional filtering.
 *
 * Query params:
 *   - status: filter by status (e.g. "draft")
 *   - ai_audit_passed: filter by audit status ("true" or "false")
 *   - platform: filter by platform
 *   - limit: max items (default 50)
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const auditPassed = url.searchParams.get("ai_audit_passed");
  const platform = url.searchParams.get("platform");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

  const supabase = await createClient();
  let query = supabase
    .from("content_queue")
    .select("id, platform, content_type, body, caption, title, topic, status, ai_audit_passed, audit_notes, scheduled_for, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  if (auditPassed !== null && auditPassed !== undefined) {
    query = query.eq("ai_audit_passed", auditPassed === "true");
  }

  if (platform) {
    query = query.eq("platform", platform);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: data ?? [],
  });
}
