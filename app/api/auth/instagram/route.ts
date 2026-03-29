/**
 * Instagram OAuth initiation — redirects user to Facebook OAuth consent screen.
 *
 * Usage: GET /api/auth/instagram → redirects to Facebook OAuth consent
 *
 * Uses Facebook Login for Business (API setup with Facebook login path).
 * The parent Meta app ID is used as client_id, with redirect URIs
 * configured in Facebook Login for Business > Settings.
 *
 * Required permissions:
 *   instagram_basic              — read profile info
 *   instagram_content_publish — publish images, carousels, reels
 *   pages_read_engagement        — read page engagement metrics
 *   pages_show_list              — list connected Facebook pages
 *   business_management          — manage business assets
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

  // Use the parent Meta app ID (Facebook Login for Business)
  const appId = process.env.META_APP_ID ?? process.env.INSTAGRAM_APP_ID;
  if (!appId) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=instagram_not_configured", request.url)
    );
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/instagram/callback`;
  const scopes = [
    "instagram_basic",
    "instagram_content_publish",
    "pages_read_engagement",
    "pages_show_list",
    "business_management",
  ].join(",");

  // CSRF protection: use state param with user ID hash
  const state = Buffer.from(
    JSON.stringify({ userId: user.id, ts: Date.now() })
  ).toString("base64url");

  const authUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
