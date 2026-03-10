import { createClient } from "@/lib/supabase/server";
import { TIERS } from "@/lib/tiers";
import type { PlanTier } from "@/lib/types/domain";

function monthKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function getUsageForMonth(userId: string): Promise<number> {
  const supabase = await createClient();
  const mk = monthKey();
  const { data } = await supabase
    .from("usage_counters")
    .select("tasks_created")
    .eq("user_id", userId)
    .eq("month_key", mk)
    .maybeSingle();
  return data?.tasks_created ?? 0;
}

export async function incrementUsage(userId: string, by: number): Promise<number> {
  const supabase = await createClient();
  const mk = monthKey();
  const current = await getUsageForMonth(userId);
  const next = current + by;

  await supabase.from("usage_counters").upsert(
    {
      user_id: userId,
      month_key: mk,
      tasks_created: next,
    },
    { onConflict: "user_id,month_key" },
  );

  return next;
}

export function getTierLimit(tier: PlanTier): number | null {
  return TIERS[tier].monthlyLimit;
}

export function canCreateTasks(tier: PlanTier, currentCount: number, adding: number): boolean {
  const limit = getTierLimit(tier);
  if (limit === null) return true;
  return currentCount + adding <= limit;
}
