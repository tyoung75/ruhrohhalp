/**
 * Threads OAuth initiation — redirects user to Threads authorization screen.
 *
 * Usage: GET /api/auth/threads → redirects to Threads OAuth consent
 *
 * Required scopes for Creator OS:
 *   threads_basic              — profile info, user ID
 *   threads_content_publish    — create and publish threads
 *   threads_delete             — delete posts
 *   threads_manage_insights    — read post/account analytics
 *   threads_manage_replies     — manage reply threads
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  // Verify the user is logged in
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const appId = process.env.THREADS_APP_ID;
  if (!appId) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=threads_not_configured", request.url)
    );
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/threads/callback`;
  const scopes = [
    "threads_basic",
    "threads_content_publish",
    "threads_delete",
    "threads_manage_insights",
    "threads_manage_replies",
  ].join(",");

  // CSRF protection: use state param with user ID hash
  const state = Buffer.from(
    JSON.stringify({ userId: user.id, ts: Date.now() })
  ).toString("base64url");

  const authUrl = new URL("https://threads.net/oauth/authorize");
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
