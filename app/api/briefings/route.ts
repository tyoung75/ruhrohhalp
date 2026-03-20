import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/briefings
 *
 * Returns the latest briefing or briefing by date query param
 *
 * Query params:
 * - date=2026-03-20 (ISO date, defaults to today)
 * - period=daily|weekly (filter by period)
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const periodParam = url.searchParams.get("period");

  const supabase = await createClient();
  let query = supabase
    .from("briefings")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .limit(1);

  if (dateParam) {
    query = query.eq("date", dateParam);
  }

  if (periodParam) {
    query = query.eq("period", periodParam);
  }

  const { data, error } = await query.maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data) {
    return NextResponse.json({ briefing: null });
  }

  return NextResponse.json({ briefing: data });
}

/**
 * POST /api/briefings
 *
 * Saves a new briefing
 *
 * Body:
 * {
 *   content_md: string (required)
 *   content_json?: any
 *   date?: ISO date (defaults to today)
 *   period?: 'daily' | 'weekly'
 *   gmail_draft_id?: string
 * }
 *
 * Supports both user auth and webhook secret auth
 */
export async function POST(request: NextRequest) {
  // Check for webhook auth OR user auth
  const webhookSecret = request.headers.get("x-webhook-secret");
  let user: { id: string } | null = null;

  if (webhookSecret) {
    const webhookError = validateWebhookSecret(webhookSecret);
    if (webhookError) return webhookError;
    // For webhook calls, extract user_id from body
    const body = await request.json();
    if (!body.user_id) {
      return NextResponse.json({ error: "user_id required for webhook calls" }, { status: 400 });
    }
    user = { id: body.user_id };
    request = new NextRequest(request, {
      body: JSON.stringify(body),
    });
  } else {
    const authResponse = await requireUser();
    if (authResponse.response || !authResponse.user) return authResponse.response;
    user = authResponse.user;
  }

  const body = await request.json();
  const { content_md, content_json, date, period, gmail_draft_id } = body;

  if (!content_md || typeof content_md !== "string") {
    return NextResponse.json({ error: "content_md is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Use provided date or today
  const briefingDate = date ?? new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("briefings")
    .insert({
      user_id: user.id,
      content_md,
      content_json: content_json ?? null,
      date: briefingDate,
      period: period ?? "daily",
      gmail_draft_id: gmail_draft_id ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ briefing: data }, { status: 201 });
}
