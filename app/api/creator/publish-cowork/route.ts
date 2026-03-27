/**
 * Cowork-triggered publish — POST /api/creator/publish-cowork
 *
 * Called by scheduled Cowork tasks to publish queued posts at optimal times.
 * Same as publish-now but with source: "cowork" so the backfill cap is enforced.
 *
 * Also runs the AI Editor pipeline (media sync → analyze → plan → execute)
 * so new photos/videos get picked up throughout the day — not just at the
 * 6 AM daily cron. This effectively gives us 4 editor runs per day
 * (6 AM cron + 12 PM / 6 PM / 9:30 PM Cowork) without needing Vercel Pro.
 *
 * Auth: Cron secret (Cowork tasks call this via x-cron-secret header).
 */

import { NextRequest, NextResponse } from "next/server";
import { publishQueuedPosts, expireStaleDrafts } from "@/lib/creator/jobs";
import { syncMediaFromDrive } from "@/lib/creator/media-ingest";
import { analyzeMedia, generateEditPlans } from "@/lib/creator/director";
import { processPendingPlans } from "@/lib/creator/editor/executor";
import { logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get("x-cron-secret");
  const userId = process.env.CREATOR_USER_ID ?? "";

  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!userId) {
    return NextResponse.json({ error: "Missing CREATOR_USER_ID" }, { status: 400 });
  }

  const results: Record<string, unknown> = { source: "cowork" };

  try {
    // Expire stale drafts before selecting
    const expireResult = await expireStaleDrafts(userId);
    results.expired = expireResult.expired;

    // Publish with cowork source — backfill cap applies
    const publishResult = await publishQueuedPosts(userId, { source: "cowork" });
    results.publish = publishResult;
  } catch (error) {
    logError("cowork.publish", error);
    results.publish = { error: error instanceof Error ? error.message : "Publish failed" };
  }

  // --- AI Editor pipeline (piggybacks on Cowork scheduled tasks) ---

  try {
    const mediaSyncResult = await syncMediaFromDrive(userId);
    results.media_sync = mediaSyncResult;
  } catch (error) {
    logError("cowork.media-sync", error);
    results.media_sync = { error: "Media sync failed" };
  }

  try {
    const analyzeResult = await analyzeMedia(userId);
    results.media_analysis = analyzeResult;
  } catch (error) {
    logError("cowork.media-analysis", error);
    results.media_analysis = { error: "Analysis failed" };
  }

  try {
    const planResult = await generateEditPlans(userId);
    results.edit_plans = planResult;
  } catch (error) {
    logError("cowork.edit-plans", error);
    results.edit_plans = { error: "Planning failed" };
  }

  try {
    const execResult = await processPendingPlans(userId);
    results.edit_execution = execResult;
  } catch (error) {
    logError("cowork.edit-execution", error);
    results.edit_execution = { error: "Execution failed" };
  }

  return NextResponse.json(results);
}
