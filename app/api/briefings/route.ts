import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/briefings
 *
 * Returns the latest briefing(s) for the current day.
 *
 * Query params:
 * - date=2026-03-20 (ISO date, defaults to today in ET)
 * - period=morning|evening|daily|weekly (filter by specific period)
 *
 * When no period is specified, returns the most relevant briefing for the
 * current time of day: evening briefing in PM, morning briefing in AM,
 * falling back to whatever exists. Also includes both morning and evening
 * in a `briefings` array so the UI can show both.
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const periodParam = url.searchParams.get("period");

  // Use ET date by default so evening briefings match the correct calendar day
  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const targetDate = dateParam ?? todayET;

  const supabase = await createClient();

  if (periodParam) {
    // Specific period requested — return single briefing
    const { data, error } = await supabase
      .from("briefings")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", targetDate)
      .eq("period", periodParam)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ briefing: data ?? null });
  }

  // No period specified — fetch all briefings for the target date
  const { data: allBriefings, error } = await supabase
    .from("briefings")
    .select("*")
    .eq("user_id", user.id)
    .eq("date", targetDate)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!allBriefings || allBriefings.length === 0) {
    // Fall back to the most recent briefing of any date
    const { data: latest, error: latestErr } = await supabase
      .from("briefings")
      .select("*")
      .eq("user_id", user.id)
      .in("period", ["morning", "evening", "daily"])
      .order("date", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestErr) return NextResponse.json({ error: latestErr.message }, { status: 500 });
    return NextResponse.json({ briefing: latest ?? null, briefings: latest ? [latest] : [] });
  }

  // Determine which briefing to show as primary based on time of day
  const etHour = Number(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
  );
  const preferredPeriod = etHour >= 12 ? "evening" : "morning";

  // Find the best match: preferred period > daily > most recent
  const primary =
    allBriefings.find((b) => b.period === preferredPeriod) ??
    allBriefings.find((b) => b.period === "daily") ??
    allBriefings[0];

  return NextResponse.json({ briefing: primary, briefings: allBriefings });
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
