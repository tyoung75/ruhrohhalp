/**
 * Manual Editor Pipeline Trigger — POST /api/creator/editor-run
 *
 * One-click button in the Creator tab that runs the full AI Editor pipeline:
 * media sync → vision analysis → edit planning → execution.
 *
 * Useful when Tyler dumps photos into Google Drive and wants them processed
 * immediately rather than waiting for the next Cowork scheduled task.
 *
 * Accepts optional body:
 * - { step: "sync" }     — only sync media from Drive
 * - { step: "analyze" }  — only run vision analysis on new assets
 * - { step: "plan" }     — only generate edit plans
 * - { step: "execute" }  — only execute pending plans
 * - { } or no body       — run the full pipeline
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { syncMediaFromDrive } from "@/lib/creator/media-ingest";
import { analyzeMedia, generateEditPlans } from "@/lib/creator/director";
import { processPendingPlans } from "@/lib/creator/editor/executor";
import { logInfo, logError } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await request.json().catch(() => ({}));
  const step = (body as Record<string, unknown>).step as string | undefined;

  const results: Record<string, unknown> = {
    source: "manual",
    triggered_at: new Date().toISOString(),
  };

  // Step 1: Media sync
  if (!step || step === "sync") {
    try {
      const syncResult = await syncMediaFromDrive(user.id);
      results.media_sync = syncResult;
      logInfo("editor-run.sync", syncResult);
    } catch (error) {
      logError("editor-run.sync", error);
      results.media_sync = { error: error instanceof Error ? error.message : "Sync failed" };
    }
  }

  // Step 2: Vision analysis
  if (!step || step === "analyze") {
    try {
      const analyzeResult = await analyzeMedia(user.id);
      results.media_analysis = analyzeResult;
      logInfo("editor-run.analyze", analyzeResult);
    } catch (error) {
      logError("editor-run.analyze", error);
      results.media_analysis = { error: error instanceof Error ? error.message : "Analysis failed" };
    }
  }

  // Step 3: Edit planning
  if (!step || step === "plan") {
    try {
      const planResult = await generateEditPlans(user.id);
      results.edit_plans = planResult;
      logInfo("editor-run.plan", planResult);
    } catch (error) {
      logError("editor-run.plan", error);
      results.edit_plans = { error: error instanceof Error ? error.message : "Planning failed" };
    }
  }

  // Step 4: Execution
  if (!step || step === "execute") {
    try {
      const execResult = await processPendingPlans(user.id);
      results.edit_execution = execResult;
      logInfo("editor-run.execute", execResult);
    } catch (error) {
      logError("editor-run.execute", error);
      results.edit_execution = { error: error instanceof Error ? error.message : "Execution failed" };
    }
  }

  return NextResponse.json({ success: true, ...results });
}
