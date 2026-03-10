import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { processInputSchema } from "@/lib/validation";
import { ensureProfile } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { processInputWithDualAI } from "@/lib/ai/service";
import { canCreateTasks, getTierLimit, getUsageForMonth, incrementUsage } from "@/lib/usage";
import { dbTaskToPlannerItem } from "@/lib/tasks";
import { isModelAllowedForTier, TIERS } from "@/lib/tiers";
import { limitByKey } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const rl = limitByKey(`planner:${user.id}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await request.json();
  const parsed = processInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { tier } = await ensureProfile(user);
  const usageCount = await getUsageForMonth(user.id);

  const supabase = await createClient();
  const { data: existingRows } = await supabase
    .from("tasks")
    .select("title,type")
    .eq("user_id", user.id)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(8);

  const result = await processInputWithDualAI({
    userId: user.id,
    tier,
    input: parsed.data.input,
    existingItems: (existingRows ?? []).map((r) => ({ title: r.title, type: r.type })),
  });

  if (!canCreateTasks(tier, usageCount, result.items.length)) {
    return NextResponse.json(
      {
        error: "Monthly task limit reached for current plan.",
        usageCount,
        usageLimit: getTierLimit(tier),
      },
      { status: 403 },
    );
  }

  const allowedModels = TIERS[tier].models;
  const normalized = result.items.map((item) => {
    let recommendedModel = item.recommendedModel;
    if (!isModelAllowedForTier(tier, recommendedModel)) {
      recommendedModel = allowedModels.includes("all") ? recommendedModel : allowedModels[0];
    }
    return {
      user_id: item.userId,
      title: item.title,
      description: item.description,
      type: item.type,
      priority: item.priority,
      how_to: item.howTo,
      recommended_ai: item.recommendedAI,
      recommended_model: recommendedModel,
      ai_reason: item.aiReason,
      selected_model: item.selectedModel,
      audit_notes: item.auditNotes,
      memory_key: item.memoryKey,
      status: item.status,
      source_text: item.sourceText,
    };
  });

  const { data: inserted, error } = await supabase.from("tasks").insert(normalized).select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const updatedUsage = await incrementUsage(user.id, normalized.length);

  return NextResponse.json({
    items: (inserted ?? []).map(dbTaskToPlannerItem),
    auditApplied: result.auditApplied,
    usageCount: updatedUsage,
    usageLimit: getTierLimit(tier),
  });
}
