/**
 * YouTube / Google OAuth initiation — redirects user to Google's consent screen.
 *
 * Usage: GET /api/auth/youtube → redirects to Google OAuth consent
 *
 * Required scopes for Creator OS:
 *   youtube.readonly       — channel info, video list, video stats
 *   yt-analytics.readonly  — YouTube Analytics API (audience demographics, traffic sources, revenue)
 *
 * IMPORTANT: access_type=offline + prompt=consent ensures we get a refresh_token.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const clientId =
    process.env.YOUTUBE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=youtube_not_configured",
        request.url
      )
    );
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/youtube/callback`;
  const scopes = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ].join(" ");

  const state = Buffer.from(
    JSON.stringify({ userId: user.id, ts: Date.now() })
  ).toString("base64url");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline"); // Required for refresh_token
  authUrl.searchParams.set("prompt", "consent"); // Force consent to always get refresh_token
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
