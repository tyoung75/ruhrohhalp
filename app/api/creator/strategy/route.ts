/**
 * Strategy API — GET /api/creator/strategy
 *
 * Returns the current social media strategy: active insights,
 * content recommendations, velocity targets, and trend signals.
 *
 * POST /api/creator/strategy — Regenerate strategy (triggers full analysis)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getCurrentStrategy, generateStrategy, detectTrends } from "@/lib/creator/strategy";
import { limitByKey } from "@/lib/security/rate-limit";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    const strategy = await getCurrentStrategy();
    return NextResponse.json(strategy);
  } catch (error) {
    console.error("[creator-strategy] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch strategy" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  // Rate limit: 3 strategy regenerations per hour
  const { ok } = limitByKey(`creator-strategy:${user.id}`, 3, 60 * 60 * 1000);
  if (!ok) {
    return NextResponse.json(
      { error: "Rate limited. Max 3 strategy regenerations per hour." },
      { status: 429 }
    );
  }

  try {
    // Detect trends first, then generate strategy
    const trendResult = await detectTrends();
    const strategy = await generateStrategy();

    return NextResponse.json({
      success: true,
      trendsDetected: trendResult.detected,
      recommendations: strategy.recommendations.length,
      insights: strategy.insights.length,
      shifts: strategy.weeklyShifts,
    });
  } catch (error) {
    console.error("[creator-strategy] Generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Strategy generation failed" },
      { status: 500 }
    );
  }
}
