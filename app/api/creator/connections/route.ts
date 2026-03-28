/**
 * GET /api/creator/connections
 *
 * Returns which platforms the user has connected (have tokens stored).
 * Used by the integrations page to show Connected / Connect status.
 *
 * Response: { connections: [{ platform: string, username?: string, connected_at: string }] }
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const supabase = createAdminClient();

  const { data: tokens, error } = await supabase
    .from("platform_tokens")
    .select("platform, platform_username, updated_at")
    .eq("user_id", user.id);

  if (error) {
    console.error("[connections] Failed to fetch tokens:", error);
    return NextResponse.json({ connections: [] });
  }

  const connections = (tokens ?? []).map((t) => ({
    platform: t.platform,
    username: t.platform_username ?? undefined,
    connected_at: t.updated_at,
  }));

  return NextResponse.json({ connections });
}
