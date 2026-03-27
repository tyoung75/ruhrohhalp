/**
 * OAuth callback for TikTok API.
 * Exchanges auth code for access token and stores in platform_tokens.
 *
 * TikTok OAuth flow:
 *   1. User visits: https://www.tiktok.com/v2/auth/authorize/?client_key=...&scope=...&redirect_uri=...&response_type=code
 *   2. TikTok redirects here with ?code=... after user approves
 *   3. We exchange the code for tokens and store them
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlatformAdapter } from "@/lib/creator/platforms";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    console.error("[tiktok-oauth] Denied:", error, errorDescription);
    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=${encodeURIComponent(errorDescription ?? error)}`,
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

    const adapter = getPlatformAdapter("tiktok");
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/tiktok/callback`;

    const tokenData = await adapter.exchangeCodeForToken(code, redirectUri);

    // TikTok access tokens expire in ~24h; refresh tokens last ~365 days.
    const expiresAt = tokenData.expiresIn
      ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
      : null;

    const { error: upsertError } = await supabase
      .from("platform_tokens")
      .upsert(
        {
          user_id: user.id,
          platform: "tiktok",
          access_token: tokenData.accessToken,
          token_type: tokenData.tokenType,
          expires_at: expiresAt,
          platform_user_id: tokenData.userId,
          platform_username: tokenData.username ?? null,
          scopes: [
            "user.info.basic",
            "user.info.stats",
            "video.list",
            "video.insights",
          ],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform" }
      );

    if (upsertError) {
      console.error("[tiktok-oauth] DB upsert error:", upsertError);
      return NextResponse.redirect(
        new URL("/settings/integrations?error=db_error", request.url)
      );
    }

    return NextResponse.redirect(
      new URL(
        `/settings/integrations?success=tiktok&username=${encodeURIComponent(tokenData.username ?? "")}`,
        request.url
      )
    );
  } catch (err) {
    console.error("[tiktok-oauth] Token exchange error:", err);
    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`,
        request.url
      )
    );
  }
}
