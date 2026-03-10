"use client";

import { TIERS } from "@/lib/tiers";
import type { PlanTier } from "@/lib/types/domain";
import { C } from "@/lib/ui";

export function PricingModal({
  current,
  onSelect,
  onClose,
}: {
  current: PlanTier;
  onSelect: (tier: PlanTier) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="slideUp" style={{ background: C.surface, border: `1px solid ${C.borderMid}`, borderRadius: 16, maxWidth: 860, width: "100%", overflow: "hidden" }}>
        <div style={{ padding: "24px 28px 0", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 18, right: 18, width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`, background: "none", color: C.textDim }}>
            ×
          </button>
          <div style={{ fontFamily: C.serif, fontSize: 24, fontStyle: "italic", color: C.cream, marginBottom: 4 }}>Choose your plan</div>
          <div style={{ fontSize: 13, color: C.textDim, marginBottom: 20 }}>Select a subscription tier. Billing is handled with Stripe checkout.</div>
        </div>

        <div style={{ padding: "0 28px 28px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          {Object.values(TIERS).map((tier) => {
            const isActive = current === tier.id;
            const accent = tier.id === "pro" ? C.gold : tier.id === "starter" ? C.gpt : tier.id === "byok" ? C.cl : C.textDim;
            return (
              <div key={tier.id} style={{ background: isActive ? `${accent}10` : C.card, border: `1px solid ${isActive ? accent : C.border}`, borderRadius: 12, padding: 20 }}>
                <div style={{ fontFamily: C.mono, fontSize: 10, color: accent, letterSpacing: 1.2, marginBottom: 6 }}>{tier.label.toUpperCase()}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
                  <span style={{ fontFamily: C.serif, fontSize: 28, fontStyle: "italic", color: C.cream }}>{tier.price === 0 ? "Free" : `$${tier.price}`}</span>
                  {tier.price > 0 ? <span style={{ fontSize: 11, color: C.textDim }}>/mo</span> : null}
                </div>
                <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12 }}>{tier.desc}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {tier.features.map((f) => (
                    <div key={f} style={{ fontSize: 11, color: C.text }}>
                      ✓ {f}
                    </div>
                  ))}
                </div>
                {tier.id !== "free" ? (
                  <button
                    onClick={() => void onSelect(tier.id)}
                    style={{ marginTop: 14, width: "100%", border: "none", borderRadius: 8, padding: "8px 10px", cursor: "pointer", background: accent, color: C.bg, fontWeight: 600 }}
                  >
                    {isActive ? "Current Plan" : `Choose ${tier.label}`}
                  </button>
                ) : (
                  <div style={{ marginTop: 14, textAlign: "center", fontSize: 11, color: C.textFaint }}>Default tier</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
