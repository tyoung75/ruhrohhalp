"use client";

/**
 * Command Center — Life OS three-panel layout
 *
 * Architecture (Shneiderman's Mantra: Overview → Zoom → Details):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  CommandBar (persistent)                                     │
 *   ├──────────┬───────────────────────────┬───────────────────────┤
 *   │          │                           │                       │
 *   │  Pillar  │    Today's Focus          │   Signals & Insights  │
 *   │  Health  │                           │                       │
 *   │          │  • High-leverage actions   │   • Recommendations   │
 *   │  ◉ 82   │    with one-tap execute    │   • Insights          │
 *   │  ▣ 74   │  • Goal spotlight          │   • Proposals         │
 *   │  ◈ 91   │  • Upcoming timeline       │   • Alerts            │
 *   │  ◇ 68   │                           │   • Opportunities     │
 *   │  ...     │                           │                       │
 *   │          │                           │                       │
 *   ├──────────┴───────────────────────────┴───────────────────────┤
 *   │  AgentStatus (persistent)                                    │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Design principles applied:
 *  - Progressive Disclosure: Pillars collapse/expand to goals
 *  - Goal-Gradient Hypothesis: Progress bars intensify near completion
 *  - Nudge Theory (EAST): Every signal has a one-tap action
 *  - Fogg Behavior Model: Reduce friction to zero (one click to execute)
 *  - Chronotype awareness: Greeting + context shifts by time of day
 *  - Cognitive load: Max 5 focus items, categorized signals
 */

import { useState, useEffect } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { CommandBar } from "@/components/command-bar";
import { AgentStatus } from "@/components/agent-status";
import { PillarHealth } from "@/components/pillar-health";
import { TodaysFocus } from "@/components/todays-focus";
import { SignalsPanel } from "@/components/signals-panel";
import { BrainDumpModal } from "@/components/brain-dump-modal";
import { BriefingView } from "@/components/briefing-view";

function healthNumberToEnum(health: number): "strong" | "stable" | "at_risk" | "critical" {
  if (health >= 75) return "strong";
  if (health >= 50) return "stable";
  if (health >= 25) return "at_risk";
  return "critical";
}

export default function CommandConsolePage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pillars, setPillars] = useState<any[]>([]);
  const [pillarsLoading, setPillarsLoading] = useState(true);
  const [showBrainDump, setShowBrainDump] = useState(false);
  const [centerTab, setCenterTab] = useState<"focus" | "briefing">("focus");

  useEffect(() => {
    async function loadPillars() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res: any = await api("/api/goals?withPillars=true");
        const raw = res?.pillars ?? [];
        // Map API shape to PillarHealth component shape
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped = raw.map((p: any) => ({
          id: p.id,
          name: `${p.icon ?? ""} ${p.name}`.trim(),
          health: healthNumberToEnum(p.health ?? 0),
          goals: p.goals ?? [],
          recentActivities: [],
        }));
        setPillars(mapped);
      } catch (err) {
        console.error("Failed to load pillars:", err);
      } finally {
        setPillarsLoading(false);
      }
    }
    void loadPillars();
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: C.bg,
        color: C.text,
        fontFamily: C.sans,
      }}
    >
      {/* Command Bar — persistent at top */}
      <div style={{ flexShrink: 0 }}>
        <CommandBar />
      </div>

      {/* Main content — three columns */}
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          background: C.bg,
        }}
      >
        {/* Left: Pillar Health (220px fixed) */}
        <div
          style={{
            width: 220,
            flexShrink: 0,
            overflowY: "auto",
            borderRight: `1px solid ${C.border}`,
            background: C.surface,
          }}
        >
          <PillarHealth pillars={pillars} loading={pillarsLoading} />
        </div>

        {/* Center: Tabbed panel (flex, takes remaining space) */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            borderRight: `1px solid ${C.border}`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Tab bar + Brain Dump button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              borderBottom: `1px solid ${C.border}`,
              padding: "0 28px",
              flexShrink: 0,
            }}
          >
            {(["focus", "briefing"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setCenterTab(tab)}
                style={{
                  padding: "10px 16px",
                  background: "none",
                  border: "none",
                  borderBottom: centerTab === tab ? `2px solid ${C.cl}` : "2px solid transparent",
                  color: centerTab === tab ? C.cream : C.textDim,
                  fontFamily: C.mono,
                  fontSize: 11,
                  fontWeight: centerTab === tab ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {tab === "focus" ? "Today's Focus" : "Briefing"}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setShowBrainDump(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                background: `${C.cl}14`,
                border: `1px solid ${C.cl}30`,
                borderRadius: 6,
                color: C.cl,
                fontFamily: C.mono,
                fontSize: 10,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              ◈ Brain Dump
            </button>
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {centerTab === "focus" ? (
              <div style={{ padding: "24px 28px", maxWidth: 720 }}>
                <TodaysFocus />
              </div>
            ) : (
              <div style={{ padding: "24px 28px", maxWidth: 720, display: "flex", flexDirection: "column", minHeight: "100%" }}>
                <BriefingView />
              </div>
            )}
          </div>
        </div>

        {/* Brain Dump Modal */}
        <BrainDumpModal open={showBrainDump} onClose={() => setShowBrainDump(false)} />

        {/* Right: Signals & Insights (300px fixed) */}
        <div
          style={{
            width: 300,
            flexShrink: 0,
            overflowY: "auto",
            background: C.surface,
          }}
        >
          <div style={{ padding: "16px 14px" }}>
            <SignalsPanel />
          </div>
        </div>
      </div>

      {/* Agent Status — persistent at bottom */}
      <div style={{ flexShrink: 0 }}>
        <AgentStatus />
      </div>
    </div>
  );
}
