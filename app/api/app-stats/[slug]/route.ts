import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { logError } from "@/lib/logger";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Valid app slugs — reject anything else
const VALID_SLUGS = ["motus", "ironpassport"];

/**
 * GET /api/app-stats/:slug
 *
 * Returns the latest stats snapshot for the given app.
 * Used by the Life OS Command Center daily briefing.
 *
 * Auth: x-webhook-secret header
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const authError = validateWebhookSecret(
    request.headers.get("x-webhook-secret")
  );
  if (authError) return authError;

  const { slug } = await params;

  if (!VALID_SLUGS.includes(slug)) {
    return NextResponse.json(
      { error: `Unknown app: ${slug}. Valid: ${VALID_SLUGS.join(", ")}` },
      { status: 404 }
    );
  }

  try {
    const { data, error } = await supabase
      .from("app_stats")
      .select("*")
      .eq("app", slug)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: `No stats found for ${slug}` },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    logError("app-stats.get", error);
    return NextResponse.json(
      { error: "Failed to fetch app stats" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/app-stats/:slug
 *
 * Receives a stats snapshot from Motus or Iron Passport.
 * Upserts (replaces) the latest row for that app.
 *
 * Auth: x-webhook-secret header
 * Body: JSON stats payload (shape varies by app)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const authError = validateWebhookSecret(
    request.headers.get("x-webhook-secret")
  );
  if (authError) return authError;

  const { slug } = await params;

  if (!VALID_SLUGS.includes(slug)) {
    return NextResponse.json(
      { error: `Unknown app: ${slug}. Valid: ${VALID_SLUGS.join(", ")}` },
      { status: 404 }
    );
  }

  try {
    const payload = await request.json();

    // Stamp the payload with app name and current time
    const record = {
      app: slug,
      updated_at: new Date().toISOString(),
      stats: payload, // Store the full stats object as JSONB
    };

    // Upsert — one row per app, always overwrite
    const { error } = await supabase
      .from("app_stats")
      .upsert(record, { onConflict: "app" });

    if (error) {
      logError("app-stats.post.upsert", error);
      return NextResponse.json(
        { error: "Failed to store stats" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      app: slug,
      updated_at: record.updated_at,
    });
  } catch (error) {
    logError("app-stats.post", error);
    return NextResponse.json(
      { error: "Failed to process stats payload" },
      { status: 500 }
    );
  }
}
