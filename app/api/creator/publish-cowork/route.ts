/**
 * Cowork-triggered publish — POST /api/creator/publish-cowork
 *
 * Called by scheduled Cowork tasks to publish queued posts at optimal times.
 * Same as publish-now but with source: "cowork" so the backfill cap is enforced.
 *
 * Auth: Cron secret (Cowork tasks call this via x-cron-secret header).
 */

import { NextRequest, NextResponse } from "next/server";
import { publishQueuedPosts, expireStaleDrafts } from "@/lib/creator/jobs";

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get("x-cron-secret");
  const userId = process.env.CREATOR_USER_ID ?? "";

  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!userId) {
    return NextResponse.json({ error: "Missing CREATOR_USER_ID" }, { status: 400 });
  }

  try {
    // Expire stale drafts before selecting
    const expireResult = await expireStaleDrafts(userId);

    // Publish with cowork source — backfill cap applies
    const publishResult = await publishQueuedPosts(userId, { source: "cowork" });

    return NextResponse.json({
      ...publishResult,
      expired: expireResult.expired,
      source: "cowork",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cowork publish failed" },
      { status: 500 }
    );
  }
}
