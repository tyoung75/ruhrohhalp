/**
 * Sync external posts — POST /api/creator/sync
 *
 * Discovers posts made directly in the Threads app (outside Creator OS)
 * and imports them into content_queue so analytics are tracked for everything.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { syncExternalPosts } from "@/lib/creator/jobs";

export async function POST() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    const result = await syncExternalPosts(user.id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
