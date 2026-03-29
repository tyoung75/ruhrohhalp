/**
 * App Stats Collection — POST /api/internal/app-stats
 *
 * Triggers a stats refresh for all BDHE apps (Motus, Iron Passport).
 * Pulls the latest snapshot from the app_stats table and checks staleness.
 * If the latest snapshot is more than 24 hours old, creates an activity_log
 * entry flagging it so the briefing can remind Tyler to push fresh stats
 * (from App Store Connect or analytics dashboards).
 *
 * Note: App Store Connect data is pushed to /api/app-stats/[slug] by
 * external integrations (Shortcuts, fastlane, etc.). This endpoint just
 * monitors freshness and surfaces stale data in the briefing.
 *
 * Runs daily at 7 AM ET via GitHub Actions cron.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "@/lib/jobs/executor";

const APPS = ["motus", "ironpassport"] as const;

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const result = await runJob(
    "app-stats",
    async () => {
      const supabase = createAdminClient();
      const userId = process.env.CREATOR_USER_ID;

      if (!userId) throw new Error("CREATOR_USER_ID not configured");

      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const results: Record<string, unknown> = {};

      for (const app of APPS) {
        // Get latest stats snapshot
        const { data: latest } = await supabase
          .from("app_stats")
          .select("id, slug, updated_at, stats")
          .eq("slug", app)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!latest) {
          results[app] = { status: "no_data", message: "No stats ever collected" };

          await supabase.from("activity_log").insert({
            user_id: userId,
            type: "app_stats_stale",
            payload: {
              action: "app_stats_stale",
              app: app,
              reason: "no_data",
            },
          });
          continue;
        }

        const isStale = latest.updated_at < twentyFourHoursAgo;

        if (isStale) {
          const hoursSinceUpdate = Math.floor(
            (Date.now() - new Date(latest.updated_at).getTime()) / 3600000,
          );

          await supabase.from("activity_log").insert({
            user_id: userId,
            type: "app_stats_stale",
            payload: {
              action: "app_stats_stale",
              app: app,
              hours_since_update: hoursSinceUpdate,
              last_updated: latest.updated_at,
            },
          });

          results[app] = { status: "stale", hours_since_update: hoursSinceUpdate };
        } else {
          results[app] = { status: "fresh", last_updated: latest.updated_at };
        }
      }

      return {
        ok: true,
        job: "app-stats",
        apps: results,
      };
    },
    { idempotencyKey: `app-stats-${today}` },
  );

  return NextResponse.json(result);
}
