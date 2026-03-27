/**
 * OAuth callback for YouTube / Google API.
 * Exchanges auth code for access + refresh tokens and stores in platform_tokens.
 *
 * Google OAuth flow:
 *   1. User visits: https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&scope=...&response_type=code&access_type=offline&prompt=consent
 *   2. Google redirects here with ?code=... after user approves
 *   3. We exchange the code for tokens and store them
 *
 * IMPORTANT: access_type=offline + prompt=consent are required to get a refresh_token.
 * Without these, Google only returns an access_token that expires in 1 hour.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlatformAdapter } from "@/lib/creator/platforms";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    console.error("[youtube-oauth] Denied:", error);
    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=${encodeURIComponent(error)}`,
        request.url
      )
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=missing_code", request.url)
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const adapter = getPlatformAdapter("youtube");
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/youtube/callback`;

    const tokenData = await adapter.exchangeCodeForToken(code, redirectUri);

    // Google access tokens expire in 1 hour; refresh tokens are long-lived.
    const expiresAt = tokenData.expiresIn
      ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
      : null;

    const { error: upsertError } = await supabase
      .from("platform_tokens")
      .upsert(
        {
          user_id: user.id,
          platform: "youtube",
          access_token: tokenData.accessToken,
          token_type: tokenData.tokenType,
          expires_at: expiresAt,
          platform_user_id: tokenData.userId,
          platform_username: tokenData.username ?? null,
          scopes: [
            "https://www.googleapis.com/auth/youtube.readonly",
            "https://www.googleapis.com/auth/yt-analytics.readonly",
          ],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform" }
      );

    if (upsertError) {
      console.error("[youtube-oauth] DB upsert error:", upsertError);
      return NextResponse.redirect(
        new URL("/settings/integrations?error=db_error", request.url)
      );
    }

    return NextResponse.redirect(
      new URL(
        `/settings/integrations?success=youtube&username=${encodeURIComponent(tokenData.username ?? "")}`,
        request.url
      )
    );
  } catch (err) {
    console.error("[youtube-oauth] Token exchange error:", err);
    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`,
        request.url
      )
    );
  }
}
