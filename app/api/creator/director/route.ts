/**
 * Director API — POST /api/creator/director
 *
 * Runs the Director Brain:
 * 1. Analyzes unprocessed media via Gemini Vision
 * 2. Generates edit plans based on strategy + available assets
 *
 * Called by:
 * - Vercel cron (daily 5:30 AM ET) via /api/cron
 * - Manual trigger from Creator UI
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { analyzeMedia, generateEditPlans } from "@/lib/creator/director";
import { logInfo } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await request.json().catch(() => ({}));
  const step = (body as Record<string, unknown>).step as string | undefined;

  try {
    const results: Record<string, unknown> = {};

    // Step 1: Vision analysis (or run both if no step specified)
    if (!step || step === "analyze") {
      const analyzeResult = await analyzeMedia(user.id);
      results.analysis = analyzeResult;
      logInfo("director-api.analyze", analyzeResult);
    }

    // Step 2: Generate edit plans
    if (!step || step === "plan") {
      const planResult = await generateEditPlans(user.id);
      results.plans = planResult;
      logInfo("director-api.plan", planResult);
    }

    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Director failed" },
      { status: 500 }
    );
  }
}
