"use client";

import { TIERS } from "@/lib/tiers";
import type { PlanTier } from "@/lib/types/domain";
import { C } from "@/lib/ui";
import { useMobile } from "@/lib/useMobile";

export function PricingModal({
  current,
  onSelect,
  onClose,
}: {
  current: PlanTier;
  onSelect: (tier: PlanTier) => Promise<void>;
  onClose: () => void;
}) {
  const isMobile = useMobile();

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 10 : 20 }}>
      <div className="slideUp" style={{ background: C.surface, border: `1px solid ${C.borderMid}`, borderRadius: isMobile ? 12 : 16, maxWidth: 860, width: "100%", overflow: "hidden", maxHeight: isMobile ? "90vh" : undefined, overflowY: isMobile ? "auto" : undefined }}>
        <div style={{ padding: isMobile ? "18px 16px 0" : "24px 28px 0", position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", top: isMobile ? 14 : 18, right: isMobile ? 14 : 18, width: 32, height: 32, borderRadius: 6, border: `1px solid ${C.border}`, background: "none", color: C.textDim, fontSize: 16, cursor: "pointer" }}>
            ×
          </button>
          <div style={{ fontFamily: C.serif, fontSize: isMobile ? 20 : 24, fontStyle: "italic", color: C.cream, marginBottom: 4 }}>Choose your plan</div>
          <div style={{ fontSize: isMobile ? 12 : 13, color: C.textDim, marginBottom: 20, paddingRight: 36 }}>Select a subscription tier. Billing is handled with Stripe checkout.</div>
        </div>

        <div style={{ padding: isMobile ? "0 16px 20px" : "0 28px 28px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          {Object.values(TIERS).map((tier) => {
            const isActive = current === tier.id;
            const accent = tier.id === "pro" ? C.gold : tier.id === "starter" ? C.gpt : tier.id === "byok" ? C.cl : C.textDim;
            return (
              <div key={tier.id} style={{ background: isActive ? `${accent}10` : C.card, border: `1px solid ${isActive ? accent : C.border}`, borderRadius: 12, padding: isMobile ? 16 : 20 }}>
                <div style={{ fontFamily: C.mono, fontSize: 10, color: accent, letterSpacing: 1.2, marginBottom: 6 }}>{tier.label.toUpperCase()}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 6 }}>
                  <span style={{ fontFamily: C.serif, fontSize: isMobile ? 24 : 28, fontStyle: "italic", color: C.cream }}>{tier.price === 0 ? "Free" : `$${tier.price}`}</span>
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
                    style={{ marginTop: 14, width: "100%", border: "none", borderRadius: 8, padding: "10px 10px", cursor: "pointer", background: accent, color: C.bg, fontWeight: 600, fontSize: isMobile ? 14 : 13 }}
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
