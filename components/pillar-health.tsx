"use client";

import React, { useEffect, useState, useCallback } from "react";
import { C } from "@/lib/ui";
import { Spinner } from "@/components/primitives";
import { api } from "@/lib/client-api";
import { GoalProgressCompact, type GoalData } from "@/components/goal-progress-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PillarData {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** 0–100 aggregate health score */
  health: number;
  /** Summary line from latest briefing or computed */
  status?: string;
  /** Goals under this pillar */
  goals: GoalData[];
  /** How many active tasks are under this pillar */
  activeTaskCount: number;
  /** How many signals received in last 7 days */
  recentSignalCount: number;
}

// ---------------------------------------------------------------------------
// Pillar color map — matches seed_pillars_and_goals.sql
// ---------------------------------------------------------------------------

export const PILLAR_COLORS: Record<string, string> = {
  "Fitness & Athletics":   "#e07d4a",
  "Career & Instacart":    "#5d9ef8",
  "Ventures & BDHE":       "#41c998",
  "Financial":             "#f4c842",
  "Relationship & Family": "#ef7f7f",
  "Health & Recovery":     "#9ec8f5",
  "Content & Brand":       "#e07d4a",
  "Travel & Experiences":  "#6fcf9a",
  "Personal Growth":       "#5d9ef8",
  "Community & Impact":    "#41c998",
};

export const PILLAR_ICONS: Record<string, string> = {
  "Fitness & Athletics":   "◉",
  "Career & Instacart":    "▣",
  "Ventures & BDHE":       "◈",
  "Financial":             "◇",
  "Relationship & Family": "♡",
  "Health & Recovery":     "✦",
  "Content & Brand":       "✎",
  "Travel & Experiences":  "▸",
  "Personal Growth":       "◎",
  "Community & Impact":    "☍",
};

// ---------------------------------------------------------------------------
// Health indicator — ring-style gauge
// ---------------------------------------------------------------------------

function HealthRing({ health, color, size = 32 }: { health: number; color: string; size?: number }) {
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (health / 100) * circumference;

  // Color shifts based on health: < 30 = red, 30-60 = amber, > 60 = pillar color
  const ringColor = health < 30 ? C.reminder : health < 60 ? C.task : color;

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={`${color}15`}
        strokeWidth={strokeWidth}
      />
      {/* Progress ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={ringColor}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.8s ease" }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Single pillar row
// ---------------------------------------------------------------------------

function PillarRow({
  pillar,
  isExpanded,
  onToggle,
}: {
  pillar: PillarData;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        borderBottom: `1px solid ${C.border}`,
        transition: "background 0.15s",
      }}
    >
      {/* Clickable header */}
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          background: isExpanded ? `${pillar.color}06` : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {/* Health ring */}
        <HealthRing health={pillar.health} color={pillar.color} size={28} />

        {/* Pillar info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: C.serif,
              fontStyle: "italic",
              fontSize: 12,
              color: C.cream,
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: pillar.color, marginRight: 4 }}>{pillar.icon}</span>
            {pillar.name}
          </div>

          {pillar.status && (
            <div
              style={{
                fontFamily: C.mono,
                fontSize: 8,
                color: C.textDim,
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {pillar.status}
            </div>
          )}
        </div>

        {/* Counts */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, flexShrink: 0 }}>
          <span style={{ fontFamily: C.mono, fontSize: 9, color: pillar.color, fontWeight: 600 }}>
            {pillar.health}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {pillar.activeTaskCount > 0 && (
              <span style={{ fontFamily: C.mono, fontSize: 7, color: C.textFaint }}>
                {pillar.activeTaskCount}t
              </span>
            )}
            {pillar.recentSignalCount > 0 && (
              <span style={{ fontFamily: C.mono, fontSize: 7, color: C.textFaint }}>
                {pillar.recentSignalCount}s
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded: goals list */}
      {isExpanded && pillar.goals.length > 0 && (
        <div style={{ padding: "4px 12px 10px 48px" }}>
          {pillar.goals.map((goal) => (
            <GoalProgressCompact key={goal.id} goal={goal} />
          ))}
        </div>
      )}

      {isExpanded && pillar.goals.length === 0 && (
        <div style={{ padding: "8px 12px 10px 48px", fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>
          No goals tracked yet
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PillarHealth sidebar component
// ---------------------------------------------------------------------------

export function PillarHealth() {
  const [pillars, setPillars] = useState<PillarData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadPillars = useCallback(async () => {
    try {
      // Fetch goals grouped by pillar
      const data = await api<{ pillars: PillarData[] }>("/api/goals?withPillars=true");
      if (data.pillars) {
        setPillars(data.pillars);
      }
    } catch (e) {
      console.error("Failed to load pillars:", e);
      // Fallback: show pillar names without data
      setPillars(
        Object.entries(PILLAR_COLORS).map(([name, color]) => ({
          id: name,
          name,
          icon: PILLAR_ICONS[name] ?? "◈",
          color,
          health: 0,
          goals: [],
          activeTaskCount: 0,
          recentSignalCount: 0,
          status: "No data yet",
        }))
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPillars();
  }, [loadPillars]);

  // Listen for goal/task updates
  useEffect(() => {
    function handleRefresh() {
      loadPillars();
    }
    window.addEventListener("goals:refresh", handleRefresh);
    window.addEventListener("tasks:refresh", handleRefresh);
    return () => {
      window.removeEventListener("goals:refresh", handleRefresh);
      window.removeEventListener("tasks:refresh", handleRefresh);
    };
  }, [loadPillars]);

  // Aggregate health
  const overallHealth = pillars.length > 0
    ? Math.round(pillars.reduce((sum, p) => sum + p.health, 0) / pillars.length)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 12px 12px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h3
            style={{
              fontFamily: C.serif,
              fontStyle: "italic",
              fontSize: 14,
              color: C.cream,
              margin: 0,
              fontWeight: 400,
            }}
          >
            Life Pillars
          </h3>
          <div style={{ fontFamily: C.mono, fontSize: 8, color: C.textFaint, marginTop: 2 }}>
            {pillars.length} pillars · {pillars.reduce((s, p) => s + p.goals.length, 0)} goals
          </div>
        </div>

        {pillars.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <HealthRing health={overallHealth} color={C.cl} size={24} />
            <span style={{ fontFamily: C.mono, fontSize: 11, color: C.cl, fontWeight: 600 }}>
              {overallHealth}
            </span>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "24px 12px", color: C.textFaint }}>
          <Spinner color={C.cl} size={12} />
          <div style={{ fontFamily: C.mono, fontSize: 9, marginTop: 6 }}>Loading pillars…</div>
        </div>
      )}

      {/* Pillar list */}
      {!loading && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {pillars.map((pillar) => (
            <PillarRow
              key={pillar.id}
              pillar={pillar}
              isExpanded={expandedId === pillar.id}
              onToggle={() => setExpandedId(expandedId === pillar.id ? null : pillar.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
