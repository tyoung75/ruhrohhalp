import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/ai/registry";
import type { AIProvider } from "@/lib/types/domain";

type UsageRow = {
  payload: {
    provider?: AIProvider;
    model?: string;
    route?: string;
    input_tokens?: number;
    output_tokens?: number;
    tokens_used?: number;
    error?: string | null;
  };
};

export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_log")
    .select("payload")
    .eq("user_id", user.id)
    .eq("type", "ai_call")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byModel = new Map<
    string,
    {
      provider: string;
      modelId: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      routes: Record<string, number>;
    }
  >();

  for (const row of (data ?? []) as UsageRow[]) {
    const modelId = row.payload?.model;
    if (!modelId) continue;
    const modelMeta = MODELS[modelId];
    const provider = row.payload?.provider ?? modelMeta?.provider ?? "unknown";
    const inputTokens = Math.max(0, Number(row.payload?.input_tokens ?? 0));
    const outputTokens = Math.max(0, Number(row.payload?.output_tokens ?? 0));
    const fallbackTokens = Math.max(0, Number(row.payload?.tokens_used ?? 0));
    const totalTokens = inputTokens + outputTokens || fallbackTokens;
    const route = row.payload?.route ?? "unknown";

    const current = byModel.get(modelId) ?? {
      provider,
      modelId,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      routes: {},
    };

    current.calls += 1;
    current.inputTokens += inputTokens;
    current.outputTokens += outputTokens;
    current.totalTokens += totalTokens;
    current.routes[route] = (current.routes[route] ?? 0) + 1;

    if (modelMeta) {
      current.estimatedCostUsd +=
        (inputTokens * modelMeta.priceIn + outputTokens * modelMeta.priceOut) / 1_000_000;
    }

    byModel.set(modelId, current);
  }

  const models = [...byModel.values()].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  const totalCost = models.reduce((sum, m) => sum + m.estimatedCostUsd, 0);
  const totalTokens = models.reduce((sum, m) => sum + m.totalTokens, 0);

  const recommendations = models
    .map((m) => {
      const modelMeta = MODELS[m.modelId];
      if (!modelMeta) return null;
      const cheaper = Object.values(MODELS)
        .filter((candidate) => candidate.provider === modelMeta.provider && candidate.id !== modelMeta.id)
        .sort((a, b) => a.priceIn + a.priceOut - (b.priceIn + b.priceOut))[0];
      if (!cheaper) return null;

      const currentRate = modelMeta.priceIn + modelMeta.priceOut;
      const cheaperRate = cheaper.priceIn + cheaper.priceOut;
      if (cheaperRate >= currentRate) return null;

      const currentSpend = m.estimatedCostUsd;
      const estLowerSpend =
        (m.inputTokens * cheaper.priceIn + m.outputTokens * cheaper.priceOut) / 1_000_000;
      const potentialSavings = currentSpend - estLowerSpend;
      if (potentialSavings <= 0.25) return null;

      return {
        currentModelId: modelMeta.id,
        suggestedModelId: cheaper.id,
        provider: modelMeta.provider,
        estimatedMonthlySavingsUsd: Number(potentialSavings.toFixed(2)),
        rationale: `You used ${m.totalTokens.toLocaleString()} tokens on ${modelMeta.label}. ${cheaper.label} is lower cost for similar quick-turn tasks.`,
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    windowDays: 30,
    totals: {
      tokens: totalTokens,
      estimatedCostUsd: Number(totalCost.toFixed(4)),
    },
    models,
    recommendations,
  });
}
