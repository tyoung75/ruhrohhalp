import type { PlanTier } from "@/lib/types/domain";
import { AI_MODELS } from "@/lib/ai-config";

export const TIERS: Record<
  PlanTier,
  {
    id: PlanTier;
    label: string;
    price: number;
    models: string[];
    monthlyLimit: number | null;
    desc: string;
    features: string[];
  }
> = {
  free: {
    id: "free",
    label: "Free",
    price: 0,
    models: [AI_MODELS.FAST, "gpt-4o-mini", "gemini-1.5-flash"],
    monthlyLimit: null,
    desc: "Tyler's personal OS — no limits",
    features: ["Unlimited tasks", "Basic models", "No agent chat", "No memory sync"],
  },
  starter: {
    id: "starter",
    label: "Starter",
    price: 12,
    models: [AI_MODELS.PRIMARY, "gpt-4o", "gemini-1.5-flash"],
    monthlyLimit: 100,
    desc: "Best for individuals",
    features: ["100 tasks/month", "Balanced models", "Agent chat on all tasks", "ChatGPT audit"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    price: 25,
    models: [AI_MODELS.PRIMARY, "gpt-4o", "gemini-1.5-pro"],
    monthlyLimit: null,
    desc: "For power users and founders",
    features: ["Unlimited tasks", "Flagship models", "Full memory and audit", "Priority processing"],
  },
  byok: {
    id: "byok",
    label: "BYOK",
    price: 5,
    models: ["all"],
    monthlyLimit: null,
    desc: "Bring your own API keys",
    features: ["Unlimited tasks", "All models with your keys", "$5 platform fee"],
  },
};

export function isModelAllowedForTier(tier: PlanTier, modelId: string): boolean {
  const allowed = TIERS[tier].models;
  return allowed.includes("all") || allowed.includes(modelId);
}
