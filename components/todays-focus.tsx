import { useState, useEffect } from "react";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";
import { GoalProgressCard, type GoalData } from "@/components/goal-progress-card";
import { Spinner } from "@/components/primitives";

interface FocusItem {
  id: string;
  title: string;
  priority: "urgent" | "high" | "medium" | "low";
  description: string;
  leverageReason?: string;
  pillar?: string;
  source?: string;
  linearUrl?: string;
  githubPrUrl?: string;
  goalId?: string;
}

export function TodaysFocus() {
  const [greeting, setGreeting] = useState("");
  const [focusItems, setFocusItems] = useState<FocusItem[]>([]);
  const [goalSpotlight, setGoalSpotlight] = useState<GoalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedWhy, setExpandedWhy] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadTodaysFocus();
    updateGreeting();
  }, []);

  const updateGreeting = () => {
    const hour = new Date().getHours();
    let greet = "Good morning";
    if (hour >= 12 && hour < 17) greet = "Good afternoon";
    else if (hour >= 17) greet = "Good evening";
    setGreeting(greet);
  };

  const loadTodaysFocus = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch high-priority tasks — use items[] for full data (linearUrl, leverage_reason, etc.)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tasksRes: any = await api("/api/tasks?state=started,unstarted&priority=1,2&limit=5");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawItems: any[] = tasksRes?.items ?? [];

      const items: FocusItem[] = rawItems.map((task) => ({
        id: task.id,
        title: task.title,
        priority: task.priority || "high",
        description: task.description || "",
        leverageReason: task.leverageReason || task.aiReason || undefined,
        pillar: undefined,
        source: task.sourceText || undefined,
        linearUrl: task.linearUrl || undefined,
        githubPrUrl: task.githubPrUrl || undefined,
        goalId: task.goalId || undefined,
      }));

      setFocusItems(items);

      // Fetch goals with pillar info — pick the one with nearest target_date
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const goalsRes: any = await api("/api/goals");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const goalsList: any[] = goalsRes?.goals ?? [];

      if (goalsList.length > 0) {
        // Pick the goal with the nearest upcoming target_date, or the highest-priority active one
        const now = new Date();
        const scored = goalsList
          .filter((g) => g.status === "active")
          .map((g) => {
            const targetDate = g.target_date ? new Date(g.target_date) : null;
            const daysUntil = targetDate ? Math.ceil((targetDate.getTime() - now.getTime()) / 86400000) : 999;
            const priorityScore = g.priority === "critical" ? 0 : g.priority === "high" ? 1 : g.priority === "medium" ? 2 : 3;
            return { goal: g, daysUntil, priorityScore };
          })
          .sort((a, b) => {
            // Nearest deadline first, then highest priority
            if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
            return a.priorityScore - b.priorityScore;
          });

        if (scored.length > 0) {
          const best = scored[0].goal;
          const pillarName = best.pillars?.name || "";
          const pillarEmoji = best.pillars?.emoji || "";

          setGoalSpotlight({
            id: best.id,
            title: best.title,
            pillar: pillarEmoji ? `${pillarEmoji} ${pillarName}` : pillarName,
            pillarColor: C.cl,
            progress: 0, // text-based metrics, not numeric percentage
            currentValue: best.progress_current || undefined,
            targetValue: best.progress_target || undefined,
            metricLabel: best.progress_metric || undefined,
            activeMethods: best.methods || [],
          });
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load today's focus");
      console.error("Error loading today's focus:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await api(`/api/tasks/${taskId}`, { method: "DELETE" });
      setFocusItems((prev) => prev.filter((item) => item.id !== taskId));
      setDeletingId(null);
    } catch (err: unknown) {
      console.error("Error deleting task:", err);
      setError("Failed to delete task");
    }
  };

  const toggleWhyExpanded = (taskId: string) => {
    setExpandedWhy((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const handleMarkDone = async (taskId: string) => {
    try {
      await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
      setFocusItems((prev) => prev.filter((item) => item.id !== taskId));
    } catch (err: unknown) {
      console.error("Error marking task done:", err);
      setError("Failed to mark task done");
    }
  };

  const handleSnooze = async (taskId: string) => {
    try {
      await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ snoozed_until: new Date(Date.now() + 3600000).toISOString() }) });
      setFocusItems((prev) => prev.filter((item) => item.id !== taskId));
    } catch (err: unknown) {
      console.error("Error snoozing task:", err);
      setError("Failed to snooze task");
    }
  };

  return (
    <div style={{ padding: "24px 20px", maxWidth: 800, margin: "0 auto" }}>
      {/* Greeting */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 28, fontWeight: 600, color: C.text, marginBottom: 4 }}>
          {greeting}
        </div>
      </div>

      {/* Goal Spotlight */}
      {goalSpotlight && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: C.textFaint, marginBottom: 8 }}>
            Goal Spotlight
          </div>
          <GoalProgressCard goal={goalSpotlight} />
        </div>
      )}

      {/* High-Leverage Actions */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: C.textFaint, marginBottom: 12 }}>
          High-Leverage Actions
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <Spinner />
          </div>
        ) : error ? (
          <div style={{ background: C.reminder + "20", border: `1px solid ${C.reminder}`, borderRadius: 8, padding: 12, color: C.reminder }}>
            {error}
          </div>
        ) : focusItems.length === 0 ? (
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "20px 16px",
              textAlign: "center",
              color: C.textDim,
            }}
          >
            All caught up! No high-leverage tasks right now.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {focusItems.map((item, index) => (
              <FocusCard
                key={item.id}
                item={item}
                index={index}
                onDelete={handleDeleteTask}
                onMarkDone={handleMarkDone}
                onSnooze={handleSnooze}
                isDeleting={deletingId === item.id}
                onDeleteClick={() => setDeletingId(item.id)}
                onCancelDelete={() => setDeletingId(null)}
                expandedWhy={expandedWhy}
                onToggleWhy={toggleWhyExpanded}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface FocusCardProps {
  item: FocusItem;
  index: number;
  onDelete: (id: string) => void;
  onMarkDone: (id: string) => void;
  onSnooze: (id: string) => void;
  isDeleting: boolean;
  onDeleteClick: () => void;
  onCancelDelete: () => void;
  expandedWhy: Set<string>;
  onToggleWhy: (id: string) => void;
}

function FocusCard(props: FocusCardProps) {
  const { item, onDelete, onMarkDone, onSnooze, isDeleting, onDeleteClick, onCancelDelete, expandedWhy, onToggleWhy } = props;
  const isExpanded = expandedWhy.has(item.id);
  const whyContent = item.leverageReason;
  const priorityColors: Record<string, string> = {
    urgent: C.reminder,
    high: C.task,
    medium: C.gem,
    low: C.textDim,
  };

  const hasExternalLink = item.linearUrl || item.githubPrUrl;

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "14px 16px",
        position: "relative",
      }}
    >
      {/* Header: Priority + Title + Delete Button */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: priorityColors[item.priority] || C.textDim,
            marginTop: 6,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: C.text, marginBottom: 4 }}>
            {item.title}
          </div>
        </div>
        {!isDeleting && (
          <button
            onClick={onDeleteClick}
            style={{
              background: "none",
              border: "none",
              color: C.textFaint,
              fontSize: 18,
              cursor: "pointer",
              padding: "4px 4px",
              marginTop: -2,
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.color = C.reminder;
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.color = C.textFaint;
            }}
            title="Delete task"
          >
            ×
          </button>
        )}
      </div>

      {/* Delete Confirmation */}
      {isDeleting && (
        <div
          style={{
            background: C.reminder + "15",
            border: `1px solid ${C.reminder}`,
            borderRadius: 6,
            padding: "10px 12px",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13, color: C.reminder, fontWeight: 500 }}>
            Delete this task?
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => onDelete(item.id)}
              style={{
                background: C.reminder,
                color: "white",
                border: "none",
                borderRadius: 4,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Yes
            </button>
            <button
              onClick={onCancelDelete}
              style={{
                background: C.surface,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Source badge */}
      {item.source && (
        <div style={{ marginBottom: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontStyle: "italic",
              color: C.textFaint,
            }}
          >
            {item.source}
          </span>
        </div>
      )}

      {/* Why High-Leverage? Section */}
      {whyContent && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => onToggleWhy(item.id)}
            style={{
              background: "none",
              border: "none",
              color: C.cl,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              padding: 0,
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 14 }}>{isExpanded ? "▼" : "▶"}</span>
            Why high-leverage?
          </button>
          {isExpanded && (
            <div
              style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: "10px 12px",
                fontSize: 13,
                color: C.text,
                fontStyle: "italic",
                lineHeight: 1.5,
              }}
            >
              {whyContent}
            </div>
          )}
        </div>
      )}

      {/* Action Row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {/* External link buttons */}
        {item.linearUrl && (
          <a
            href={item.linearUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: C.cl,
              color: "white",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              textDecoration: "none",
              flex: 1,
              textAlign: "center",
            }}
          >
            Open in Linear
          </a>
        )}
        {item.githubPrUrl && (
          <a
            href={item.githubPrUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: C.cl,
              color: "white",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              textDecoration: "none",
              flex: hasExternalLink && item.linearUrl ? undefined : 1,
              textAlign: "center",
            }}
          >
            Open PR
          </a>
        )}
        {!hasExternalLink && (
          <button
            onClick={() => onMarkDone(item.id)}
            style={{
              background: C.cl,
              color: "white",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              flex: 1,
            }}
          >
            Done
          </button>
        )}
        {hasExternalLink && (
          <button
            onClick={() => onMarkDone(item.id)}
            style={{
              background: C.surface,
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        )}
        <button
          onClick={() => onSnooze(item.id)}
          style={{
            background: C.surface,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Snooze
        </button>
      </div>
    </div>
  );
}
