/**
 * Google Drive OAuth initiation — redirects user to Google's consent screen.
 *
 * GET /api/auth/google-drive → redirects to Google OAuth consent
 *
 * Required scope: drive.readonly — list and download files from Drive
 *
 * Uses the same Google Cloud OAuth client as YouTube (GOOGLE_CLIENT_ID).
 * access_type=offline + prompt=consent ensures we get a refresh_token.
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
    process.env.GOOGLE_CLIENT_ID ?? process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=google_drive_not_configured",
        request.url
      )
    );
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-drive/callback`;
  const scopes = [
    "https://www.googleapis.com/auth/drive.readonly",
  ].join(" ");

  const state = Buffer.from(
    JSON.stringify({ userId: user.id, ts: Date.now() })
  ).toString("base64url");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
