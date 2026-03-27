/**
 * GET  /api/creator/followers — Returns follower summary with deltas, KPIs, sparklines.
 * POST /api/creator/followers — Triggers ad-hoc follower snapshot from all connected platforms.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getFollowerSummary, snapshotFollowerCounts } from "@/lib/creator/followers";
import { limitByKey } from "@/lib/security/rate-limit";

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

export async function POST() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  // Rate limit: 5 snapshots per hour
  const { ok } = limitByKey(`creator-followers-refresh:${user.id}`, 5, 60 * 60 * 1000);
  if (!ok) {
    return NextResponse.json(
      { error: "Rate limited. Max 5 follower refreshes per hour." },
      { status: 429 }
    );
  }

  try {
    const result = await snapshotFollowerCounts(user.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[creator-followers] Snapshot error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Follower snapshot failed" },
      { status: 500 }
    );
  }
}
