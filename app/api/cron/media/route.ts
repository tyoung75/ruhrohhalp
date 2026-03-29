/**
 * /api/cron/media — AI Editor Pipeline
 *
 * Handles the media processing pipeline:
 *  1. Sync media from Google Drive
 *  2. Analyze new media via Gemini Vision
 *  3. Generate edit plans from analyzed media + strategy
 *  4. Execute pending edit plans (photo/video editing)
 *
 * This is a sequential pipeline — each step depends on the previous.
 * Split from unified /api/cron to stay within Vercel Hobby 60s limit.
 */

import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { syncMediaFromDrive } from "@/lib/creator/media-ingest";
import { analyzeMedia, generateEditPlans } from "@/lib/creator/director";
import { processPendingPlans } from "@/lib/creator/editor/executor";

export const maxDuration = 60;

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

function checkAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (authHeader !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

export async function GET(request: NextRequest) {
  const authError = checkAuth(request);
  if (authError) return authError;

  const results: Record<string, unknown> = { ok: true, timestamp: new Date().toISOString() };

  // Sequential pipeline — each step feeds the next
  try {
    const mediaSyncResult = await syncMediaFromDrive(TYLER_USER_ID);
    results.media_sync = mediaSyncResult;
  } catch (error) {
    logError("cron.media-sync", error);
    results.media_sync = { error: "Media sync failed" };
  }

  try {
    const analyzeResult = await analyzeMedia(TYLER_USER_ID);
    results.media_analysis = analyzeResult;
  } catch (error) {
    logError("cron.media-analysis", error);
    results.media_analysis = { error: "Media analysis failed" };
  }

  try {
    const planResult = await generateEditPlans(TYLER_USER_ID);
    results.edit_plans = planResult;
  } catch (error) {
    logError("cron.edit-plans", error);
    results.edit_plans = { error: "Edit plan generation failed" };
  }

  try {
    const execResult = await processPendingPlans(TYLER_USER_ID);
    results.edit_execution = execResult;
  } catch (error) {
    logError("cron.edit-execution", error);
    results.edit_execution = { error: "Edit execution failed" };
  }

  return NextResponse.json(results);
}
