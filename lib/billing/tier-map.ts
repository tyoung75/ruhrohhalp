import type { PlanTier } from "@/lib/types/domain";

export function priceToTier(priceId: string | null | undefined): PlanTier {
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_BYOK) return "byok";
  return "free";
}
