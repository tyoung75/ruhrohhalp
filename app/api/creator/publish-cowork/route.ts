/**
 * Cowork-triggered publish — POST /api/creator/publish-cowork
 *
 * Called by GitHub Actions (and Cowork tasks) to publish queued Threads posts
 * at optimal times. Only Threads posts are auto-published; other platforms
 * remain in draft for manual review.
 *
 * Also runs the AI Editor pipeline (media sync → analyze → plan → execute)
 * so new photos/videos get picked up throughout the day — not just at the
 * 6 AM daily cron. This effectively gives us 4 editor runs per day
 * (6 AM cron + 12 PM / 6 PM / 9:30 PM Cowork) without needing Vercel Pro.
 *
 * Auth: Accepts both x-cron-secret header (Cowork) and Authorization: Bearer (GitHub Actions).
 */

import { NextRequest, NextResponse } from "next/server";
import { publishQueuedPosts, expireStaleDrafts } from "@/lib/creator/jobs";
import { logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  // Accept both auth methods: x-cron-secret (Cowork) or Authorization Bearer (GitHub Actions)
  const cronSecret = request.headers.get("x-cron-secret");
  const authHeader = request.headers.get("Authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");
  const expectedSecret = process.env.CRON_SECRET;

  const isAuthed =
    (cronSecret && cronSecret === expectedSecret) ||
    (bearerToken && bearerToken === expectedSecret);

  if (!isAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = process.env.CREATOR_USER_ID ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Missing CREATOR_USER_ID" }, { status: 400 });
  }

  const results: Record<string, unknown> = { source: "cowork" };

  try {
    // Expire stale drafts before selecting
    const expireResult = await expireStaleDrafts(userId);
    results.expired = expireResult.expired;

    // Publish with cowork source — backfill cap applies
    // Only Threads posts are auto-published; other platforms stay as drafts
    const publishResult = await publishQueuedPosts(userId, {
      source: "cowork",
      platformFilter: "threads",
    });
    results.publish = publishResult;
  } catch (error) {
    logError("cowork.publish", error);
    results.publish = { error: error instanceof Error ? error.message : "Publish failed" };
  }

  // --- AI Editor pipeline (piggybacks on Cowork scheduled tasks) ---
  // Lazy-import editor modules to prevent cold-start crashes if they have
  // missing deps. Each step is independently try/caught so one failure
  // doesn't block publishing.

  try {
    const { syncMediaFromDrive } = await import("@/lib/creator/media-ingest");
    const mediaSyncResult = await syncMediaFromDrive(userId);
    results.media_sync = mediaSyncResult;
  } catch (error) {
    logError("cowork.media-sync", error);
    results.media_sync = { error: error instanceof Error ? error.message : "Media sync failed" };
  }

  try {
    const { analyzeMedia } = await import("@/lib/creator/director");
    const analyzeResult = await analyzeMedia(userId);
    results.media_analysis = analyzeResult;
  } catch (error) {
    logError("cowork.media-analysis", error);
    results.media_analysis = { error: error instanceof Error ? error.message : "Analysis failed" };
  }

  try {
    const { generateEditPlans } = await import("@/lib/creator/director");
    const planResult = await generateEditPlans(userId);
    results.edit_plans = planResult;
  } catch (error) {
    logError("cowork.edit-plans", error);
    results.edit_plans = { error: error instanceof Error ? error.message : "Planning failed" };
  }

  try {
    const { processPendingPlans } = await import("@/lib/creator/editor/executor");
    const execResult = await processPendingPlans(userId);
    results.edit_execution = execResult;
  } catch (error) {
    logError("cowork.edit-execution", error);
    results.edit_execution = { error: error instanceof Error ? error.message : "Execution failed" };
  }

  return NextResponse.json(results);
}
