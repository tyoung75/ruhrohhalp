"use client";

import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import type { WorkoutType } from "@/lib/types/domain";

/* ── Types ─────────────────────────────────────────────────────────── */

interface ScheduledWorkout {
  id: string;
  title: string;
  workout_type: WorkoutType;
  scheduled_date: string;
  sort_order: number;
  notes: string;
  completed_at: string | null;
  goal_id: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkoutsResponse {
  workouts: ScheduledWorkout[];
}

interface PatchResponse {
  workout: ScheduledWorkout;
  warning?: string;
}

interface CreateResponse {
  workout: ScheduledWorkout;
}

/* ── Constants ─────────────────────────────────────────────────────── */

const WORKOUT_TYPE_COLORS: Record<WorkoutType, string> = {
  strength: "#e07d4a",
  run: "#41c998",
  cross_training: "#5d9ef8",
  recovery: "#9ec8f5",
  other: "#f4c842",
};

const WORKOUT_TYPE_LABELS: Record<WorkoutType, string> = {
  strength: "Strength",
  run: "Run",
  cross_training: "Cross Training",
  recovery: "Recovery",
  other: "Other",
};

const WORKOUT_TYPES: WorkoutType[] = ["strength", "run", "cross_training", "recovery", "other"];

/* ── Helpers ───────────────────────────────────────────────────────── */

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/* ── Add Workout Form ──────────────────────────────────────────────── */

function AddWorkoutForm({
  date,
  onAdd,
  onCancel,
}: {
  date: string;
  onAdd: (title: string, type: WorkoutType) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<WorkoutType>("strength");

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.borderMid}`,
        borderRadius: 8,
        padding: 10,
        marginTop: 6,
      }}
    >
      <input
        autoFocus
        placeholder="Workout name..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) onAdd(title.trim(), type);
          if (e.key === "Escape") onCancel();
        }}
        style={{
          width: "100%",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          padding: "6px 8px",
          color: C.text,
          fontFamily: C.sans,
          fontSize: 12,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
        {WORKOUT_TYPES.map((wt) => (
          <button
            key={wt}
            onClick={() => setType(wt)}
            style={{
              background: type === wt ? WORKOUT_TYPE_COLORS[wt] + "30" : "transparent",
              border: `1px solid ${type === wt ? WORKOUT_TYPE_COLORS[wt] : C.border}`,
              borderRadius: 4,
              padding: "2px 6px",
              fontSize: 10,
              fontFamily: C.mono,
              color: type === wt ? WORKOUT_TYPE_COLORS[wt] : C.textDim,
              cursor: "pointer",
            }}
          >
            {WORKOUT_TYPE_LABELS[wt]}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          onClick={() => title.trim() && onAdd(title.trim(), type)}
          style={{
            flex: 1,
            background: C.cl,
            border: "none",
            borderRadius: 6,
            padding: "5px 0",
            fontSize: 11,
            fontFamily: C.sans,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Add
        </button>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            background: "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "5px 0",
            fontSize: 11,
            fontFamily: C.sans,
            color: C.textDim,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Reschedule Popover ────────────────────────────────────────────── */

function ReschedulePopover({
  workout,
  onMove,
  onClose,
}: {
  workout: ScheduledWorkout;
  onMove: (id: string, newDate: string) => void;
  onClose: () => void;
}) {
  const [dateValue, setDateValue] = useState(workout.scheduled_date);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.borderMid}`,
          borderRadius: 12,
          padding: 20,
          width: 320,
          maxWidth: "90vw",
        }}
      >
        <div style={{ fontFamily: C.sans, fontSize: 14, color: C.cream, marginBottom: 4 }}>
          Reschedule Workout
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textDim, marginBottom: 16 }}>
          {workout.title}
        </div>

        <label style={{ fontFamily: C.sans, fontSize: 11, color: C.textDim, display: "block", marginBottom: 6 }}>
          Move to date
        </label>
        <input
          type="date"
          value={dateValue}
          onChange={(e) => setDateValue(e.target.value)}
          style={{
            width: "100%",
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "8px 10px",
            color: C.text,
            fontFamily: C.mono,
            fontSize: 13,
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={() => {
              if (dateValue && dateValue !== workout.scheduled_date) {
                onMove(workout.id, dateValue);
              }
              onClose();
            }}
            style={{
              flex: 1,
              background: C.cl,
              border: "none",
              borderRadius: 6,
              padding: "8px 0",
              fontSize: 12,
              fontFamily: C.sans,
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Move
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "8px 0",
              fontSize: 12,
              fontFamily: C.sans,
              color: C.textDim,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Workout Card ──────────────────────────────────────────────────── */

function WorkoutCard({
  workout,
  onReschedule,
  onToggleComplete,
  onDelete,
}: {
  workout: ScheduledWorkout;
  onReschedule: (w: ScheduledWorkout) => void;
  onToggleComplete: (w: ScheduledWorkout) => void;
  onDelete: (id: string) => void;
}) {
  const color = WORKOUT_TYPE_COLORS[workout.workout_type] || C.textDim;
  const done = !!workout.completed_at;

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 6,
        padding: "8px 10px",
        marginBottom: 4,
        opacity: done ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {/* Complete checkbox */}
        <input
          type="checkbox"
          checked={done}
          onChange={() => onToggleComplete(workout)}
          style={{ accentColor: color, cursor: "pointer", flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: C.sans,
              fontSize: 12,
              color: done ? C.textDim : C.cream,
              textDecoration: done ? "line-through" : "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {workout.title}
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 9, color, marginTop: 2 }}>
            {WORKOUT_TYPE_LABELS[workout.workout_type]}
          </div>
        </div>
        {/* Actions */}
        <button
          onClick={() => onReschedule(workout)}
          title="Reschedule"
          style={{
            background: "transparent",
            border: "none",
            color: C.textDim,
            cursor: "pointer",
            fontSize: 13,
            padding: "2px 4px",
            lineHeight: 1,
          }}
        >
          {'>>'}
        </button>
        <button
          onClick={() => onDelete(workout.id)}
          title="Delete"
          style={{
            background: "transparent",
            border: "none",
            color: C.textFaint,
            cursor: "pointer",
            fontSize: 13,
            padding: "2px 4px",
            lineHeight: 1,
          }}
        >
          x
        </button>
      </div>
      {workout.notes && (
        <div style={{ fontFamily: C.sans, fontSize: 10, color: C.textDim, marginTop: 4, marginLeft: 22 }}>
          {workout.notes}
        </div>
      )}
    </div>
  );
}

/* ── Toast ─────────────────────────────────────────────────────────── */

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#f4c842",
        color: "#1a1d27",
        fontFamily: C.sans,
        fontSize: 13,
        padding: "10px 20px",
        borderRadius: 8,
        zIndex: 2000,
        cursor: "pointer",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      }}
      onClick={onDismiss}
    >
      {message}
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────────── */

export function WorkoutSchedule() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [workouts, setWorkouts] = useState<ScheduledWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingForDate, setAddingForDate] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<ScheduledWorkout | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const days = getWeekDays(weekStart);
  const from = toDateStr(days[0]);
  const to = toDateStr(days[6]);

  const fetchWorkouts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<WorkoutsResponse>(`/api/workouts?from=${from}&to=${to}`);
      setWorkouts(res.workouts);
    } catch {
      setWorkouts([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchWorkouts();
  }, [fetchWorkouts]);

  const navigateWeek = (delta: number) => {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + 7 * delta);
      return next;
    });
  };

  const goToday = () => setWeekStart(getWeekStart(new Date()));

  /* ── Actions ─── */

  const handleAdd = async (date: string, title: string, type: WorkoutType) => {
    setAddingForDate(null);
    try {
      const res = await api<CreateResponse>("/api/workouts", {
        method: "POST",
        body: JSON.stringify({ title, workout_type: type, scheduled_date: date }),
      });
      setWorkouts((prev) => [...prev, res.workout]);
    } catch {
      setToast("Failed to add workout");
    }
  };

  const handleMove = async (id: string, newDate: string) => {
    try {
      const res = await api<PatchResponse>(`/api/workouts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ scheduled_date: newDate }),
      });
      setWorkouts((prev) => prev.map((w) => (w.id === id ? res.workout : w)));
      if (res.warning) {
        setToast(res.warning);
      }
    } catch {
      setToast("Failed to move workout");
    }
  };

  const handleToggleComplete = async (workout: ScheduledWorkout) => {
    const completed_at = workout.completed_at ? null : new Date().toISOString();
    try {
      const res = await api<PatchResponse>(`/api/workouts/${workout.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed_at }),
      });
      setWorkouts((prev) => prev.map((w) => (w.id === workout.id ? res.workout : w)));
    } catch {
      setToast("Failed to update workout");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api<{ ok: boolean }>(`/api/workouts/${id}`, { method: "DELETE" });
      setWorkouts((prev) => prev.filter((w) => w.id !== id));
    } catch {
      setToast("Failed to delete workout");
    }
  };

  /* ── Render ─── */

  const todayStr = toDateStr(new Date());

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      {rescheduling && (
        <ReschedulePopover
          workout={rescheduling}
          onMove={handleMove}
          onClose={() => setRescheduling(null)}
        />
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: C.serif,
            fontSize: 24,
            fontStyle: "italic",
            color: C.cream,
            margin: 0,
          }}
        >
          Workout Schedule
        </h1>
        <div style={{ flex: 1 }} />
        <button onClick={() => navigateWeek(-1)} style={navBtnStyle}>
          &larr;
        </button>
        <button onClick={goToday} style={{ ...navBtnStyle, fontSize: 11, padding: "6px 12px" }}>
          Today
        </button>
        <button onClick={() => navigateWeek(1)} style={navBtnStyle}>
          &rarr;
        </button>
      </div>

      {/* Week grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 8,
          minHeight: 400,
        }}
      >
        {days.map((day) => {
          const dateStr = toDateStr(day);
          const isToday = dateStr === todayStr;
          const dayWorkouts = workouts
            .filter((w) => w.scheduled_date === dateStr)
            .sort((a, b) => a.sort_order - b.sort_order);

          return (
            <div
              key={dateStr}
              style={{
                background: C.card,
                border: `1px solid ${isToday ? C.cl + "60" : C.border}`,
                borderRadius: 10,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                minHeight: 200,
              }}
            >
              {/* Day header */}
              <div
                style={{
                  fontFamily: C.mono,
                  fontSize: 11,
                  color: isToday ? C.cl : C.textDim,
                  marginBottom: 8,
                  fontWeight: isToday ? 700 : 400,
                }}
              >
                {formatDayLabel(day)}
              </div>

              {/* Workout count badge */}
              {dayWorkouts.length >= 3 && (
                <div
                  style={{
                    fontFamily: C.mono,
                    fontSize: 9,
                    color: "#f4c842",
                    background: "#f4c84218",
                    borderRadius: 4,
                    padding: "2px 6px",
                    marginBottom: 6,
                    textAlign: "center",
                  }}
                >
                  {dayWorkouts.length} workouts — heavy day
                </div>
              )}

              {/* Cards */}
              <div style={{ flex: 1 }}>
                {loading ? (
                  <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>...</div>
                ) : (
                  dayWorkouts.map((w) => (
                    <WorkoutCard
                      key={w.id}
                      workout={w}
                      onReschedule={setRescheduling}
                      onToggleComplete={handleToggleComplete}
                      onDelete={handleDelete}
                    />
                  ))
                )}
              </div>

              {/* Add button */}
              {addingForDate === dateStr ? (
                <AddWorkoutForm
                  date={dateStr}
                  onAdd={(title, type) => handleAdd(dateStr, title, type)}
                  onCancel={() => setAddingForDate(null)}
                />
              ) : (
                <button
                  onClick={() => setAddingForDate(dateStr)}
                  style={{
                    background: "transparent",
                    border: `1px dashed ${C.border}`,
                    borderRadius: 6,
                    padding: "6px 0",
                    fontSize: 11,
                    fontFamily: C.sans,
                    color: C.textFaint,
                    cursor: "pointer",
                    marginTop: 4,
                  }}
                >
                  + Add
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
        {WORKOUT_TYPES.map((wt) => (
          <div key={wt} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: WORKOUT_TYPE_COLORS[wt],
              }}
            />
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim }}>
              {WORKOUT_TYPE_LABELS[wt]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Shared styles ─────────────────────────────────────────────────── */

const navBtnStyle: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 14,
  color: C.textDim,
  cursor: "pointer",
  fontFamily: C.sans,
};
