import type { User } from "@supabase/supabase-js";
import type { PlanTier } from "@/lib/types/domain";
import { createClient } from "@/lib/supabase/server";
import { TIERS } from "@/lib/tiers";

export async function ensureProfile(user: User): Promise<{ tier: PlanTier }> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("profiles")
    .select("id,active_tier")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    await supabase.from("profiles").insert({
      id: user.id,
      email: user.email ?? null,
      active_tier: "free",
    });
    return { tier: "free" };
  }

  return { tier: existing.active_tier };
}

export async function getTierForUser(userId: string): Promise<PlanTier> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("active_tier").eq("id", userId).maybeSingle();
  const tier = data?.active_tier;
  if (tier && tier in TIERS) return tier;
  return "free";
}

export async function setTierForUser(userId: string, tier: PlanTier): Promise<void> {
  const supabase = await createClient();
  await supabase.from("profiles").upsert({ id: userId, active_tier: tier }, { onConflict: "id" });
}
