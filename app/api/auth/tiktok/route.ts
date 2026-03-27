/**
 * TikTok OAuth initiation — redirects user to TikTok's authorization screen.
 *
 * Usage: GET /api/auth/tiktok → redirects to TikTok OAuth consent
 *
 * Required scopes for Creator OS:
 *   user.info.basic    — display_name, avatar
 *   user.info.stats    — follower_count, following_count, likes_count, video_count
 *   video.list         — list user videos
 *   video.insights     — view_count, like_count, comment_count, share_count per video
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

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=tiktok_not_configured", request.url)
    );
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/tiktok/callback`;
  const scopes = [
    "user.info.basic",
    "user.info.stats",
    "video.list",
    "video.insights",
  ].join(",");

  // CSRF protection: use state param with user ID hash
  const state = Buffer.from(
    JSON.stringify({ userId: user.id, ts: Date.now() })
  ).toString("base64url");

  const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authUrl.searchParams.set("client_key", clientKey);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
