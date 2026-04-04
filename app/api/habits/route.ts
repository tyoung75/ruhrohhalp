import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** GET /api/habits — list habits with streak data */
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = await createClient();
  const { data: habits } = await supabase.from("habits").select("*").eq("user_id", user.id).eq("active", true).order("created_at");

  if (!habits?.length) return NextResponse.json({ habits: [] });

  // Calculate streaks for each habit
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: logs } = await supabase
    .from("habit_logs")
    .select("habit_id, logged_at")
    .eq("user_id", user.id)
    .gte("logged_at", sevenDaysAgo)
    .order("logged_at", { ascending: false });

  const logsByHabit = new Map<string, string[]>();
  for (const log of logs ?? []) {
    const dates = logsByHabit.get(log.habit_id) ?? [];
    dates.push(new Date(log.logged_at).toISOString().slice(0, 10));
    logsByHabit.set(log.habit_id, dates);
  }

  const today = new Date().toISOString().slice(0, 10);
  const enriched = habits.map((h) => {
    const dates = [...new Set(logsByHabit.get(h.id) ?? [])].sort().reverse();
    const completedToday = dates.includes(today);
    // Simple streak: count consecutive days backwards from today
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 30; i++) {
      const dateStr = d.toISOString().slice(0, 10);
      if (dates.includes(dateStr)) { streak++; d.setDate(d.getDate() - 1); }
      else if (i === 0) { d.setDate(d.getDate() - 1); continue; } // today might not be logged yet
      else break;
    }
    return { ...h, streak, completed_today: completedToday, last_7_days: dates.slice(0, 7) };
  });

  return NextResponse.json({ habits: enriched });
}

/** POST /api/habits — create habit or log entry */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();

  if (body.action === "log") {
    const supabase = await createClient();
    const { error } = await supabase.from("habit_logs").insert({
      habit_id: body.habit_id,
      user_id: user.id,
      logged_at: new Date().toISOString(),
      value: body.value ?? 1,
      note: body.note ?? null,
      source: body.source ?? "manual",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Create new habit
  const supabase = await createClient();
  const { data, error } = await supabase.from("habits").insert({
    user_id: user.id,
    name: body.name,
    frequency: body.frequency ?? "daily",
    target_count: body.target_count ?? 1,
    icon: body.icon ?? "",
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ habit: data }, { status: 201 });
}
