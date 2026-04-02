"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";
import { MODELS, PROVIDERS } from "@/lib/ai/registry";
import { useMobile } from "@/lib/useMobile";

interface UsageData {
  totals: { tokens: number; estimatedCostUsd: number };
  models: Array<{
    provider: string;
    modelId: string;
    calls: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
  recommendations: Array<{
    currentModelId: string;
    suggestedModelId: string;
    estimatedMonthlySavingsUsd: number;
    rationale: string;
  }>;
}

export default function UsagePage() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const isMobile = useMobile();

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const data = (await api("/api/settings/usage")) as UsageData;
        if (mounted) setUsage(data);
      } catch {
        if (mounted) setUsage(null);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, []);

  return (
    <div style={{ padding: isMobile ? "20px 14px" : "32px 40px", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontFamily: C.serif, fontSize: 26, fontStyle: "italic", color: C.cream, marginBottom: 6 }}>
        AI Usage & Cost
      </h1>
      <p style={{ fontFamily: C.mono, fontSize: 11, color: C.textFaint, marginBottom: 32, letterSpacing: 0.5 }}>
        Token usage, cost breakdown, and optimization recommendations for the last 30 days.
      </p>

      {loading ? (
        <div style={{ fontSize: 13, color: C.textDim }}>Loading usage analytics...</div>
      ) : !usage ? (
        <div style={{ fontSize: 13, color: C.textDim }}>Usage metrics unavailable right now.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.textFaint, fontFamily: C.mono, marginBottom: 4 }}>Total Tokens</div>
              <div style={{ fontSize: 28, fontWeight: 600, color: C.cream, fontFamily: C.mono }}>{usage.totals.tokens.toLocaleString()}</div>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, color: C.textFaint, fontFamily: C.mono, marginBottom: 4 }}>Estimated Cost</div>
              <div style={{ fontSize: 28, fontWeight: 600, color: C.cream, fontFamily: C.mono }}>${usage.totals.estimatedCostUsd.toFixed(2)}</div>
            </div>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 12, color: C.textFaint, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 12 }}>By Model</div>
            {usage.models.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
                No AI usage recorded yet. Usage is tracked automatically going forward as you use the app.
                <span style={{ display: "block", marginTop: 8, color: C.textFaint, fontSize: 11 }}>
                  Note: Usage tracking started when the activity logging system was deployed. Historical usage from before that point is not available for backfill since the app calls AI providers directly (no billing API to pull from).
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {usage.models.map((model) => {
                  const modelDef = MODELS[model.modelId];
                  const provider = modelDef?.provider ? PROVIDERS[modelDef.provider] : null;
                  return (
                    <div key={model.modelId} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                      <div>
                        <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
                          {provider ? <span style={{ color: provider.color }}>{provider.icon} </span> : null}
                          {modelDef?.label ?? model.modelId}
                        </div>
                        <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2 }}>
                          {model.calls} calls · {model.totalTokens.toLocaleString()} tokens
                        </div>
                      </div>
                      <div style={{ fontSize: 16, color: C.cream, fontFamily: C.mono, alignSelf: "center" }}>${model.estimatedCostUsd.toFixed(2)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {usage.recommendations.length > 0 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 12, color: C.textFaint, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 12 }}>Optimization Suggestions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {usage.recommendations.map((rec) => (
                  <div key={`${rec.currentModelId}-${rec.suggestedModelId}`} style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
                    Switch some <span style={{ color: C.text, fontWeight: 600 }}>{MODELS[rec.currentModelId]?.label ?? rec.currentModelId}</span> tasks to{" "}
                    <span style={{ color: C.text, fontWeight: 600 }}>{MODELS[rec.suggestedModelId]?.label ?? rec.suggestedModelId}</span> to save about{" "}
                    <span style={{ color: C.gem, fontWeight: 600 }}>${rec.estimatedMonthlySavingsUsd.toFixed(2)}</span>/month.
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
