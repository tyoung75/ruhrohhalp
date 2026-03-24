/**
 * GET /api/creator/followers
 *
 * Returns follower summary: total, per-platform with deltas and KPIs,
 * plus sparkline data for charting.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getFollowerSummary } from "@/lib/creator/followers";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    const summary = await getFollowerSummary(user.id);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[creator-followers] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch followers" },
      { status: 500 }
    );
  }
}
