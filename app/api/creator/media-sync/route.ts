/**
 * Media Sync API — POST /api/creator/media-sync
 *
 * Triggers a sync of media from Google Drive into the media_assets table.
 * Called by:
 * - Vercel cron (every 2 hours) via /api/cron
 * - Manual trigger from Creator UI
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { syncMediaFromDrive } from "@/lib/creator/media-ingest";

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    const result = await syncMediaFromDrive(user.id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Media sync failed" },
      { status: 500 }
    );
  }
}
