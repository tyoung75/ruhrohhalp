/**
 * OAuth callback for Instagram API (Instagram Login flow).
 * Exchanges auth code for long-lived token and stores in platform_tokens.
 *
 * Uses the Instagram API OAuth flow (not legacy Facebook Login).
 * Token exchange: api.instagram.com → short-lived → ig_exchange_token → long-lived.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlatformAdapter } from "@/lib/creator/platforms";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorReason = searchParams.get("error_reason") ?? searchParams.get("error_description");

  if (error) {
    console.error("[instagram-oauth] Denied:", error, errorReason);
    return NextResponse.redirect(
      new URL(`/settings/integrations?error=${encodeURIComponent(errorReason ?? error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=missing_code", request.url)
    );
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const adapter = getPlatformAdapter("instagram");
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/instagram/callback`;

    const tokenData = await adapter.exchangeCodeForToken(code, redirectUri);

    // Calculate expiry (long-lived tokens last ~60 days)
    const expiresAt = tokenData.expiresIn
      ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
      : null;

    // Upsert the token (replace if platform already connected)
    const { error: upsertError } = await supabase
      .from("platform_tokens")
      .upsert(
        {
          user_id: user.id,
          platform: "instagram",
          access_token: tokenData.accessToken,
          token_type: tokenData.tokenType,
          expires_at: expiresAt,
          platform_user_id: tokenData.userId,
          scopes: [
            "instagram_business_basic",
            "instagram_business_content_publish",
            "instagram_business_manage_insights",
            "instagram_business_manage_comments",
          ],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform" }
      );

    if (upsertError) {
      console.error("[instagram-oauth] DB upsert error:", upsertError);
      return NextResponse.redirect(
        new URL("/settings/integrations?error=db_error", request.url)
      );
    }

    return NextResponse.redirect(
      new URL(
        `/settings/integrations?success=instagram`,
        request.url
      )
    );
  } catch (err) {
    console.error("[instagram-oauth] Token exchange error:", err);
    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`,
        request.url
      )
    );
  }
}
