/**
 * Instagram OAuth initiation — redirects user to Instagram's authorization screen.
 *
 * Usage: GET /api/auth/instagram → redirects to Instagram OAuth consent
 *
 * Uses the Instagram API (not the legacy Facebook Login flow).
 * The Instagram app ID is separate from the Meta parent app ID.
 *
 * Required permissions (instagram_business_* scopes):
 *   instagram_business_basic              — read profile info and media
 *   instagram_business_content_publish    — publish images, carousels, reels
 *   instagram_business_manage_insights    — read post/account analytics
 *   instagram_business_manage_comments    — read/manage comments
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

  // Use the Instagram-specific app ID (from the Instagram API use case in Meta Developer Portal)
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=instagram_not_configured", request.url)
    );
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/instagram/callback`;
  const scopes = [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
    "instagram_business_manage_comments",
  ].join(",");

  // CSRF protection: use state param with user ID hash
  const state = Buffer.from(
    JSON.stringify({ userId: user.id, ts: Date.now() })
  ).toString("base64url");

  // Instagram API uses its own OAuth endpoint (not facebook.com/dialog/oauth)
  const authUrl = new URL("https://www.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
