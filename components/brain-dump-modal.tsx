"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";

const LIFE_PILLARS = [
  "Ventures & BDHE",
  "Fitness & Athletics",
  "Content & Brand",
  "Financial",
  "Career & Instacart",
  "Relationship & Family",
  "Health & Recovery",
  "Travel & Experiences",
  "Personal Growth",
  "Community & Impact",
] as const;

const DEFAULT_GOALS: BrainDumpGoal[] = [
  {
    pillar: "Ventures & BDHE",
    text: "Get Motus live on the App Store and reach first paying traction. Milestone: 50 active paying subscribers within 30 days of approval.",
  },
  {
    pillar: "Fitness & Athletics",
    text: "Run sub-40min 10k by May 28th. Milestone: 41:30 or faster 10k time trial by April 30th.",
  },
  {
    pillar: "Content & Brand",
    text: "Reach 10k total followers by June 30th. Milestone: 5,000 followers + 1 brand deal in pipeline by May 1st.",
  },
  {
    pillar: "Financial",
    text: "Generate $3k/month supplemental income by June 30th. Milestone: Motus MRR \u2265 $500 + 1 paid brand deal closed by April 30th.",
  },
];

interface BrainDumpGoal {
  pillar: string;
  text: string;
}

interface BrainDumpModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const MAX_GOALS = 10;

export function BrainDumpModal({ open, onClose, onSaved }: BrainDumpModalProps) {
  const [goals, setGoals] = useState<BrainDumpGoal[]>(DEFAULT_GOALS);
  const [weeklyContext, setWeeklyContext] = useState("");
  const [topOfMind, setTopOfMind] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const goalsLoadedFromDb = useRef(false);

  const loadExisting = useCallback(async () => {
    try {
      const res = await api<{
        dump: {
          goals: string;
          weekly_context: string;
          top_of_mind: string;
        } | null;
        pinnedGoals: BrainDumpGoal[] | null;
      }>("/api/brain/dump");

      // Load pinned goals (separate from weekly dump)
      if (res.pinnedGoals && res.pinnedGoals.length > 0) {
        setGoals(res.pinnedGoals);
        goalsLoadedFromDb.current = true;
      }
      // else keep DEFAULT_GOALS

      // Load weekly context from latest dump
      if (res.dump) {
        setWeeklyContext(res.dump.weekly_context ?? "");
        setTopOfMind(res.dump.top_of_mind ?? "");
      }
    } catch (err) {
      console.error("Failed to load brain dump:", err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (open && !loaded) {
      void loadExisting();
    }
  }, [open, loaded, loadExisting]);

  const updateGoal = (index: number, field: keyof BrainDumpGoal, value: string) => {
    setGoals((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addGoal = () => {
    if (goals.length < MAX_GOALS) {
      setGoals((prev) => [...prev, { pillar: "", text: "" }]);
    }
  };

  const removeGoal = (index: number) => {
    setGoals((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const nonEmptyGoals = goals.filter((g) => g.text.trim());
      await api("/api/brain/dump", {
        method: "POST",
        body: JSON.stringify({
          goals: nonEmptyGoals,
          weeklyContext,
          topOfMind,
        }),
      });

      window.dispatchEvent(new CustomEvent("briefing:refresh"));
      window.dispatchEvent(new CustomEvent("tasks:refresh"));

      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process brain dump");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const priorityColors = [C.cl, C.cl, "#f4c842", "#41c998", C.gem, C.textDim, C.textDim, C.textDim, C.textDim, C.textDim];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: C.bg,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          width: "100%",
          maxWidth: 720,
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            padding: "24px 28px 16px",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontFamily: C.serif, fontSize: 26, fontStyle: "italic", color: C.cream }}>
              Brain Dump
            </div>
            <div style={{ fontFamily: C.sans, fontSize: 12, color: C.textDim, marginTop: 4, lineHeight: 1.5 }}>
              Tell tylerOS what matters right now. This shapes your briefings, priorities, and signals.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: C.textDim,
              fontSize: 20,
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 24px" }}>
          {/* Top Goals */}
          <section style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div style={{ fontFamily: C.sans, fontSize: 15, fontWeight: 600, color: C.cream }}>
                Top Goals Right Now
              </div>
              <span
                style={{
                  fontFamily: C.mono,
                  fontSize: 10,
                  color: C.gold,
                  background: `${C.gold}18`,
                  border: `1px solid ${C.gold}30`,
                  borderRadius: 4,
                  padding: "2px 7px",
                  letterSpacing: 0.5,
                }}
              >
                Q2 2026
              </span>
            </div>
            <div style={{ fontFamily: C.sans, fontSize: 11, color: C.textDim, marginBottom: 14 }}>
              Pinned quarterly goals. Edit manually — these don&apos;t reset on weekly saves.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {goals.map((goal, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontFamily: C.mono,
                      fontSize: 12,
                      color: priorityColors[i] ?? C.textDim,
                      fontWeight: 600,
                      width: 20,
                      textAlign: "right",
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}.
                  </span>
                  {/* Pillar pill selector */}
                  <PillarSelector
                    value={goal.pillar}
                    onChange={(v) => updateGoal(i, "pillar", v)}
                  />
                  {/* Goal + milestone text */}
                  <input
                    type="text"
                    value={goal.text}
                    onChange={(e) => updateGoal(i, "text", e.target.value)}
                    placeholder="Goal + milestone..."
                    style={{
                      flex: 1,
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      color: C.cream,
                      fontFamily: C.sans,
                      fontSize: 13,
                      outline: "none",
                      minWidth: 0,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = `${C.cl}60`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = C.border;
                    }}
                  />
                  <button
                    onClick={() => removeGoal(i)}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.textFaint,
                      fontSize: 14,
                      cursor: "pointer",
                      padding: "4px",
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {goals.length < MAX_GOALS && (
              <button
                onClick={addGoal}
                style={{
                  background: "none",
                  border: "none",
                  color: C.cl,
                  fontFamily: C.sans,
                  fontSize: 12,
                  cursor: "pointer",
                  padding: "8px 0 0 28px",
                }}
              >
                + add another
              </button>
            )}
          </section>

          {/* Weekly Context */}
          <section style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: C.sans, fontSize: 15, fontWeight: 600, color: C.cream, marginBottom: 4 }}>
              What&apos;s Going On This Week
            </div>
            <div style={{ fontFamily: C.sans, fontSize: 11, color: C.textDim, marginBottom: 10 }}>
              Key meetings, deadlines, launches, travel, anything time-sensitive.
            </div>
            <textarea
              value={weeklyContext}
              onChange={(e) => setWeeklyContext(e.target.value)}
              placeholder="This week I'm..."
              rows={4}
              style={{
                width: "100%",
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "12px 14px",
                color: C.text,
                fontFamily: C.sans,
                fontSize: 13,
                lineHeight: 1.6,
                outline: "none",
                resize: "vertical",
                minHeight: 80,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = `${C.cl}60`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = C.border;
              }}
            />
          </section>

          {/* Top of Mind */}
          <section style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: C.sans, fontSize: 15, fontWeight: 600, color: C.cream, marginBottom: 4 }}>
              Top of Mind
            </div>
            <div style={{ fontFamily: C.sans, fontSize: 11, color: C.textDim, marginBottom: 10 }}>
              What&apos;s weighing on you? Worries, ideas, things you keep thinking about.
            </div>
            <textarea
              value={topOfMind}
              onChange={(e) => setTopOfMind(e.target.value)}
              placeholder="I keep thinking about..."
              rows={4}
              style={{
                width: "100%",
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "12px 14px",
                color: C.text,
                fontFamily: C.sans,
                fontSize: 13,
                lineHeight: 1.6,
                outline: "none",
                resize: "vertical",
                minHeight: 80,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = `${C.cl}60`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = C.border;
              }}
            />
          </section>

          {/* Error */}
          {error && (
            <div
              style={{
                background: `${C.reminder}14`,
                border: `1px solid ${C.reminder}30`,
                borderRadius: 8,
                padding: "10px 14px",
                color: C.reminder,
                fontFamily: C.sans,
                fontSize: 12,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            padding: "16px 28px",
            borderTop: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "10px 20px",
              color: C.textDim,
              fontFamily: C.sans,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: C.cl,
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              color: "#0f1117",
              fontFamily: C.sans,
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Saving..." : "Save & Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Pillar Pill Selector ───────────────────────────────────────────── */

function PillarSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const display = value || "Pillar...";
  const hasValue = !!value;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setDropdownOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: hasValue ? `${C.cl}14` : C.card,
          border: `1px solid ${hasValue ? `${C.cl}40` : C.border}`,
          borderRadius: 20,
          padding: "7px 14px 7px 12px",
          color: hasValue ? C.cl : C.textDim,
          fontFamily: C.sans,
          fontSize: 11,
          fontWeight: hasValue ? 600 : 400,
          cursor: "pointer",
          whiteSpace: "nowrap",
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          outline: "none",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{display}</span>
        <span style={{ fontSize: 8, opacity: 0.6, flexShrink: 0 }}>▾</span>
      </button>

      {dropdownOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 1010,
            background: C.surface,
            border: `1px solid ${C.borderMid}`,
            borderRadius: 10,
            padding: "6px 0",
            minWidth: 210,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {LIFE_PILLARS.map((pillar) => {
            const selected = pillar === value;
            return (
              <button
                key={pillar}
                type="button"
                onClick={() => {
                  onChange(pillar);
                  setDropdownOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: selected ? `${C.cl}18` : "transparent",
                  border: "none",
                  padding: "8px 16px",
                  color: selected ? C.cl : C.text,
                  fontFamily: C.sans,
                  fontSize: 12,
                  fontWeight: selected ? 600 : 400,
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!selected) e.currentTarget.style.background = C.cardHov;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = selected ? `${C.cl}18` : "transparent";
                }}
              >
                {pillar}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
