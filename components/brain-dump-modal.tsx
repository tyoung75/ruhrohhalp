"use client";

import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";

interface BrainDumpGoal {
  title: string;
  milestone: string;
}

interface ExistingGoal {
  id: string;
  title: string;
  progress_metric: string | null;
  progress_current: string | null;
  progress_target: string | null;
}

interface BrainDumpModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const MAX_GOALS = 8;

export function BrainDumpModal({ open, onClose, onSaved }: BrainDumpModalProps) {
  const [goals, setGoals] = useState<BrainDumpGoal[]>([
    { title: "", milestone: "" },
  ]);
  const [weeklyContext, setWeeklyContext] = useState("");
  const [topOfMind, setTopOfMind] = useState("");
  const [existingGoals, setExistingGoals] = useState<ExistingGoal[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadExisting = useCallback(async () => {
    try {
      const res = await api<{
        dump: {
          goals: string;
          weekly_context: string;
          top_of_mind: string;
        } | null;
        goals: ExistingGoal[];
      }>("/api/brain/dump");

      setExistingGoals(res.goals ?? []);

      if (res.dump) {
        let parsedGoals: BrainDumpGoal[] = [];
        try {
          const raw = typeof res.dump.goals === "string"
            ? JSON.parse(res.dump.goals)
            : res.dump.goals;
          if (Array.isArray(raw)) parsedGoals = raw;
        } catch { /* ignore parse error */ }

        if (parsedGoals.length > 0) {
          setGoals(parsedGoals);
        } else if (res.goals.length > 0) {
          setGoals(
            res.goals.slice(0, 4).map((g) => ({
              title: g.title,
              milestone: g.progress_target ?? "",
            }))
          );
        }
        setWeeklyContext(res.dump.weekly_context ?? "");
        setTopOfMind(res.dump.top_of_mind ?? "");
      } else if (res.goals.length > 0) {
        setGoals(
          res.goals.slice(0, 4).map((g) => ({
            title: g.title,
            milestone: g.progress_target ?? "",
          }))
        );
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
      setGoals((prev) => [...prev, { title: "", milestone: "" }]);
    }
  };

  const removeGoal = (index: number) => {
    if (goals.length > 1) {
      setGoals((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const nonEmptyGoals = goals.filter((g) => g.title.trim());
      await api("/api/brain/dump", {
        method: "POST",
        body: JSON.stringify({
          goals: nonEmptyGoals,
          weeklyContext,
          topOfMind,
        }),
      });

      // Trigger refreshes across the app
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

  const priorityColors = [C.cl, C.cl, "#f4c842", "#41c998", C.gem, C.textDim, C.textDim, C.textDim];

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
          maxWidth: 620,
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
            <div style={{ fontFamily: C.sans, fontSize: 15, fontWeight: 600, color: C.cream, marginBottom: 4 }}>
              Top Goals Right Now
            </div>
            <div style={{ fontFamily: C.sans, fontSize: 11, color: C.textDim, marginBottom: 14 }}>
              What are you trying to achieve? These become your north stars.
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
                      width: 24,
                      textAlign: "right",
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}.
                  </span>
                  <input
                    type="text"
                    value={goal.title}
                    onChange={(e) => updateGoal(i, "title", e.target.value)}
                    placeholder="Goal title..."
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
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = `${C.cl}60`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = C.border;
                    }}
                  />
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <select
                      value={goal.milestone}
                      onChange={(e) => updateGoal(i, "milestone", e.target.value)}
                      style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        padding: "10px 12px",
                        color: C.textDim,
                        fontFamily: C.sans,
                        fontSize: 11,
                        outline: "none",
                        cursor: "pointer",
                        appearance: "none",
                        paddingRight: 28,
                        width: 160,
                      }}
                    >
                      <option value="">Milestone...</option>
                      {existingGoals.map((eg) => (
                        <option key={eg.id} value={eg.progress_target ?? eg.title}>
                          {(eg.progress_target ?? eg.title).slice(0, 30)}
                        </option>
                      ))}
                      {goal.milestone && !existingGoals.some((eg) =>
                        (eg.progress_target ?? eg.title) === goal.milestone
                      ) && (
                        <option value={goal.milestone}>{goal.milestone.slice(0, 30)}</option>
                      )}
                    </select>
                    <span
                      style={{
                        position: "absolute",
                        right: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: C.textFaint,
                        fontSize: 10,
                        pointerEvents: "none",
                      }}
                    >
                      ▾
                    </span>
                  </div>
                  {goals.length > 1 && (
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
                  )}
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
                  padding: "8px 0 0 32px",
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
