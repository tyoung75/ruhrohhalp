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
      .select("id, user_id, posts_per_job, stale_after_days, max_backfill, updated_at")
      .eq("user_id", user.id)
      .single();

    // If settings don't exist, return defaults
    if (fetchError?.code === "PGRST116") {
      return NextResponse.json({
        posts_per_job: 2,
        stale_after_days: 7,
        max_backfill: 6,
        isDefault: true,
      });
    }

    if (fetchError) {
      throw new Error(`Failed to fetch settings: ${fetchError.message}`);
    }

    return NextResponse.json({
      id: settings.id,
      posts_per_job: settings.posts_per_job,
      stale_after_days: settings.stale_after_days,
      max_backfill: settings.max_backfill,
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
  if (!body || (body.posts_per_job === undefined && body.stale_after_days === undefined && body.max_backfill === undefined)) {
    return NextResponse.json(
      { error: "Missing posts_per_job, stale_after_days, or max_backfill" },
      { status: 400 }
    );
  }

  const { posts_per_job, stale_after_days, max_backfill } = body as {
    posts_per_job?: number;
    stale_after_days?: number;
    max_backfill?: number;
  };

  if (posts_per_job !== undefined && (typeof posts_per_job !== "number" || posts_per_job < 1)) {
    return NextResponse.json(
      { error: "posts_per_job must be a positive number" },
      { status: 400 }
    );
  }

  if (stale_after_days !== undefined && (typeof stale_after_days !== "number" || stale_after_days < 1)) {
    return NextResponse.json(
      { error: "stale_after_days must be a positive number" },
      { status: 400 }
    );
  }

  if (max_backfill !== undefined && (typeof max_backfill !== "number" || max_backfill < 1)) {
    return NextResponse.json(
      { error: "max_backfill must be a positive number" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  try {
    const updateData: Record<string, unknown> = {
      user_id: user.id,
      updated_at: new Date().toISOString(),
    };
    if (posts_per_job !== undefined) {
      updateData.posts_per_job = posts_per_job;
    }
    if (stale_after_days !== undefined) {
      updateData.stale_after_days = stale_after_days;
    }
    if (max_backfill !== undefined) {
      updateData.max_backfill = max_backfill;
    }

    const { data: settings, error: upsertError } = await supabase
      .from("creator_settings")
      .upsert(updateData)
      .select("id, posts_per_job, stale_after_days, max_backfill, updated_at")
      .single();

    if (upsertError) {
      throw new Error(`Failed to update settings: ${upsertError.message}`);
    }

    return NextResponse.json({
      success: true,
      id: settings.id,
      posts_per_job: settings.posts_per_job,
      stale_after_days: settings.stale_after_days,
      max_backfill: settings.max_backfill,
      updated_at: settings.updated_at,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update settings" },
      { status: 500 }
    );
  }
}
