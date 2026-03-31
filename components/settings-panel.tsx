"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";
import { TIERS } from "@/lib/tiers";
import type { PlanTier } from "@/lib/types/domain";
import { useMobile } from "@/lib/useMobile";

const fields = [
  { provider: "claude", label: "Anthropic Key", placeholder: "sk-ant-...", color: C.cl },
  { provider: "chatgpt", label: "OpenAI Key", placeholder: "sk-proj-...", color: C.gpt },
  { provider: "gemini", label: "Gemini Key", placeholder: "AIza...", color: C.gem },
] as const;

export function SettingsPanel({
  tier,
  hasKeys,
  onClose,
  onChangePlan,
  onSaved,
}: {
  tier: PlanTier;
  hasKeys: Record<"claude" | "chatgpt" | "gemini", boolean>;
  onClose: () => void;
  onChangePlan: () => void;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const byokOrFree = tier === "byok" || tier === "free";
  const isMobile = useMobile();

  async function save(provider: "claude" | "chatgpt" | "gemini") {
    const value = values[provider]?.trim();
    if (!value) return;
    setSaving(true);
    try {
      await api("/api/settings/keys", {
        method: "POST",
        body: JSON.stringify({ provider, apiKey: value }),
      });
      setValues((prev) => ({ ...prev, [provider]: "" }));
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 100, display: "flex", justifyContent: "flex-end" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="slideIn" style={{ width: isMobile ? "100%" : 360, height: "100%", background: C.surface, borderLeft: isMobile ? undefined : `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ padding: "18px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: C.serif, fontSize: 18, fontStyle: "italic", color: C.cream }}>Settings</div>
            <div style={{ fontSize: 10, color: C.textFaint }}>Plan: {TIERS[tier].label}</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${C.border}`, background: "none", color: C.textDim, fontSize: 16, cursor: "pointer" }}>
            ×
          </button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: C.card, borderRadius: 9, border: `1px solid ${C.border}`, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 13 }}>{TIERS[tier].label}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>{TIERS[tier].price === 0 ? "Free" : `$${TIERS[tier].price}/mo`}</div>
              </div>
              <button onClick={onChangePlan} style={{ background: C.clDim, color: C.cl, border: `1px solid ${C.cl}40`, borderRadius: 6, padding: "4px 12px" }}>
                Change plan
              </button>
            </div>
          </div>

          {byokOrFree ? (
            <div style={{ background: C.card, borderRadius: 9, border: `1px solid ${C.border}`, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              {fields.map((f) => (
                <div key={f.provider}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: C.text }}>{f.label}</span>
                    <span style={{ fontSize: 10, color: hasKeys[f.provider] ? f.color : C.textFaint }}>{hasKeys[f.provider] ? "active" : "not set"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="password"
                      value={values[f.provider] ?? ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [f.provider]: e.target.value }))}
                      placeholder={f.placeholder}
                      style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 10px", color: C.text, fontFamily: C.mono, fontSize: 16, minWidth: 0 }}
                    />
                    <button onClick={() => void save(f.provider)} disabled={saving || !(values[f.provider] ?? "").trim()} style={{ borderRadius: 6, border: `1px solid ${f.color}45`, background: `${f.color}14`, color: f.color, padding: "0 10px", whiteSpace: "nowrap", cursor: "pointer" }}>
                      Save
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.textDim }}>Managed plan uses server-side provider keys. BYOK is optional on its own tier.</div>
          )}
        </div>
      </div>
    </div>
  );
}
