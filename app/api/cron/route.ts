/**
 * Vercel Cron — Orchestrator
 *
 * Lightweight dispatcher that calls sub-routes in parallel:
 *  - /api/cron/briefing  → daily briefing + weekly synthesis (AI-heavy)
 *  - /api/cron/sync      → creator OS sync, analytics, tokens
 *  - /api/cron/media     → AI editor pipeline (drive → analyze → plan → execute)
 *
 * Each sub-route gets its own 60s Vercel function invocation.
 * The GitHub Actions workflow calls this orchestrator OR the sub-routes directly.
 *
 * Schedule: "0 11 * * *" → runs at 11:00 UTC (6 AM ET)
 * Auth: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Determine base URL from the request
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const subRoutes = ["briefing", "sync", "media"];

  // Fire all sub-routes in parallel — each gets its own 60s invocation
  const settled = await Promise.allSettled(
    subRoutes.map(async (route) => {
      try {
        const res = await fetch(`${baseUrl}/api/cron/${route}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${cronSecret}` },
        });
        const body = await res.json();
        return { route, status: res.status, ...body };
      } catch (err) {
        logError(`cron.orchestrator.${route}`, err);
        return { route, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const results: Record<string, unknown> = {
    ok: true,
    timestamp: new Date().toISOString(),
  };

  for (const item of settled) {
    if (item.status === "fulfilled") {
      const val = item.value;
      results[val.route] = val;
    } else {
      results[`error_${subRoutes[settled.indexOf(item)]}`] = item.reason;
    }
  }

  return NextResponse.json(results);
}
