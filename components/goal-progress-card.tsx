"use client";

import React, { useState } from "react";
import { C } from "@/lib/ui";
import { OneTapAction, type ActionType } from "@/components/one-tap-action";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoalData {
  id: string;
  title: string;
  pillar: string;
  pillarColor: string;
  /** 0–100 percentage */
  progress: number;
  /** Current metric value (e.g. "12:45 pace", "$4,200", "320 subs") */
  currentValue?: string;
  /** Target metric (e.g. "sub-3:10", "$10,000", "400 subs") */
  targetValue?: string;
  /** Metric label (e.g. "marathon pace", "MRR", "subscribers") */
  metricLabel?: string;
  /** Recent data points for sparkline (last 7-14 values) */
  trend?: number[];
  /** Methods being used (from science-backed methods array) */
  activeMethods?: string[];
  /** Suggested next action */
  nextAction?: {
    label: string;
    actionType: ActionType;
    context: string;
    taskId?: string;
  };
  /** Days since last progress signal */
  staleDays?: number;
}

// ---------------------------------------------------------------------------
// Sparkline — pure SVG, no dependencies
// ---------------------------------------------------------------------------

function Sparkline({
  data,
  color,
  width = 80,
  height = 24,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p}`).join(" ");

  // Gradient fill under the line
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const fillD = `${pathD} L ${lastPoint.split(",")[0]},${height} L ${firstPoint.split(",")[0]},${height} Z`;

  return (
    <svg width={width} height={height} style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={`spark-grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#spark-grad-${color.replace("#", "")})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Dot on last value */}
      <circle
        cx={parseFloat(lastPoint.split(",")[0])}
        cy={parseFloat(lastPoint.split(",")[1])}
        r="2"
        fill={color}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Progress bar — Goal-Gradient effect (color shifts as you get closer)
// ---------------------------------------------------------------------------

function ProgressBar({ progress, color }: { progress: number; color: string }) {
  // Goal-Gradient Hypothesis: motivation increases as you approach the goal
  // Visual feedback: bar brightens and gets a glow as progress increases
  const clamped = Math.max(0, Math.min(100, progress));
  const intensity = 0.3 + (clamped / 100) * 0.7; // 0.3 → 1.0
  const glowSize = Math.floor(clamped / 25); // 0–4px glow

  return (
    <div
      style={{
        width: "100%",
        height: 4,
        background: `${color}15`,
        borderRadius: 2,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          width: `${clamped}%`,
          height: "100%",
          background: color,
          borderRadius: 2,
          opacity: intensity,
          boxShadow: glowSize > 0 ? `0 0 ${glowSize * 2}px ${color}40` : "none",
          transition: "width 0.6s ease, opacity 0.3s ease",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stale indicator
// ---------------------------------------------------------------------------

function StaleIndicator({ days }: { days: number }) {
  if (days <= 3) return null;
  const severity = days > 14 ? C.reminder : days > 7 ? C.task : C.textDim;
  const label = days > 14 ? "Stale" : days > 7 ? "Aging" : "Quiet";

  return (
    <span
      style={{
        fontFamily: C.mono,
        fontSize: 8,
        color: severity,
        background: `${severity}14`,
        border: `1px solid ${severity}25`,
        borderRadius: 3,
        padding: "1px 4px",
        letterSpacing: 0.3,
      }}
    >
      {label} · {days}d
    </span>
  );
}

// ---------------------------------------------------------------------------
// GoalProgressCard
// ---------------------------------------------------------------------------

export function GoalProgressCard({ goal }: { goal: GoalData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        transition: "border-color 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${goal.pillarColor}40`)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
    >
      {/* Top row: title + sparkline */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Pillar badge */}
          <div
            style={{
              fontFamily: C.mono,
              fontSize: 8,
              color: goal.pillarColor,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              marginBottom: 3,
            }}
          >
            {goal.pillar}
          </div>

          {/* Goal title */}
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              fontFamily: C.serif,
              fontStyle: "italic",
              fontSize: 13,
              color: C.cream,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
              lineHeight: 1.4,
            }}
          >
            {goal.title}
          </button>
        </div>

        {/* Sparkline */}
        {goal.trend && goal.trend.length >= 2 && (
          <Sparkline data={goal.trend} color={goal.pillarColor} />
        )}
      </div>

      {/* Progress bar + metrics */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <ProgressBar progress={goal.progress} color={goal.pillarColor} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: C.mono, fontSize: 10, color: goal.pillarColor, fontWeight: 600 }}>
              {goal.progress}%
            </span>
            {goal.currentValue && (
              <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textDim }}>
                {goal.currentValue}
                {goal.targetValue && ` → ${goal.targetValue}`}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {goal.staleDays !== undefined && <StaleIndicator days={goal.staleDays} />}
          </div>
        </div>
      </div>

      {/* Expanded: methods + next action */}
      {expanded && (
        <div
          style={{
            borderTop: `1px solid ${C.border}`,
            paddingTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Active methods */}
          {goal.activeMethods && goal.activeMethods.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {goal.activeMethods.map((method, i) => (
                <span
                  key={i}
                  style={{
                    fontFamily: C.mono,
                    fontSize: 8,
                    color: C.textDim,
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 3,
                    padding: "2px 6px",
                    letterSpacing: 0.2,
                  }}
                >
                  {method}
                </span>
              ))}
            </div>
          )}

          {/* Next action */}
          {goal.nextAction && (
            <OneTapAction
              label={goal.nextAction.label}
              actionType={goal.nextAction.actionType}
              context={goal.nextAction.context}
              taskId={goal.nextAction.taskId}
              color={goal.pillarColor}
              size="sm"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact variant for use inside pillar sidebar
// ---------------------------------------------------------------------------

export function GoalProgressCompact({ goal }: { goal: GoalData }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "4px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span
          style={{
            fontFamily: C.sans,
            fontSize: 11,
            color: C.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {goal.title}
        </span>
        <span style={{ fontFamily: C.mono, fontSize: 9, color: goal.pillarColor, flexShrink: 0, marginLeft: 8 }}>
          {goal.progress}%
        </span>
      </div>
      <ProgressBar progress={goal.progress} color={goal.pillarColor} />
    </div>
  );
}
