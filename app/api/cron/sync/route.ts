/**
 * /api/cron/sync — Creator OS Sync & Analytics
 *
 * Handles all platform sync, publishing, analytics, and token maintenance:
 *  - Sync external posts (manual posts from Threads app etc.)
 *  - Expire stale drafts
 *  - Publish queued posts
 *  - Collect post analytics + extended analytics
 *  - Strava activity sync
 *  - Follower count snapshots
 *  - Refresh expiring tokens
 *
 * Split from unified /api/cron to stay within Vercel Hobby 60s limit.
 * Independent tasks run in parallel for speed.
 */

import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { publishQueuedPosts, syncExternalPosts, collectAnalytics, collectExtendedAnalytics, refreshExpiringTokens, expireStaleDrafts } from "@/lib/creator/jobs";
import { syncStravaActivities } from "@/lib/strava/sync";
import { snapshotFollowerCounts } from "@/lib/creator/followers";

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

  // Phase 1: Sync external posts + expire stale drafts (must happen before publish)
  const [syncResult, expireResult] = await Promise.allSettled([
    syncExternalPosts(TYLER_USER_ID),
    expireStaleDrafts(TYLER_USER_ID),
  ]);

  results.creator_sync = syncResult.status === "fulfilled"
    ? syncResult.value
    : (() => { logError("cron.creator-sync", syncResult.reason); return { error: "Sync failed" }; })();

  results.creator_expire = expireResult.status === "fulfilled"
    ? expireResult.value
    : (() => { logError("cron.creator-expire", expireResult.reason); return { error: "Expire failed" }; })();

  // Phase 2: Publish queued posts (depends on sync + expire completing)
  try {
    const publishResult = await publishQueuedPosts(TYLER_USER_ID, { source: "cron" });
    results.creator_publish = publishResult;
  } catch (error) {
    logError("cron.creator-publish", error);
    results.creator_publish = { error: "Publish failed" };
  }

  // Phase 3: All remaining tasks can run in parallel (independent of each other)
  const [analyticsRes, extendedRes, stravaRes, followerRes, tokenRes] = await Promise.allSettled([
    collectAnalytics(TYLER_USER_ID),
    collectExtendedAnalytics(TYLER_USER_ID),
    syncStravaActivities(),
    snapshotFollowerCounts(TYLER_USER_ID),
    refreshExpiringTokens(),
  ]);

  results.creator_analytics = analyticsRes.status === "fulfilled"
    ? analyticsRes.value
    : (() => { logError("cron.creator-analytics", analyticsRes.reason); return { error: "Analytics failed" }; })();

  results.extended_analytics = extendedRes.status === "fulfilled"
    ? extendedRes.value
    : (() => { logError("cron.extended-analytics", extendedRes.reason); return { error: "Extended analytics failed" }; })();

  results.strava_sync = stravaRes.status === "fulfilled"
    ? stravaRes.value
    : (() => { logError("cron.strava-sync", stravaRes.reason); return { error: "Strava sync failed" }; })();

  results.follower_snapshot = followerRes.status === "fulfilled"
    ? followerRes.value
    : (() => { logError("cron.follower-snapshot", followerRes.reason); return { error: "Follower snapshot failed" }; })();

  results.token_refresh = tokenRes.status === "fulfilled"
    ? tokenRes.value
    : (() => { logError("cron.token-refresh", tokenRes.reason); return { error: "Token refresh failed" }; })();

  return NextResponse.json(results);
}
