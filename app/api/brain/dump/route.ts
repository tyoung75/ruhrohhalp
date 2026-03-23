import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

interface BrainDumpGoal {
  pillar: string;
  text: string;
}

interface BrainDumpPayload {
  goals: BrainDumpGoal[];
  weeklyContext: string;
  topOfMind: string;
}

/**
 * GET /api/brain/dump
 * Returns the most recent brain dump (weekly context) and pinned goals separately.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();

  // Fetch latest brain dump (weekly context + top of mind)
  const { data: dump } = await supabase
    .from("brain_dumps")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch pinned goals from the most recent dump that has non-empty goals
  let pinnedGoals: BrainDumpGoal[] | null = null;
  if (dump) {
    try {
      const raw = typeof dump.goals === "string" ? JSON.parse(dump.goals) : dump.goals;
      if (Array.isArray(raw) && raw.length > 0 && raw[0].pillar !== undefined) {
        pinnedGoals = raw;
      }
    } catch { /* ignore parse error */ }
  }

  return NextResponse.json({
    dump: dump ?? null,
    pinnedGoals,
  });
}

/**
 * POST /api/brain/dump
 * Saves goals (quarterly-pinned) and weekly context independently.
 * Goals persist across weekly saves — only updated when explicitly changed.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  let body: BrainDumpPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { goals, weeklyContext, topOfMind } = body;

  if (!Array.isArray(goals)) {
    return NextResponse.json({ error: "goals must be an array" }, { status: 400 });
  }
  if (typeof weeklyContext !== "string" || typeof topOfMind !== "string") {
    return NextResponse.json({ error: "weeklyContext and topOfMind are required strings" }, { status: 400 });
  }

  const supabase = await createClient();

  // Save the brain dump record — goals are always persisted alongside weekly data
  // so the latest record always has the current pinned goals
  const { data: dump, error } = await supabase
    .from("brain_dumps")
    .insert({
      user_id: user.id,
      goals: JSON.stringify(goals),
      weekly_context: weeklyContext,
      top_of_mind: topOfMind,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to save brain dump:", error);
    return NextResponse.json({ error: "Failed to process brain dump" }, { status: 500 });
  }

  return NextResponse.json({ dump, success: true });
}
