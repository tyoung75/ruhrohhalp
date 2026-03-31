/**
 * Shared Google OAuth callback.
 *
 * Supported flows:
 *   1. Google Drive integration → exchanges tokens and stores them in platform_tokens
 *   2. Gmail refresh token minting → exchanges tokens and renders a one-time copy page
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type GoogleOauthState = {
  userId?: string;
  ts?: number;
  purpose?: "google_drive" | "gmail_refresh_token";
};

function parseState(rawState: string | null): GoogleOauthState | null {
  if (!rawState) return null;

  try {
    const decoded = Buffer.from(rawState, "base64url").toString("utf8");
    return JSON.parse(decoded) as GoogleOauthState;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderGmailTokenPage(params: {
  refreshToken: string | null;
  appUrl: string;
  reason?: string;
}) {
  const { refreshToken, appUrl, reason } = params;
  const safeToken = refreshToken ? escapeHtml(refreshToken) : "";
  const safeReason = reason ? escapeHtml(reason) : "";

  const body = refreshToken
    ? `
      <div class="token-wrap">
        <div class="label">GOOGLE_REFRESH_TOKEN</div>
        <pre id="token">${safeToken}</pre>
        <button id="copy">Copy token</button>
      </div>
      <ol>
        <li>Add this value to the <code>ruhrohhalp</code> Vercel project as <code>GOOGLE_REFRESH_TOKEN</code>.</li>
        <li>Redeploy or re-run the workflow after Vercel picks up the new env var.</li>
        <li>Run <code>Blog Weekly Dev Log</code>, not <code>Blog Publish Watcher</code>, to create the draft.</li>
      </ol>
      <p class="note">This token is shown once here and is not stored by this flow.</p>
    `
    : `
      <div class="error">Google did not return a refresh token.</div>
      <p>${safeReason || "This usually means Google reused an existing grant without issuing a new offline token."}</p>
      <ol>
        <li>Open <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google Account Permissions</a>.</li>
        <li>Remove this app’s existing Google access.</li>
        <li>Start the Gmail token flow again and approve the consent screen.</li>
      </ol>
    `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gmail Refresh Token</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b0f12;
        --card: #141a20;
        --border: #2a333d;
        --text: #ecf2f8;
        --muted: #9aa9b8;
        --accent: #6ee7b7;
        --error: #fca5a5;
      }
      body {
        margin: 0;
        background: radial-gradient(circle at top, #15202a 0, var(--bg) 55%);
        color: var(--text);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 760px;
        margin: 48px auto;
        padding: 0 20px;
      }
      .card {
        background: rgba(20, 26, 32, 0.94);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 24px;
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.28);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      p, li {
        color: var(--muted);
        line-height: 1.6;
      }
      .token-wrap {
        margin: 24px 0;
      }
      .label {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 10px;
      }
      pre {
        margin: 0;
        padding: 16px;
        border-radius: 10px;
        border: 1px solid var(--border);
        background: #0d1318;
        color: var(--text);
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      button, a.back {
        margin-top: 14px;
        display: inline-block;
        background: transparent;
        color: var(--accent);
        border: 1px solid rgba(110, 231, 183, 0.4);
        border-radius: 8px;
        padding: 10px 14px;
        font: inherit;
        text-decoration: none;
        cursor: pointer;
      }
      .error {
        color: var(--error);
        font-weight: 600;
      }
      .note {
        font-size: 13px;
      }
      code {
        color: var(--text);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>Gmail OAuth Complete</h1>
        <p>This flow uses your existing Google client to mint the refresh token needed by the weekly dev-log Gmail draft pipeline.</p>
        ${body}
        <a class="back" href="${escapeHtml(`${appUrl}/settings/integrations`)}">Back to Integrations</a>
      </div>
    </main>
    <script>
      const btn = document.getElementById("copy");
      if (btn) {
        btn.addEventListener("click", async () => {
          const token = document.getElementById("token")?.textContent || "";
          if (!token) return;
          try {
            await navigator.clipboard.writeText(token);
            btn.textContent = "Copied";
          } catch {
            btn.textContent = "Copy failed";
          }
        });
      }
    </script>
  </body>
</html>`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = parseState(searchParams.get("state"));

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

    if (state?.userId && state.userId !== user.id) {
      return NextResponse.redirect(
        new URL("/settings/integrations?error=invalid_state", request.url)
      );
    }

    const clientId =
      process.env.GOOGLE_CLIENT_ID ?? process.env.YOUTUBE_CLIENT_ID;
    const clientSecret =
      process.env.GOOGLE_CLIENT_SECRET ?? process.env.YOUTUBE_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-drive/callback`;
    const purpose = state?.purpose ?? "google_drive";

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

    if (purpose === "gmail_refresh_token") {
      return new NextResponse(
        renderGmailTokenPage({
          refreshToken: refreshToken ?? null,
          appUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin,
          reason: refreshToken
            ? undefined
            : "Retry after revoking the app in your Google account if Google keeps omitting the offline token.",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        }
      );
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
