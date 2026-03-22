import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";
import { OneTapAction, MarkDoneAction, type ActionType } from "@/components/one-tap-action";
import { GoalProgressCard, type GoalData } from "@/components/goal-progress-card";
import { Spinner } from "@/components/primitives";

interface FocusItem {
  id: string;
  title: string;
  priority: "urgent" | "high" | "medium" | "low";
  rationale: string;
  leverageReason?: string;
  pillar?: string;
  source?: string;
  estimate?: string;
  actions?: ActionType[];
}

interface GoalSpotlight {
  id: string;
  title: string;
  progress: number;
  metric: string;
  deadline: string;
}

export function TodaysFocus() {
  const router = useRouter();
  const [greeting, setGreeting] = useState("");
  const [timelineStatus, setTimelineStatus] = useState("");
  const [focusItems, setFocusItems] = useState<FocusItem[]>([]);
  const [goalSpotlight, setGoalSpotlight] = useState<GoalSpotlight | null>(null);
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

      // Fetch high-leverage tasks
      const tasksResponse = await api.get("/api/tasks", {
        params: {
          filter: "high_leverage",
          status: "pending",
        },
      });

      const items: FocusItem[] = tasksResponse.data.map((task: any) => ({
        id: task.id,
        title: task.title,
        priority: task.priority || "high",
        rationale: task.rationale || "",
        leverageReason: task.leverage_reason,
        pillar: task.pillar,
        source: task.source,
        estimate: task.estimate_minutes,
        actions: task.actions || [],
      }));

      setFocusItems(items);

      // Fetch goal spotlight
      const goalsResponse = await api.get("/api/goals", {
        params: { spotlight: true, limit: 1 },
      });

      if (goalsResponse.data && goalsResponse.data.length > 0) {
        const goal = goalsResponse.data[0];
        setGoalSpotlight({
          id: goal.id,
          title: goal.title,
          progress: goal.progress || 0,
          metric: goal.metric || "",
          deadline: goal.deadline || "",
        });
      }

      // Fetch timeline status
      const timelineResponse = await api.get("/api/timeline/status");
      setTimelineStatus(timelineResponse.data?.status || "On track");
    } catch (err: any) {
      setError(err.message || "Failed to load today's focus");
      console.error("Error loading today's focus:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await api.delete(`/api/tasks/${taskId}`);
      setFocusItems((prev) => prev.filter((item) => item.id !== taskId));
      setDeletingId(null);
    } catch (err: any) {
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
      await api.patch(`/api/tasks/${taskId}`, { status: "done" });
      setFocusItems((prev) => prev.filter((item) => item.id !== taskId));
    } catch (err: any) {
      console.error("Error marking task done:", err);
      setError("Failed to mark task done");
    }
  };

  const handleSnooze = async (taskId: string) => {
    try {
      await api.patch(`/api/tasks/${taskId}`, { snoozed_until: new Date(Date.now() + 3600000).toISOString() });
      setFocusItems((prev) => prev.filter((item) => item.id !== taskId));
    } catch (err: any) {
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
        <div style={{ fontSize: 14, color: C.textDim }}>
          {timelineStatus && `Timeline: ${timelineStatus}`}
        </div>
      </div>

      {/* Goal Spotlight */}
      {goalSpotlight && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: C.textFaint, marginBottom: 8 }}>
            Goal Spotlight
          </div>
          <GoalProgressCard
            goal={{
              id: goalSpotlight.id,
              title: goalSpotlight.title,
              progress: goalSpotlight.progress,
              metric: goalSpotlight.metric,
              deadline: goalSpotlight.deadline,
            }}
          />
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

function FocusCard({
  item,
  index,
  onDelete,
  onMarkDone,
  onSnooze,
  isDeleting,
  onDeleteClick,
  onCancelDelete,
  expandedWhy,
  onToggleWhy,
}: FocusCardProps) {
  const isExpanded = expandedWhy.has(item.id);
  const whyContent = item.leverageReason || item.rationale;
  const priorityColors: Record<string, string> = {
    urgent: C.reminder,
    high: C.task,
    medium: C.gem,
    low: C.textDim,
  };

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
      {/* Header: Priority + Title + Estimate + Delete Button */}
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
        {item.estimate && (
          <div
            style={{
              fontSize: 12,
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              padding: "4px 8px",
              color: C.textDim,
              whiteSpace: "nowrap",
            }}
          >
            {item.estimate}m
          </div>
        )}
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

      {/* Pillar + Source */}
      {(item.pillar || item.source) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 12, color: C.textDim }}>
          {item.pillar && (
            <span
              style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                padding: "3px 8px",
              }}
            >
              {item.pillar}
            </span>
          )}
          {item.source && (
            <span style={{ fontSize: 11, fontStyle: "italic", color: C.textFaint }}>
              {item.source}
            </span>
          )}
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
