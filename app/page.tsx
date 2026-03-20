"use client";

import { useState, useCallback } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";
import { CeoMode } from "@/components/brain/CeoMode";

interface DailyBriefing {
  leverage_tasks: string[];
  open_decisions: string[];
  upcoming: string[];
  insights: string[];
  raw: string;
  sources: Array<{ id: string; source: string; similarity: number }>;
}

const SECTIONS: {
  key: keyof Pick<DailyBriefing, "leverage_tasks" | "open_decisions" | "upcoming" | "insights">;
  label: string;
  icon: string;
  color: string;
}[] = [
  { key: "leverage_tasks", label: "Leverage Tasks", icon: "◆", color: C.cl },
  { key: "open_decisions", label: "Open Decisions", icon: "◇", color: C.gold },
  { key: "upcoming", label: "Upcoming", icon: "◷", color: C.gem },
  { key: "insights", label: "Insights", icon: "✦", color: C.gpt },
];

export default function DashboardPage() {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchBriefing = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<DailyBriefing>("/api/briefing/daily");
      setBriefing(data);
      setLastUpdated(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load briefing");
    } finally {
      setLoading(false);
    }
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div style={{ padding: "24px 28px", maxWidth: 820, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div>
          <h1
            style={{
              fontFamily: C.serif,
              fontStyle: "italic",
              fontSize: 26,
              color: C.cream,
              margin: 0,
              fontWeight: 400,
            }}
          >
            Command Center
          </h1>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textFaint, marginTop: 4 }}>{today}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastUpdated && (
            <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>
              Updated {new Date(lastUpdated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={fetchBriefing}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: loading ? C.card : C.surface,
              color: loading ? C.textDim : C.text,
              fontFamily: C.mono,
              fontSize: 11,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? <Spinner color={C.cl} size={12} /> : "↻"}
            {loading ? "Generating..." : "Generate Briefing"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: `${C.reminder}14`,
            border: `1px solid ${C.reminder}28`,
            color: C.reminder,
            fontFamily: C.mono,
            fontSize: 11,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* Briefing sections */}
      {briefing && (
        <div className="fadeUp" style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
          {SECTIONS.map(({ key, label, icon, color }) => {
            const items = briefing[key];
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
                        padding: "7px 14px",
                        fontSize: 12,
                        fontFamily: C.sans,
                        color: C.text,
                        lineHeight: 1.55,
                      }}
                    >
                      <span
                        style={{
                          color: C.textFaint,
                          flexShrink: 0,
                          fontFamily: C.mono,
                          fontSize: 10,
                          marginTop: 2,
                        }}
                      >
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
          {briefing.sources && briefing.sources.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "4px 0" }}>
              <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginRight: 4 }}>
                Sources:
              </span>
              {briefing.sources.map((s, i) => (
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

      {/* Empty state */}
      {!briefing && !loading && !error && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: C.textFaint,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
          <div style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 16, color: C.textDim, marginBottom: 6 }}>
            No briefing loaded
          </div>
          <div style={{ fontFamily: C.sans, fontSize: 12, color: C.textFaint, maxWidth: 340, margin: "0 auto" }}>
            Click &quot;Generate Briefing&quot; above, or your next briefing will generate automatically at 6 AM ET via the daily cron.
          </div>
        </div>
      )}

      {/* CEO Mode section */}
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            fontFamily: C.serif,
            fontStyle: "italic",
            fontSize: 15,
            color: C.cream,
            marginBottom: 12,
          }}
        >
          CEO Mode
        </div>
        <CeoMode />
      </div>
    </div>
  );
}
