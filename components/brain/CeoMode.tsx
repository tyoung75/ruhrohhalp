"use client";

import { useState } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";

interface Source {
  id: string;
  source: string;
  similarity: number;
}

interface CeoResponse {
  leverage: string[];
  decisions: string[];
  blockers: string[];
  delegate: string[];
  sources: Source[];
}

const SECTIONS: { key: keyof Omit<CeoResponse, "sources">; label: string; icon: string; color: string }[] = [
  { key: "leverage", label: "Highest-Leverage Tasks", icon: "◆", color: C.cl },
  { key: "decisions", label: "Open Decisions", icon: "◇", color: C.gold },
  { key: "blockers", label: "Cross-Venture Blockers", icon: "✦", color: C.reminder },
  { key: "delegate", label: "Delegatable Work", icon: "◎", color: C.gpt },
];

export function CeoMode() {
  const [data, setData] = useState<CeoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runCeo() {
    setLoading(true);
    setError("");
    try {
      const result = await api<CeoResponse>("/api/brain/ceo", { method: "POST" });
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load CEO briefing");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Trigger button */}
      <button
        onClick={runCeo}
        disabled={loading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          borderRadius: 8,
          border: `1px solid ${C.cl}40`,
          background: loading ? C.card : C.clDim,
          color: loading ? C.textDim : C.cl,
          fontFamily: C.mono,
          fontSize: 12,
          letterSpacing: 0.5,
          cursor: loading ? "default" : "pointer",
          alignSelf: "flex-start",
        }}
      >
        {loading ? <Spinner color={C.cl} size={12} /> : "◆"}
        {loading ? "Thinking..." : "/ceo"}
      </button>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 7,
            background: `${C.reminder}14`,
            border: `1px solid ${C.reminder}28`,
            color: C.reminder,
            fontFamily: C.mono,
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {data && (
        <div className="fadeUp" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SECTIONS.map(({ key, label, icon, color }) => {
            const items = data[key];
            if (!items || items.length === 0) return null;
            return (
              <div
                key={key}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {/* Section header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "10px 14px",
                    background: `${color}08`,
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <span style={{ color, fontSize: 13 }}>{icon}</span>
                  <span
                    style={{
                      fontFamily: C.serif,
                      fontStyle: "italic",
                      fontSize: 13,
                      color: C.cream,
                    }}
                  >
                    {label}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontFamily: C.mono,
                      fontSize: 10,
                      color: C.textDim,
                      background: `${color}14`,
                      padding: "1px 7px",
                      borderRadius: 4,
                    }}
                  >
                    {items.length}
                  </span>
                </div>

                {/* Items */}
                <div style={{ padding: "8px 0" }}>
                  {items.map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: 8,
                        padding: "6px 14px",
                        fontSize: 12,
                        fontFamily: C.sans,
                        color: C.text,
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ color: C.textFaint, flexShrink: 0, fontFamily: C.mono, fontSize: 10, marginTop: 2 }}>
                        {i + 1}.
                      </span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Source citations */}
          {data.sources.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 5,
                padding: "4px 0",
              }}
            >
              <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginRight: 4 }}>
                Sources:
              </span>
              {data.sources.map((s, i) => (
                <span
                  key={i}
                  style={{
                    fontFamily: C.mono,
                    fontSize: 9,
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    color: C.textDim,
                  }}
                >
                  {s.source} · {(s.similarity * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
