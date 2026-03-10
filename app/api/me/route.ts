import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ensureProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { getTierLimit, getUsageForMonth } from "@/lib/usage";

export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const { tier } = await ensureProfile(user);
  const usageCount = await getUsageForMonth(user.id);
  const usageLimit = getTierLimit(tier);

  const supabase = await createClient();
  const { data: keys } = await supabase.from("user_api_keys").select("provider").eq("user_id", user.id);

  return NextResponse.json({
    user: { id: user.id, email: user.email },
    tier,
    usageCount,
    usageLimit,
    hasKeys: {
      claude: (keys ?? []).some((k) => k.provider === "claude"),
      chatgpt: (keys ?? []).some((k) => k.provider === "chatgpt"),
      gemini: (keys ?? []).some((k) => k.provider === "gemini"),
    },
  });
}
