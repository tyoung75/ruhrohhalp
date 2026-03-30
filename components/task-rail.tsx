"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";

// ---------------------------------------------------------------------------
// Task Reply Panel — inline reply for individual task cards
// ---------------------------------------------------------------------------

interface TaskReply {
  id: string;
  reply: string;
  applied: boolean;
  created_at: string;
}

function TaskReplyPanel({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const [replies, setReplies] = useState<TaskReply[]>([]);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await api<{ replies: TaskReply[] }>(`/api/tasks/${taskId}/replies`);
        setReplies(res.replies ?? []);
      } catch {
        // Silent
      } finally {
        setLoaded(true);
      }
    }
    load();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [taskId]);

  const handleSubmit = async () => {
    if (!replyText.trim()) return;
    setSubmitting(true);
    try {
      const res = await api<{ reply: TaskReply }>(`/api/tasks/${taskId}/replies`, {
        method: "POST",
        body: JSON.stringify({ reply: replyText.trim() }),
      });
      setReplies((prev) => [res.reply, ...prev]);
      setReplyText("");
    } catch (e) {
      console.error("Failed to submit task reply:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "now";
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    return `${Math.floor(diffHr / 24)}d`;
  };

  return (
    <div
      style={{
        borderTop: `1px solid ${C.border}`,
        padding: "6px 0 2px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Existing replies */}
      {loaded && replies.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {replies.slice(0, 3).map((r) => (
            <div
              key={r.id}
              style={{
                background: `${C.cl}08`,
                border: `1px solid ${C.cl}15`,
                borderRadius: 4,
                padding: "4px 6px",
                fontSize: 9,
                color: C.text,
                lineHeight: 1.4,
              }}
            >
              {r.reply}
              <span style={{ fontFamily: C.mono, fontSize: 7, color: C.textFaint, marginLeft: 6 }}>
                {formatTime(r.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ display: "flex", gap: 3 }}>
        <input
          ref={inputRef}
          type="text"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
            if (e.key === "Escape") onClose();
          }}
          placeholder="Reply to this task..."
          disabled={submitting}
          style={{
            flex: 1,
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 3,
            padding: "4px 6px",
            fontSize: 9,
            color: C.text,
            fontFamily: C.sans,
            outline: "none",
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={submitting || !replyText.trim()}
          style={{
            background: submitting ? C.surface : `${C.cl}14`,
            border: `1px solid ${submitting ? C.border : `${C.cl}30`}`,
            color: submitting ? C.textDim : C.cl,
            borderRadius: 3,
            padding: "3px 6px",
            fontSize: 8,
            fontFamily: C.mono,
            cursor: submitting ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {submitting ? "…" : "Send"}
        </button>
      </div>
      <div style={{ fontFamily: C.mono, fontSize: 7, color: C.textFaint }}>
        Feedback shapes task prioritization. Esc to close.
      </div>
    </div>
  );
}

interface Task {
  id: string;
  identifier: string;
  title: string;
  project_name: string;
  project_color: string;
  priority_num: number;
  due_date?: string;
  state: string;
}

interface TasksResponse {
  tasks: Task[];
}

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "P1 Urgent", color: C.reminder },
  2: { label: "P2 High", color: C.gold },
  3: { label: "P3 Normal", color: C.text },
  4: { label: "P4 Low", color: C.textDim },
};

export function TaskRail() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedPriorities, setExpandedPriorities] = useState<Set<number>>(new Set([1, 2, 3]));
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [replyOpenTaskId, setReplyOpenTaskId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<TasksResponse>("/api/tasks?state=backlog,unstarted,started");
      setTasks(data.tasks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Listen for refresh events from command bar, briefing actions, etc.
  useEffect(() => {
    function handleRefresh() {
      loadTasks();
    }
    window.addEventListener("tasks:refresh", handleRefresh);
    return () => window.removeEventListener("tasks:refresh", handleRefresh);
  }, [loadTasks]);

  async function handleTaskAction(taskId: string, action: "done" | "cancel") {
    try {
      await api(`/api/tasks/${taskId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      // Remove the task from the list
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (e) {
      console.error(`Task action error:`, e);
    }
  }

  function togglePriority(priority: number) {
    const next = new Set(expandedPriorities);
    if (next.has(priority)) {
      next.delete(priority);
    } else {
      next.add(priority);
    }
    setExpandedPriorities(next);
  }

  function isOverdue(dueDate: string | undefined): boolean {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
  }

  function isToday(dueDate: string | undefined): boolean {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    const today = new Date();
    return due.toDateString() === today.toDateString();
  }

  function formatDueDate(dueDate: string | undefined): string {
    if (!dueDate) return "";
    const due = new Date(dueDate);
    if (isToday(dueDate)) return "Today";
    if (isOverdue(dueDate)) return "Overdue";
    return due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // Group tasks by priority
  const grouped = new Map<number, Task[]>();
  for (let p = 1; p <= 4; p++) {
    grouped.set(
      p,
      tasks.filter((t) => t.priority_num === p)
    );
  }

  const totalOpen = tasks.length;

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: C.textDim }}>
        <Spinner color={C.cl} size={16} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 16 }}>
      {/* Header */}
      <div style={{ paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
        <h2
          style={{
            fontFamily: C.serif,
            fontStyle: "italic",
            fontSize: 18,
            color: C.cream,
            margin: 0,
            fontWeight: 400,
          }}
        >
          Tasks
        </h2>
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            background: `${C.reminder}14`,
            border: `1px solid ${C.reminder}28`,
            color: C.reminder,
            fontFamily: C.mono,
            fontSize: 9,
          }}
        >
          {error}
        </div>
      )}

      {/* Empty state */}
      {totalOpen === 0 && !error && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: C.textFaint }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>☐</div>
          <div style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 13, color: C.textDim }}>
            All clear
          </div>
        </div>
      )}

      {/* Priority groups */}
      {totalOpen > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflow: "auto" }}>
          {[1, 2, 3, 4].map((priority) => {
            const priorityTasks = grouped.get(priority) || [];
            if (priorityTasks.length === 0) return null;

            const isExpanded = expandedPriorities.has(priority);
            const meta = PRIORITY_LABELS[priority];

            return (
              <div key={priority} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {/* Priority header */}
                <button
                  onClick={() => togglePriority(priority)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 8px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      fontFamily: C.mono,
                      fontSize: 9,
                      color: meta.color,
                      fontWeight: 600,
                      minWidth: 40,
                    }}
                  >
                    {meta.label}
                  </span>
                  <span
                    style={{
                      fontFamily: C.mono,
                      fontSize: 8,
                      color: C.textFaint,
                      background: C.surface,
                      padding: "1px 4px",
                      borderRadius: 3,
                      marginLeft: "auto",
                    }}
                  >
                    {priorityTasks.length}
                  </span>
                  <span
                    style={{
                      fontFamily: C.mono,
                      fontSize: 9,
                      color: C.textFaint,
                      transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                      transition: "transform 0.2s",
                    }}
                  >
                    ▼
                  </span>
                </button>

                {/* Priority tasks */}
                {isExpanded && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {priorityTasks.map((task) => (
                      <div
                        key={task.id}
                        onMouseEnter={() => setHoveredTaskId(task.id)}
                        onMouseLeave={() => setHoveredTaskId(null)}
                        style={{
                          background: hoveredTaskId === task.id ? C.cardHov : C.card,
                          border: `1px solid ${C.border}`,
                          borderRadius: 6,
                          padding: "8px 10px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          cursor: "default",
                        }}
                      >
                        {/* Task identifier and title */}
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minHeight: 20 }}>
                          <span
                            style={{
                              fontFamily: C.mono,
                              fontSize: 9,
                              color: C.textDim,
                              flexShrink: 0,
                              marginTop: 1,
                            }}
                          >
                            {task.identifier}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              fontFamily: C.sans,
                              color: C.text,
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {task.title}
                          </span>
                        </div>

                        {/* Project and due date */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9 }}>
                          <span
                            style={{
                              fontFamily: C.mono,
                              padding: "1px 6px",
                              borderRadius: 3,
                              background: task.project_color + "14",
                              color: task.project_color,
                              border: `1px solid ${task.project_color}28`,
                            }}
                          >
                            {task.project_name}
                          </span>
                          {task.due_date && (
                            <span
                              style={{
                                fontFamily: C.mono,
                                color: isOverdue(task.due_date) ? C.reminder : isToday(task.due_date) ? C.gold : C.textFaint,
                              }}
                            >
                              {formatDueDate(task.due_date)}
                            </span>
                          )}
                          {hoveredTaskId === task.id && (
                            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReplyOpenTaskId(replyOpenTaskId === task.id ? null : task.id);
                                }}
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: 3,
                                  background: replyOpenTaskId === task.id ? `${C.cl}14` : C.surface,
                                  border: `1px solid ${replyOpenTaskId === task.id ? `${C.cl}35` : C.border}`,
                                  color: replyOpenTaskId === task.id ? C.cl : C.textDim,
                                  fontFamily: C.mono,
                                  fontSize: 8,
                                  cursor: "pointer",
                                }}
                                title="Reply to this task"
                              >
                                ↩
                              </button>
                              <button
                                onClick={() => handleTaskAction(task.id, "done")}
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: 3,
                                  background: `${C.todo}14`,
                                  border: `1px solid ${C.todo}35`,
                                  color: C.todo,
                                  fontFamily: C.mono,
                                  fontSize: 8,
                                  cursor: "pointer",
                                }}
                              >
                                ✓
                              </button>
                              <button
                                onClick={() => handleTaskAction(task.id, "cancel")}
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: 3,
                                  background: `${C.reminder}14`,
                                  border: `1px solid ${C.reminder}35`,
                                  color: C.reminder,
                                  fontFamily: C.mono,
                                  fontSize: 8,
                                  cursor: "pointer",
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Inline reply panel */}
                        {replyOpenTaskId === task.id && (
                          <TaskReplyPanel
                            taskId={task.id}
                            onClose={() => setReplyOpenTaskId(null)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          padding: "8px 0",
          borderTop: `1px solid ${C.border}`,
          fontFamily: C.mono,
          fontSize: 9,
          color: C.textFaint,
          textAlign: "center",
        }}
      >
        {totalOpen} open
      </div>
    </div>
  );
}
