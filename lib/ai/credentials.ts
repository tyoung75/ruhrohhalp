import type { AIProvider, PlanTier } from "@/lib/types/domain";
import { decryptSecret } from "@/lib/security/encryption";
import { createClient } from "@/lib/supabase/server";

type ManagedKeys = Partial<Record<AIProvider, string>>;

export function getManagedKeys(): ManagedKeys {
  return {
    claude: process.env.ANTHROPIC_API_KEY,
    chatgpt: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };
}

export async function getUserProviderKey(userId: string, tier: PlanTier, provider: AIProvider): Promise<string | null> {
  if (tier !== "byok") {
    return getManagedKeys()[provider] ?? null;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_api_keys")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (!data?.encrypted_key) return null;
  return decryptSecret(data.encrypted_key);
}
