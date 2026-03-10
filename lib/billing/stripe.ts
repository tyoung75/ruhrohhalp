import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  stripe = new Stripe(key);
  return stripe;
}

export const PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER ?? "price_starter_placeholder",
  pro: process.env.STRIPE_PRICE_PRO ?? "price_pro_placeholder",
  byok: process.env.STRIPE_PRICE_BYOK ?? "price_byok_placeholder",
} as const;
