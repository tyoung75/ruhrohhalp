"use client";

import { useState } from "react";
import type { PlannerItem } from "@/lib/types/domain";
import { C } from "@/lib/ui";
import { MODELS, PROVIDERS } from "@/lib/ai/registry";
import { TypeBadge, AgentDot } from "@/components/primitives";
import { ModelBadge } from "@/components/model-badges";
import { ModelPicker } from "@/components/model-picker";

export function PlannerCard({
  item,
  index,
  active,
  allowedModels,
  onToggle,
  onDelete,
  onOpen,
  onModelChange,
}: {
  item: PlannerItem;
  index: number;
  active: boolean;
  allowedModels: string[];
  onToggle: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpen: (item: PlannerItem) => void;
  onModelChange: (id: string, modelId: string) => Promise<void>;
}) {
  const [showHow, setShowHow] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  const model = MODELS[item.selectedModel ?? item.recommendedModel];
  const provider = model ? PROVIDERS[model.provider] : PROVIDERS.claude;

  return (
    <div
      className="fadeUp"
      style={{
        animationDelay: `${index * 0.03}s`,
        background: active ? `${provider.color}08` : C.card,
        border: `1px solid ${active ? `${provider.color}45` : C.border}`,
        borderRadius: 10,
        overflow: "hidden",
        opacity: item.status === "done" ? 0.45 : 1,
        flexShrink: 0,
      }}
    >
      <div style={{ padding: "12px 14px", display: "flex", gap: 11, alignItems: "flex-start" }}>
        <button
          onClick={() => void onToggle(item.id)}
          style={{
            width: 17,
            height: 17,
            marginTop: 2,
            borderRadius: 4,
            border: `1.5px solid ${item.status === "done" ? provider.color : C.borderMid}`,
            background: item.status === "done" ? provider.color : "none",
            cursor: "pointer",
          }}
        >
          {item.status === "done" ? "✓" : ""}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
            <TypeBadge type={item.type} />
            <span style={{ fontSize: 10, fontFamily: C.mono, color: C.textFaint }}>{item.priority}</span>
          </div>

          <div
            style={{
              fontFamily: C.serif,
              fontSize: 14,
              fontStyle: "italic",
              color: item.status === "done" ? C.textFaint : C.cream,
              lineHeight: 1.4,
              textDecoration: item.status === "done" ? "line-through" : "none",
            }}
          >
            {item.title}
          </div>

          {item.description ? <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{item.description}</div> : null}

          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            {item.howTo ? (
              <button
                onClick={() => setShowHow((s) => !s)}
                style={{ background: "none", border: "none", color: C.textFaint, fontSize: 9, cursor: "pointer" }}
              >
                {showHow ? "▾" : "▸"} HOW TO
              </button>
            ) : null}
            {item.auditNotes ? (
              <button
                onClick={() => setShowAudit((s) => !s)}
                style={{ background: "none", border: "none", color: C.gpt, fontSize: 9, cursor: "pointer" }}
              >
                {showAudit ? "▾" : "▸"} GPT AUDIT
              </button>
            ) : null}
          </div>

          {showHow ? <pre style={{ whiteSpace: "pre-wrap", marginTop: 6, color: C.textDim, fontSize: 11 }}>{item.howTo}</pre> : null}
          {showAudit ? <pre style={{ whiteSpace: "pre-wrap", marginTop: 6, color: C.textDim, fontSize: 11 }}>{item.auditNotes}</pre> : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <button onClick={() => void onDelete(item.id)} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer" }}>
            ×
          </button>
          <ModelPicker
            value={item.selectedModel ?? item.recommendedModel}
            onChange={(modelId) => void onModelChange(item.id, modelId)}
            allowedModels={allowedModels}
          />
          <button
            onClick={() => onOpen(item)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 9px",
              borderRadius: 6,
              border: `1px solid ${provider.color}45`,
              background: `${provider.color}14`,
              color: provider.color,
              cursor: "pointer",
              fontSize: 10,
            }}
          >
            {provider.icon} Open Agent
          </button>
        </div>
      </div>
      <div style={{ padding: "4px 14px 7px", display: "flex", alignItems: "center", gap: 6, borderTop: `1px solid ${C.border}` }}>
        <AgentDot id={provider.id} size={6} />
        <span style={{ fontSize: 9, fontFamily: C.mono, color: provider.color, opacity: 0.7, flex: 1 }}>{item.aiReason}</span>
        <ModelBadge modelId={item.selectedModel ?? item.recommendedModel} />
      </div>
    </div>
  );
}
