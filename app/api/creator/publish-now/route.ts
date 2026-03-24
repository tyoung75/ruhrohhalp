/**
 * On-demand publish — POST /api/creator/publish-now
 *
 * Publishes all queued posts whose scheduled_for has arrived.
 * Called from the Creator UI "Publish Now" button.
 * Also callable via cron secret for automated workflows.
 *
 * Auth: Authenticated user session or cron secret.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { publishQueuedPosts } from "@/lib/creator/jobs";

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get("x-cron-secret");
  let userId: string;

  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    userId = process.env.CREATOR_USER_ID ?? "";
    if (!userId) {
      return NextResponse.json({ error: "Missing CREATOR_USER_ID" }, { status: 400 });
    }
  } else {
    const { user, response } = await requireUser();
    if (!user) return response!;
    userId = user.id;
  }

  try {
    const result = await publishQueuedPosts(userId, 10);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Publish failed" },
      { status: 500 }
    );
  }
}
