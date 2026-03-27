/**
 * OAuth callback for Google Drive.
 * Exchanges auth code for access + refresh tokens and stores in platform_tokens.
 *
 * Flow:
 *   1. User visits /api/auth/google-drive → Google consent screen
 *   2. Google redirects here with ?code=...
 *   3. We exchange code for tokens and upsert into platform_tokens
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    console.error("[google-drive-oauth] Denied:", error);
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

    const clientId =
      process.env.GOOGLE_CLIENT_ID ?? process.env.YOUTUBE_CLIENT_ID;
    const clientSecret =
      process.env.GOOGLE_CLIENT_SECRET ?? process.env.YOUTUBE_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-drive/callback`;

    if (!clientId || !clientSecret) {
      throw new Error("Google OAuth credentials not configured");
    }

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("[google-drive-oauth] Token exchange failed:", errBody);
      throw new Error(`Token exchange failed: ${tokenRes.status}`);
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in; // seconds

    if (!accessToken) {
      throw new Error("No access_token in response");
    }

    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    // Upsert into platform_tokens
    const { error: upsertError } = await supabase
      .from("platform_tokens")
      .upsert(
        {
          user_id: user.id,
          platform: "google_drive",
          access_token: accessToken,
          refresh_token: refreshToken ?? null,
          token_type: tokens.token_type ?? "Bearer",
          expires_at: expiresAt,
          scopes: ["https://www.googleapis.com/auth/drive.readonly"],
          token_data: {
            scope: tokens.scope,
            token_type: tokens.token_type,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,platform" }
      );

    if (upsertError) {
      console.error("[google-drive-oauth] DB upsert error:", upsertError);
      return NextResponse.redirect(
        new URL("/settings/integrations?error=db_error", request.url)
      );
    }

    // Also seed the media_sync_state with the configured folder ID
    const folderId = process.env.GOOGLE_DRIVE_MEDIA_FOLDER_ID;
    if (folderId) {
      await supabase.from("media_sync_state").upsert(
        {
          user_id: user.id,
          source: "google_drive",
          folder_id: folderId,
        },
        { onConflict: "user_id,source" }
      );
    }

    return NextResponse.redirect(
      new URL(
        "/settings/integrations?success=google_drive",
        request.url
      )
    );
  } catch (err) {
    console.error("[google-drive-oauth] Error:", err);
    return NextResponse.redirect(
      new URL(
        `/settings/integrations?error=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`,
        request.url
      )
    );
  }
}
