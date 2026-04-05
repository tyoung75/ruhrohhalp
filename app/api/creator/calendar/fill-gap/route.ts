/**
 * Fill Gap — POST /api/creator/calendar/fill-gap
 *
 * Takes a planned calendar slot and generates content from it,
 * linking the generated content_queue entry back to the slot.
 *
 * Body: { slot_id: string } — the content_calendar row to fill
 *
 * This is the bridge between planning and generation: it takes a planned
 * topic and feeds it to the content generation pipeline as a seed.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

export async function POST(request: NextRequest) {
  // Auth: user session or cron secret
  const cronSecret = request.headers.get("x-cron-secret");
  const authHeader = request.headers.get("Authorization");
  const bearerToken = authHeader?.replace("Bearer ", "");
  let userId: string;

  if (
    (cronSecret && cronSecret === process.env.CRON_SECRET) ||
    (bearerToken && bearerToken === process.env.CRON_SECRET)
  ) {
    userId = process.env.CREATOR_USER_ID ?? TYLER_USER_ID;
  } else {
    const { user, response } = await requireUser();
    if (!user) return response!;
    userId = user.id;
  }

  const body = await request.json().catch(() => ({}));
  const slotId = body.slot_id;
  const date = body.date;

  const supabase = createAdminClient();

  // If a specific slot_id is provided, generate from that slot
  if (slotId) {
    const { data: slot, error } = await supabase
      .from("content_calendar")
      .select("*")
      .eq("id", slotId)
      .eq("user_id", userId)
      .single();

    if (error || !slot) {
      return NextResponse.json({ error: "Calendar slot not found" }, { status: 404 });
    }

    if (slot.status !== "planned") {
      return NextResponse.json({ error: `Slot already ${slot.status}` }, { status: 400 });
    }

    // Mark as generating
    await supabase
      .from("content_calendar")
      .update({ status: "generating", updated_at: new Date().toISOString() })
      .eq("id", slotId);

    // Trigger content generation with this slot as seed
    try {
      const genResponse = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/creator/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": process.env.CRON_SECRET ?? "",
          },
          body: JSON.stringify({
            seedTopic: slot.topic,
            seedPlatform: slot.platform,
            seedFormat: slot.format,
            seedRationale: slot.rationale,
            calendarSlotId: slotId,
          }),
        }
      );

      const genResult = await genResponse.json();

      if (!genResponse.ok || genResult.error) {
        // Revert to planned on failure
        await supabase
          .from("content_calendar")
          .update({ status: "planned", updated_at: new Date().toISOString() })
          .eq("id", slotId);
        return NextResponse.json({ error: genResult.error ?? "Generation failed" }, { status: 500 });
      }

      // Link generated content to the calendar slot
      const generatedIds = genResult.queued ?? [];
      if (generatedIds.length > 0) {
        await supabase
          .from("content_calendar")
          .update({
            status: "generated",
            content_queue_id: generatedIds[0],
            updated_at: new Date().toISOString(),
          })
          .eq("id", slotId);
      }

      return NextResponse.json({
        ok: true,
        slot_id: slotId,
        generated: generatedIds.length,
        content_ids: generatedIds,
      });
    } catch (err) {
      await supabase
        .from("content_calendar")
        .update({ status: "planned", updated_at: new Date().toISOString() })
        .eq("id", slotId);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Generation failed" },
        { status: 500 }
      );
    }
  }

  // If a date is provided instead, plan + generate for that date
  if (date) {
    // First, plan slots for this date using the planner
    const planResponse = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/creator/calendar/plan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": process.env.CRON_SECRET ?? "",
        },
        body: JSON.stringify({ week: date, days: 1 }),
      }
    );

    const planResult = await planResponse.json();
    return NextResponse.json({
      ok: true,
      planned: planResult.planned ?? 0,
      slots: planResult.slots ?? [],
    });
  }

  return NextResponse.json({ error: "Provide slot_id or date" }, { status: 400 });
}
