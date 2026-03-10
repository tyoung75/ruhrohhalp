"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MODELS, PROVIDERS } from "@/lib/ai/registry";
import { C } from "@/lib/ui";

type Props = {
  value: string;
  onChange: (modelId: string) => void;
  allowedModels: string[];
};

export function ModelPicker({ value, onChange, allowedModels }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const current = MODELS[value];
  const currentProvider = current ? PROVIDERS[current.provider] : null;

  const groups = useMemo(() => {
    const allowedSet = new Set(allowedModels);
    const allAllowed = allowedSet.has("all");
    return Object.entries(PROVIDERS)
      .map(([providerId, provider]) => {
        const models = Object.values(MODELS).filter((m) => m.provider === providerId && (allAllowed || allowedSet.has(m.id)));
        return { provider, models };
      })
      .filter((g) => g.models.length > 0);
  }, [allowedModels]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: currentProvider ? `${currentProvider.color}14` : C.card,
          border: `1px solid ${currentProvider ? `${currentProvider.color}40` : C.border}`,
          borderRadius: 6,
          padding: "4px 8px 4px 7px",
          cursor: "pointer",
          fontFamily: C.mono,
          fontSize: 10,
          color: currentProvider?.color || C.textDim,
        }}
      >
        {currentProvider?.icon} {current?.label ?? "Select model"} <span style={{ marginLeft: 2 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 50,
            background: C.card,
            border: `1px solid ${C.borderMid}`,
            borderRadius: 10,
            minWidth: 260,
            boxShadow: "0 8px 32px #00000060",
            overflow: "hidden",
          }}
        >
          {groups.map(({ provider, models }) => (
            <div key={provider.id}>
              <div
                style={{
                  padding: "6px 12px",
                  fontSize: 9,
                  fontFamily: C.mono,
                  letterSpacing: 1.2,
                  color: provider.color,
                  background: `${provider.color}08`,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {provider.icon} {provider.name.toUpperCase()}
              </div>
              {models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    background: value === m.id ? `${provider.color}14` : "transparent",
                    border: "none",
                    borderBottom: `1px solid ${C.border}`,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ color: C.text, fontSize: 11, fontFamily: C.mono }}>{m.label}</div>
                    <div style={{ color: C.textDim, fontSize: 10 }}>{m.blurb}</div>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
