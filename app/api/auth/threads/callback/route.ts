/**
 * OAuth callback for Threads API.
 * Exchanges auth code for long-lived token and stores in platform_tokens.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlatformAdapter } from "@/lib/creator/platforms";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorReason = searchParams.get("error_reason");

  if (error) {
    console.error("[threads-oauth] Denied:", error, errorReason);
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

    const adapter = getPlatformAdapter("threads");
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/threads/callback`;

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
          platform: "threads",
          access_token: tokenData.accessToken,
          token_type: tokenData.tokenType,
          expires_at: expiresAt,
          platform_user_id: tokenData.userId,
          platform_username: tokenData.username,
          scopes: [
            "threads_basic",
            "threads_content_publish",
            "threads_delete",
            "threads_manage_insights",
            "threads_manage_replies",
          ],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform" }
      );

    if (upsertError) {
      console.error("[threads-oauth] DB upsert error:", upsertError);
      return NextResponse.redirect(
        new URL("/settings/integrations?error=db_error", request.url)
      );
    }

    return NextResponse.redirect(
      new URL(
        `/settings/integrations?success=threads&username=${encodeURIComponent(tokenData.username ?? "")}`,
        request.url
      )
    );
  } catch (err) {
    console.error("[threads-oauth] Token exchange error:", err);
    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`,
        request.url
      )
    );
  }
}
