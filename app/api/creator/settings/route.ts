/**
 * Creator OS Settings — GET/PATCH /api/creator/settings
 *
 * GET: Returns the user's creator_settings (or defaults if none exist)
 * PATCH: Upserts settings (specifically daily_publish_limit)
 *
 * Body (PATCH): { daily_publish_limit: number }
 *
 * Auth: Authenticated user session.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const supabase = createAdminClient();

  try {
    // Try to fetch existing settings
    const { data: settings, error: fetchError } = await supabase
      .from("creator_settings")
      .select("id, user_id, daily_publish_limit, updated_at")
      .eq("user_id", user.id)
      .single();

    // If settings don't exist, return defaults
    if (fetchError?.code === "PGRST116") {
      return NextResponse.json({
        daily_publish_limit: 2,
        isDefault: true,
      });
    }

    if (fetchError) {
      throw new Error(`Failed to fetch settings: ${fetchError.message}`);
    }

    return NextResponse.json({
      id: settings.id,
      daily_publish_limit: settings.daily_publish_limit,
      updated_at: settings.updated_at,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await request.json().catch(() => null);
  if (body?.daily_publish_limit === undefined) {
    return NextResponse.json(
      { error: "Missing daily_publish_limit" },
      { status: 400 }
    );
  }

  const { daily_publish_limit } = body as { daily_publish_limit: number };

  if (typeof daily_publish_limit !== "number" || daily_publish_limit < 1) {
    return NextResponse.json(
      { error: "daily_publish_limit must be a positive number" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  try {
    const { data: settings, error: upsertError } = await supabase
      .from("creator_settings")
      .upsert({
        user_id: user.id,
        daily_publish_limit,
        updated_at: new Date().toISOString(),
      })
      .select("id, daily_publish_limit, updated_at")
      .single();

    if (upsertError) {
      throw new Error(`Failed to update settings: ${upsertError.message}`);
    }

    return NextResponse.json({
      success: true,
      id: settings.id,
      daily_publish_limit: settings.daily_publish_limit,
      updated_at: settings.updated_at,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update settings" },
      { status: 500 }
    );
  }
}
