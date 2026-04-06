/**
 * Strava Webhook — GET + POST /api/webhook/strava
 *
 * Strava pushes activity events here in real-time after every completed workout.
 * Replaces the old daily cron-based polling approach.
 *
 * GET:  Webhook subscription validation (Strava sends a challenge on setup)
 * POST: Activity event handler (create/update/delete/deauthorize)
 *
 * Setup: Register this webhook via Strava API:
 *   POST https://www.strava.com/api/v3/push_subscriptions
 *     client_id=YOUR_ID
 *     client_secret=YOUR_SECRET
 *     callback_url=https://www.ruhrohhalp.com/api/webhook/strava
 *     verify_token=YOUR_VERIFY_TOKEN
 *
 * Env vars needed:
 *   STRAVA_VERIFY_TOKEN — shared secret for subscription validation
 *   STRAVA_CLIENT_ID — Strava app client ID
 *   STRAVA_CLIENT_SECRET — Strava app client secret
 */

import { NextRequest, NextResponse } from "next/server";
import { syncStravaActivities } from "@/lib/strava/sync";
import { getActivity } from "@/lib/strava/client";
import { generateWorkoutPost } from "@/lib/creator/workout-post";
import { logError } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET — Strava subscription validation challenge
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.STRAVA_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken && challenge) {
    // Strava expects a JSON response with the challenge echoed back
    return NextResponse.json({ "hub.challenge": challenge });
  }

  return NextResponse.json({ error: "Invalid verification" }, { status: 403 });
}

// ---------------------------------------------------------------------------
// POST — Strava event push (activity create/update/delete)
// ---------------------------------------------------------------------------

type StravaWebhookEvent = {
  object_type: "activity" | "athlete";
  object_id: number;
  aspect_type: "create" | "update" | "delete";
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  let event: StravaWebhookEvent;

  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // We only care about activity create/update events
  if (event.object_type !== "activity") {
    return NextResponse.json({ ok: true, skipped: true, reason: "not_activity" });
  }

  if (event.aspect_type === "delete") {
    // Could clean up the goal_signal, but not critical — skip for now
    return NextResponse.json({ ok: true, skipped: true, reason: "delete_event" });
  }

  // Strava sends the event immediately, but the activity details may not be
  // fully available yet. Small delay helps ensure data is ready.
  // For create/update: trigger a sync of recent activities (deduped by source_ref)
  try {
    const result = await syncStravaActivities();

    // After syncing, generate a Threads post for new activities
    let postResult: { queued: boolean; postId?: string; error?: string } | null = null;
    if (event.aspect_type === "create") {
      try {
        const activity = await getActivity(event.object_id);
        postResult = await generateWorkoutPost(activity);
      } catch (postErr) {
        logError("webhook.strava.post-gen", postErr);
        postResult = { queued: false, error: postErr instanceof Error ? postErr.message : "Post generation failed" };
      }
    }

    return NextResponse.json({
      ok: true,
      event_type: event.aspect_type,
      activity_id: event.object_id,
      sync: result,
      post: postResult,
    });
  } catch (error) {
    logError("webhook.strava", error);
    // Return 200 anyway — Strava will disable the subscription if we return
    // too many non-200s, and we don't want that
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Sync failed",
    });
  }
}
