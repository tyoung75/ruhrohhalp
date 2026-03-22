"use client";

import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";

interface GoalOption {
  id: string;
  title: string;
}

interface GoalEntry {
  goalId?: string;
  text: string;
}

interface BrainDumpModalProps {
  open: boolean;
  onClose: () => void;
}

export function BrainDumpModal({ open, onClose }: BrainDumpModalProps) {
  const [topGoals, setTopGoals] = useState<GoalEntry[]>([
    { text: "" },
    { text: "" },
    { text: "" },
  ]);
  const [thisWeek, setThisWeek] = useState("");
  const [topOfMind, setTopOfMind] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [goals, setGoals] = useState<GoalOption[]>([]);
  const [loadingPrevious, setLoadingPrevious] = useState(false);

  // Load existing goals for the dropdown
  const loadGoals = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await api("/api/goals");
      const list = (res?.goals ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((g: any) => g.status === "active")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((g: any) => ({ id: g.id, title: g.title }));
      setGoals(list);
    } catch {
      // Goals dropdown is optional — fail silently
    }
  }, []);

  // Load the most recent brain dump to pre-populate
  const loadPrevious = useCallback(async () => {
    try {
      setLoadingPrevious(true);
      const res = await api<{ latest: { topGoals?: string; thisWeek?: string; topOfMind?: string } }>("/api/brain/dump");
      const { latest } = res;
      if (latest?.topGoals) {
        const lines = latest.topGoals.split("\n").filter((l) => l.trim());
        const entries = lines.map((line) => ({
          text: line.replace(/^\d+\.\s*/, "").trim(),
        }));
        // Pad to 3
        while (entries.length < 3) entries.push({ text: "" });
        setTopGoals(entries.slice(0, 5));
      }
      if (latest?.thisWeek) setThisWeek(latest.thisWeek);
      if (latest?.topOfMind) setTopOfMind(latest.topOfMind);
    } catch {
      // No previous dump — that's fine
    } finally {
      setLoadingPrevious(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadGoals();
      loadPrevious();
      setSaved(false);
      setError("");
    }
  }, [open, loadGoals, loadPrevious]);

  async function handleSubmit() {
    const filledGoals = topGoals.filter((g) => g.text.trim());
    if (!filledGoals.length && !thisWeek.trim() && !topOfMind.trim()) {
      setError("Fill in at least one section");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await api("/api/brain/dump", {
        method: "POST",
        body: JSON.stringify({
          topGoals: filledGoals.length ? filledGoals : undefined,
          thisWeek: thisWeek.trim() || undefined,
          topOfMind: topOfMind.trim() || undefined,
        }),
      });

      setSaved(true);

      // Trigger refreshes across the app
      window.dispatchEvent(new CustomEvent("briefing:refresh"));
      window.dispatchEvent(new CustomEvent("tasks:refresh"));

      // Auto-close after a beat
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save brain dump");
    } finally {
      setSaving(false);
    }
  }

  function updateGoal(index: number, field: "text" | "goalId", value: string) {
    setTopGoals((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addGoalRow() {
    if (topGoals.length < 5) {
      setTopGoals((prev) => [...prev, { text: "" }]);
    }
  }

  if (!open) return null;

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
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          width: "100%",
          maxWidth: 600,
          maxHeight: "85vh",
          overflowY: "auto",
          padding: "28px 32px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600, color: C.cream, margin: 0, fontFamily: C.serif }}>
              Brain Dump
            </h2>
            <p style={{ fontSize: 12, color: C.textDim, margin: "4px 0 0", fontFamily: C.mono }}>
              Tell tylerOS what matters right now. This shapes your briefings, priorities, and signals.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: C.textDim,
              fontSize: 20,
              cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {loadingPrevious ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: C.textFaint }}>
            <Spinner color={C.cl} size={14} />
            <div style={{ fontFamily: C.mono, fontSize: 10, marginTop: 8 }}>Loading previous dump...</div>
          </div>
        ) : (
          <>
            {/* Section 1: Top Goals */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>
                Top Goals Right Now
              </label>
              <p style={{ fontSize: 11, color: C.textDim, margin: "0 0 10px", fontFamily: C.mono }}>
                What are you trying to achieve? These become your north stars.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {topGoals.map((goal, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: C.cl, fontFamily: C.mono, fontSize: 12, width: 18, flexShrink: 0 }}>
                      {i + 1}.
                    </span>
                    <input
                      type="text"
                      value={goal.text}
                      onChange={(e) => updateGoal(i, "text", e.target.value)}
                      placeholder={i === 0 ? "e.g. Close Series A term sheet" : i === 1 ? "e.g. Ship v2 of the product" : "e.g. Hire a head of engineering"}
                      style={{
                        flex: 1,
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        padding: "8px 12px",
                        fontFamily: C.mono,
                        fontSize: 12,
                        color: C.text,
                        outline: "none",
                      }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = C.cl; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
                    />
                    {goals.length > 0 && (
                      <select
                        value={goal.goalId || ""}
                        onChange={(e) => updateGoal(i, "goalId", e.target.value)}
                        style={{
                          background: C.card,
                          border: `1px solid ${C.border}`,
                          borderRadius: 6,
                          padding: "8px 6px",
                          fontFamily: C.mono,
                          fontSize: 10,
                          color: goal.goalId ? C.text : C.textDim,
                          width: 130,
                          outline: "none",
                        }}
                      >
                        <option value="">Link goal...</option>
                        {goals.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.title.length > 20 ? g.title.slice(0, 20) + "..." : g.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
              {topGoals.length < 5 && (
                <button
                  onClick={addGoalRow}
                  style={{
                    background: "none",
                    border: "none",
                    color: C.cl,
                    fontSize: 11,
                    fontFamily: C.mono,
                    cursor: "pointer",
                    padding: "4px 0",
                    marginTop: 4,
                  }}
                >
                  + add another
                </button>
              )}
            </div>

            {/* Section 2: This Week */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>
                What&apos;s Going On This Week
              </label>
              <p style={{ fontSize: 11, color: C.textDim, margin: "0 0 10px", fontFamily: C.mono }}>
                Key meetings, deadlines, launches, travel, anything time-sensitive.
              </p>
              <textarea
                value={thisWeek}
                onChange={(e) => setThisWeek(e.target.value)}
                placeholder={"Monday: Investor call with a]16z\nWednesday: Product review for v2 launch\nFriday: Team offsite planning due"}
                rows={4}
                style={{
                  width: "100%",
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "10px 12px",
                  fontFamily: C.mono,
                  fontSize: 12,
                  color: C.text,
                  outline: "none",
                  resize: "vertical",
                  lineHeight: 1.6,
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = C.cl; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
              />
            </div>

            {/* Section 3: Top of Mind */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>
                Top of Mind
              </label>
              <p style={{ fontSize: 11, color: C.textDim, margin: "0 0 10px", fontFamily: C.mono }}>
                What&apos;s weighing on you? Worries, ideas, things you keep thinking about.
              </p>
              <textarea
                value={topOfMind}
                onChange={(e) => setTopOfMind(e.target.value)}
                placeholder={"Burn rate is higher than expected — need to revisit runway model\nHearing good things about competitor X, need to differentiate\nShould we pivot the go-to-market strategy?"}
                rows={4}
                style={{
                  width: "100%",
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "10px 12px",
                  fontFamily: C.mono,
                  fontSize: 12,
                  color: C.text,
                  outline: "none",
                  resize: "vertical",
                  lineHeight: 1.6,
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = C.cl; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
              />
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
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

            {/* Success */}
            {saved && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: `${C.gpt}14`,
                  border: `1px solid ${C.gpt}28`,
                  color: C.gpt,
                  fontFamily: C.mono,
                  fontSize: 11,
                  marginBottom: 16,
                }}
              >
                Brain dump saved. Your briefings and signals will now reflect these priorities.
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={onClose}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "10px 20px",
                  color: C.textDim,
                  fontFamily: C.mono,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || saved}
                style={{
                  background: saving || saved ? C.border : C.cl,
                  border: "none",
                  borderRadius: 6,
                  padding: "10px 24px",
                  color: saving || saved ? C.textDim : C.bg,
                  fontFamily: C.mono,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: saving || saved ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {saving ? (
                  <>
                    <Spinner color={C.textDim} size={10} /> Saving...
                  </>
                ) : saved ? (
                  "Saved"
                ) : (
                  "Save & Update"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
