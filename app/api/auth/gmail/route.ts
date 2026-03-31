/**
 * Gmail OAuth initiation for the weekly dev-log pipeline.
 *
 * This flow is only used to mint a long-lived GOOGLE_REFRESH_TOKEN that can be
 * copied into Vercel for server-side Gmail draft automation.
 *
 * It intentionally reuses the existing Google Drive callback URI so the same
 * Google OAuth client configuration can handle this flow without another
 * redirect URI registration step.
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

  const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=gmail_not_configured", request.url),
    );
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-drive/callback`;
  const scopes = [
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.readonly",
  ].join(" ");

  const state = Buffer.from(
    JSON.stringify({
      userId: user.id,
      ts: Date.now(),
      purpose: "gmail_refresh_token",
    }),
  ).toString("base64url");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
