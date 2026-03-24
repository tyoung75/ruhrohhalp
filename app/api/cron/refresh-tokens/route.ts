/**
 * Cron: Token Refresh — runs daily via Vercel Cron.
 *
 * Checks platform_tokens for tokens expiring within 7 days and refreshes them.
 * This prevents the posting pipeline from silently dying when tokens expire.
 *
 * Auth: Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdapter } from "@/lib/creator/platforms";
import { logError } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const sevenDaysFromNow = new Date(Date.now() + 7 * 86400000).toISOString();

  try {
    // Find tokens expiring within 7 days
    const { data: expiringTokens, error } = await supabase
      .from("platform_tokens")
      .select("id, user_id, platform, access_token, expires_at")
      .not("expires_at", "is", null)
      .lt("expires_at", sevenDaysFromNow)
      .order("expires_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch expiring tokens: ${error.message}`);
    }

    if (!expiringTokens?.length) {
      return NextResponse.json({ ok: true, message: "No tokens need refresh", refreshed: 0 });
    }

    let refreshed = 0;
    let failed = 0;
    const results: Array<{ platform: string; status: string; expiresAt?: string }> = [];

    for (const token of expiringTokens) {
      try {
        const adapter = getPlatformAdapter(token.platform as string);
        const refreshResult = await adapter.refreshLongLivedToken(token.access_token as string);

        // Calculate new expiry
        const newExpiresAt = refreshResult.expiresIn
          ? new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString()
          : null;

        // Update the token in the database
        const { error: updateError } = await supabase
          .from("platform_tokens")
          .update({
            access_token: refreshResult.accessToken,
            token_type: refreshResult.tokenType,
            expires_at: newExpiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", token.id);

        if (updateError) {
          throw new Error(`DB update failed: ${updateError.message}`);
        }

        refreshed++;
        results.push({
          platform: token.platform as string,
          status: "refreshed",
          expiresAt: newExpiresAt ?? undefined,
        });
      } catch (err) {
        failed++;
        logError("cron.refresh-tokens", err, {
          tokenId: token.id,
          platform: token.platform,
        });
        results.push({
          platform: token.platform as string,
          status: `failed: ${err instanceof Error ? err.message : "unknown"}`,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      refreshed,
      failed,
      results,
    });
  } catch (error) {
    logError("cron.refresh-tokens", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Token refresh failed" },
      { status: 500 }
    );
  }
}
