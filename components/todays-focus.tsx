import { useState, useEffect } from "react";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";
import { GoalProgressCard, type GoalData } from "@/components/goal-progress-card";
import { Spinner } from "@/components/primitives";
import { buildFingerprint } from "@/lib/signal-fingerprint";

// AI tool config for launch buttons
const AI_TOOLS: Record<string, { label: string; icon: string; color: string; urlPrefix: string }> = {
  claude: { label: "Open in Claude", icon: "◈", color: C.cl, urlPrefix: "https://claude.ai/new" },
  chatgpt: { label: "Open in ChatGPT", icon: "◉", color: "#10a37f", urlPrefix: "https://chatgpt.com" },
  gemini: { label: "Open in Gemini", icon: "◇", color: "#4285f4", urlPrefix: "https://gemini.google.com/app" },
};

// Friendly source labels
const SOURCE_LABELS: Record<string, string> = {
  linear_import: "imported task",
  manual: "manually added",
  cowork: "from cowork",
  api: "via API",
  command: "from command bar",
};

// Pillar-to-color mapping for visual variety in spotlight
const PILLAR_COLORS: Record<string, string> = {
  "Ventures & BDHE": C.cl,
  "Fitness & Athletics": "#41c998",
  "Content & Brand": "#5d9ef8",
  "Financial": "#f4c842",
  "Career & Instacart": C.gem,
  "Relationship & Family": "#e06b9e",
  "Health & Recovery": "#41c998",
  "Travel & Experiences": "#b07de0",
  "Personal Growth": C.cl,
  "Community & Impact": "#6fcf9a",
};

interface PinnedGoal {
  pillar: string;
  text: string;
}

interface FocusItem {
  id: string;
  title: string;
  priority: "urgent" | "high" | "medium" | "low";
  description: string;
  leverageReason?: string;
  source?: string;
  recommendedAI?: string;
  howTo?: string;
  goalId?: string;
  // CW-1: New fields from ranked endpoint
  priorityScore?: number;
  goalTitle?: string;
  pillarName?: string;
  state?: string;
}

// CW-2: Dismiss reason options
const DISMISS_REASONS = [
  { value: "not_relevant", label: "Not relevant" },
  { value: "already_done", label: "Already done" },
  { value: "wrong_timing", label: "Wrong timing" },
  { value: "too_hard", label: "Too complex" },
  { value: "other", label: "Just close" },
] as const;

type DismissReason = typeof DISMISS_REASONS[number]["value"];

export function TodaysFocus() {
  const [greeting, setGreeting] = useState("");
  const [focusItems, setFocusItems] = useState<FocusItem[]>([]);
  const [goalSpotlights, setGoalSpotlights] = useState<GoalData[]>([]);
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

      // CW-1: Try ranked endpoint first, fall back to legacy fetch
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rankedTasks: any[] | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rankedRes = await api<any>("/api/tasks?ranked=true&limit=3&state=started,unstarted,backlog");
        if (rankedRes?.tasks?.length > 0 && rankedRes.tasks[0].priority_score != null) {
          rankedTasks = rankedRes.tasks;
        }
      } catch {
        // Ranked endpoint not deployed yet, fall back to legacy
      }

      // Fetch pinned goals from brain dump + tasks (legacy fallback) + goals in parallel
      const [brainRes, tasksRes, goalsRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        api<any>("/api/brain/dump"),
        // Only fetch legacy tasks if ranked endpoint didn't work
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rankedTasks ? Promise.resolve({ items: [] }) : api<any>("/api/tasks?state=started,unstarted&priority=1,2&limit=8"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        api<any>("/api/goals"),
      ]);

      // --- Build Goal Spotlight from pinned brain dump goals ---
      const pinnedGoals: PinnedGoal[] = brainRes?.pinnedGoals ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dbGoals: any[] = goalsRes?.goals ?? [];

      if (pinnedGoals.length > 0) {
        const spotlights: GoalData[] = pinnedGoals.map((pinned, idx) => {
          // Try to match this pinned goal to a DB goal for progress data
          const matched = dbGoals.find((g) => {
            const pillarMatch = g.pillars?.name && pinned.pillar
              .toLowerCase().includes(g.pillars.name.toLowerCase().slice(0, 8));
            const titleMatch = pinned.text.toLowerCase().includes(g.title?.toLowerCase().slice(0, 20));
            return pillarMatch || titleMatch;
          });

          const pillarColor = PILLAR_COLORS[pinned.pillar] ?? C.cl;

          return {
            id: matched?.id ?? `pinned-${idx}`,
            title: pinned.text,
            pillar: pinned.pillar,
            pillarColor,
            progress: matched ? computeProgress(matched) : 0,
            currentValue: matched?.progress_current ?? undefined,
            targetValue: matched?.progress_target ?? undefined,
            metricLabel: matched?.progress_metric ?? undefined,
            activeMethods: matched?.methods ?? [],
          };
        });

        setGoalSpotlights(spotlights);
      } else if (dbGoals.length > 0) {
        // Fallback: pick the goal with nearest target date (old behavior)
        const now = new Date();
        const active = dbGoals
          .filter((g) => g.status === "active")
          .sort((a, b) => {
            const da = a.target_date ? Math.abs(new Date(a.target_date).getTime() - now.getTime()) : Infinity;
            const db = b.target_date ? Math.abs(new Date(b.target_date).getTime() - now.getTime()) : Infinity;
            return da - db;
          });
        if (active.length > 0) {
          const best = active[0];
          const pillarName = best.pillars?.name || "";
          const pillarEmoji = best.pillars?.emoji || "";
          setGoalSpotlights([{
            id: best.id,
            title: best.title,
            pillar: pillarEmoji ? `${pillarEmoji} ${pillarName}` : pillarName,
            pillarColor: C.cl,
            progress: computeProgress(best),
            currentValue: best.progress_current || undefined,
            targetValue: best.progress_target || undefined,
            metricLabel: best.progress_metric || undefined,
            activeMethods: best.methods || [],
          }]);
        }
      }

      // --- CW-1: Use ranked tasks if available, otherwise fall back to legacy scoring ---
      if (rankedTasks && rankedTasks.length > 0) {
        // Ranked endpoint provides pre-scored tasks with ai_metadata
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items: FocusItem[] = rankedTasks.map((task: any) => ({
          id: task.id,
          title: task.title,
          priority: task.priority || "high",
          description: task.description || "",
          leverageReason: task.ai_metadata?.leverage_reason || task.leverageReason || task.aiReason || undefined,
          source: task.sourceText || task.source || undefined,
          recommendedAI: task.recommendedAI || "claude",
          howTo: task.howTo || undefined,
          goalId: task.goal_id || task.goalId || undefined,
          priorityScore: task.priority_score ?? undefined,
          goalTitle: task.goals?.title || undefined,
          pillarName: task.goals?.pillars?.name || undefined,
          state: task.state || undefined,
        }));

        // CW-1: If leverage_reason is null, poll once after 3 seconds
        const needsPolling = items.some(item => !item.leverageReason);
        setFocusItems(items);

        if (needsPolling) {
          setTimeout(async () => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const refreshRes = await api<any>("/api/tasks?ranked=true&limit=3&state=started,unstarted,backlog");
              if (refreshRes?.tasks?.length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const refreshed: FocusItem[] = refreshRes.tasks.map((task: any) => ({
                  id: task.id,
                  title: task.title,
                  priority: task.priority || "high",
                  description: task.description || "",
                  leverageReason: task.ai_metadata?.leverage_reason || task.leverageReason || undefined,
                  source: task.sourceText || task.source || undefined,
                  recommendedAI: task.recommendedAI || "claude",
                  howTo: task.howTo || undefined,
                  goalId: task.goal_id || task.goalId || undefined,
                  priorityScore: task.priority_score ?? undefined,
                  goalTitle: task.goals?.title || undefined,
                  pillarName: task.goals?.pillars?.name || undefined,
                  state: task.state || undefined,
                }));
                setFocusItems(refreshed);
              }
            } catch {
              // Silent fail on poll
            }
          }, 3000);
        }
      } else {
        // Legacy scoring fallback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawItems: any[] = tasksRes?.items ?? [];

        const pinnedGoalIds = new Set<string>();
        const goalKeywords: string[] = [];
        for (const pinned of pinnedGoals) {
          const terms = pinned.text.toLowerCase()
            .split(/[\s,.:;]+/)
            .filter((w) => w.length > 4)
            .slice(0, 6);
          goalKeywords.push(...terms);

          const matched = dbGoals.find((g) => {
            const pillarMatch = g.pillars?.name && pinned.pillar
              .toLowerCase().includes(g.pillars.name.toLowerCase().slice(0, 8));
            const titleMatch = pinned.text.toLowerCase().includes(g.title?.toLowerCase().slice(0, 20));
            return pillarMatch || titleMatch;
          });
          if (matched) pinnedGoalIds.add(matched.id);
        }

        const priorityScoreMap: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };

        const items: FocusItem[] = rawItems.map((task) => ({
          id: task.id,
          title: task.title,
          priority: task.priority || "high",
          description: task.description || "",
          leverageReason: task.leverageReason || task.aiReason || undefined,
          source: task.sourceText || undefined,
          recommendedAI: task.recommendedAI || "claude",
          howTo: task.howTo || undefined,
          goalId: task.goalId || undefined,
        }));

        const scored = items.map((item) => {
          let score = 0;
          if (item.goalId && pinnedGoalIds.has(item.goalId)) score += 10;
          if (goalKeywords.length > 0) {
            const haystack = `${item.title} ${item.description} ${item.leverageReason ?? ""}`.toLowerCase();
            const matches = goalKeywords.filter((kw) => haystack.includes(kw)).length;
            score += Math.min(matches, 6);
          }
          score += priorityScoreMap[item.priority] ?? 1;
          return { item, score };
        });

        scored.sort((a, b) => b.score - a.score);
        setFocusItems(scored.slice(0, 5).map((s) => s.item));
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

  // CW-2: Dismiss with reason + persist as signal fingerprint
  const handleDismiss = async (taskId: string, reason: DismissReason) => {
    // Find the task title for persistent signal dismissal
    const task = focusItems.find((item) => item.id === taskId);
    try {
      await api(`/api/tasks/${taskId}/dismiss`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      // Also save as persistent signal dismissal so it doesn't resurface in briefings
      if (task) {
        try {
          await api("/api/signals/dismiss", {
            method: "POST",
            body: JSON.stringify({
              text: task.title,
              category: "focus_task",
              source: "todays_focus",
            }),
          });
        } catch {
          // Non-critical — task dismiss still succeeded
        }
      }
      setFocusItems((prev) => prev.filter((item) => item.id !== taskId));
      setDeletingId(null);
    } catch {
      // Dismiss endpoint not deployed yet — fall back to delete
      handleDeleteTask(taskId);
    }
  };

  // CW-1: State change handlers
  const handleSetState = async (taskId: string, state: string) => {
    try {
      await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ state }) });
      if (state === "done") {
        setFocusItems((prev) => prev.filter((item) => item.id !== taskId));
      } else {
        // Update local state
        setFocusItems((prev) =>
          prev.map((item) => (item.id === taskId ? { ...item, state } : item))
        );
      }
    } catch {
      // Fall back to old status-based API
      if (state === "done") handleMarkDone(taskId);
    }
  };

  const toggleWhyExpanded = (taskId: string) => {
    setExpandedWhy((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
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

  return (
    <div style={{ padding: "24px 20px", maxWidth: 800, margin: "0 auto" }}>
      {/* Greeting */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 28, fontWeight: 600, color: C.text, marginBottom: 4 }}>
          {greeting}
        </div>
      </div>

      {/* Goal Spotlight */}
      {goalSpotlights.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: C.textFaint }}>
              Goal Spotlight
            </span>
            <span
              style={{
                fontFamily: C.mono,
                fontSize: 9,
                color: C.gold,
                background: `${C.gold}18`,
                border: `1px solid ${C.gold}30`,
                borderRadius: 3,
                padding: "1px 5px",
                letterSpacing: 0.4,
              }}
            >
              Q2 2026
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {goalSpotlights.map((goal) => (
              <GoalProgressCard key={goal.id} goal={goal} />
            ))}
          </div>
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
                onDismiss={handleDismiss}
                onSetState={handleSetState}
                isDeleting={deletingId === item.id}
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeProgress(goal: any): number {
  if (typeof goal.progress_current === "number" && typeof goal.progress_target === "number" && goal.progress_target > 0) {
    return Math.min(100, Math.round((goal.progress_current / goal.progress_target) * 100));
  }
  // Try parsing string values
  const current = parseFloat(goal.progress_current);
  const target = parseFloat(goal.progress_target);
  if (!isNaN(current) && !isNaN(target) && target > 0) {
    return Math.min(100, Math.round((current / target) * 100));
  }
  return 0;
}

interface FocusCardProps {
  item: FocusItem;
  index: number;
  onDelete: (id: string) => void;
  onDismiss: (id: string, reason: DismissReason) => void;
  onSetState: (id: string, state: string) => void;
  isDeleting: boolean;
  onCancelDelete: () => void;
  expandedWhy: Set<string>;
  onToggleWhy: (id: string) => void;
}

function FocusCard(props: FocusCardProps) {
  const { item, onDelete, onDismiss, onSetState, isDeleting, onCancelDelete, expandedWhy, onToggleWhy } = props;
  const [showDismissReasons, setShowDismissReasons] = useState(false);
  const isExpanded = expandedWhy.has(item.id);
  const whyContent = item.leverageReason;
  const [feedbackGiven, setFeedbackGiven] = useState<"up" | "down" | null>(null);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  // Inline reply state
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyHistory, setReplyHistory] = useState<Array<{ reply: string; created_at: string }>>([]);
  const [replySaved, setReplySaved] = useState(false);
  const priorityColors: Record<string, string> = {
    urgent: C.reminder,
    high: C.task,
    medium: C.gem,
    low: C.textDim,
  };

  // Determine the AI tool to launch
  const aiKey = item.recommendedAI || "claude";
  const aiTool = AI_TOOLS[aiKey] || AI_TOOLS.claude;

  // Build the prompt to pre-fill when opening the AI tool
  const buildPrompt = () => {
    const parts = [`Task: ${item.title}`];
    if (item.description) parts.push(`\nContext: ${item.description}`);
    if (item.howTo) parts.push(`\nSteps:\n${item.howTo}`);
    return parts.join("");
  };

  const handleOpenAI = () => {
    const prompt = buildPrompt();
    const encoded = encodeURIComponent(prompt);
    // Each AI tool has different URL patterns for pre-filling prompts
    let url: string;
    if (aiKey === "chatgpt") {
      url = `https://chatgpt.com/?q=${encoded}`;
    } else if (aiKey === "gemini") {
      url = `https://gemini.google.com/app?q=${encoded}`;
    } else {
      // Claude — open new conversation
      url = `https://claude.ai/new?q=${encoded}`;
    }
    window.open(url, "_blank", "noopener");
  };

  const handleFeedback = async (type: "up" | "down") => {
    if (feedbackGiven || feedbackSaving) return;
    setFeedbackSaving(true);
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          section: "leverage_tasks",
          action: type === "up" ? "thumbs_up" : "thumbs_down",
          note: type === "up"
            ? `High-leverage: "${item.title}"`
            : `Not high-leverage: "${item.title}"`,
          task_id: item.id,
        }),
      });
      setFeedbackGiven(type);
    } catch (err) {
      console.error("Error saving feedback:", err);
    } finally {
      setFeedbackSaving(false);
    }
  };

  const handleReplyToggle = async () => {
    if (replyOpen) {
      setReplyOpen(false);
      return;
    }
    setReplyOpen(true);
    setReplyText("");
    setReplySaved(false);
    // Load reply history
    try {
      const data = await api<{ replies: Array<{ reply: string; created_at: string }> }>(
        `/api/tasks/${item.id}/replies`
      );
      setReplyHistory(data.replies ?? []);
    } catch {
      // Silently fail — reply history is non-critical
    }
  };

  const handleSubmitReply = async () => {
    if (!replyText.trim() || replyLoading) return;
    setReplyLoading(true);
    try {
      const text = replyText.trim();
      await api(`/api/tasks/${item.id}/replies`, {
        method: "POST",
        body: JSON.stringify({ reply: text }),
      });
      // Also save as a signal reply for broader learning
      try {
        await api("/api/signals/reply", {
          method: "POST",
          body: JSON.stringify({
            signal_text: item.title,
            reply: text,
            scope: "specific",
          }),
        });
      } catch {
        // Non-critical
      }
      setReplyText("");
      setReplyHistory((prev) => [{ reply: text, created_at: new Date().toISOString() }, ...prev]);
      setReplySaved(true);
      setTimeout(() => setReplySaved(false), 3000);
    } catch (err) {
      console.error("Error saving reply:", err);
    } finally {
      setReplyLoading(false);
    }
  };

  // Friendly source label
  const sourceLabel = item.source ? (SOURCE_LABELS[item.source] || item.source) : undefined;

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
      {/* Header: Priority + Title + Score Badge + Dismiss Button */}
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: C.text }}>
              {item.title}
            </div>
            {/* CW-1: Priority score badge */}
            {item.priorityScore != null && (
              <span
                style={{
                  fontFamily: C.mono,
                  fontSize: 9,
                  color: C.gold,
                  background: `${C.gold}18`,
                  border: `1px solid ${C.gold}30`,
                  borderRadius: 3,
                  padding: "1px 5px",
                  letterSpacing: 0.4,
                  flexShrink: 0,
                }}
              >
                {item.priorityScore.toFixed(2)}
              </span>
            )}
          </div>
          {/* CW-1: Goal + pillar name */}
          {(item.goalTitle || item.pillarName) && (
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 2, display: "flex", gap: 4, alignItems: "center" }}>
              {item.pillarName && <span>{item.pillarName}</span>}
              {item.pillarName && item.goalTitle && <span style={{ color: C.textFaint }}>·</span>}
              {item.goalTitle && <span>{item.goalTitle}</span>}
            </div>
          )}
        </div>
        {/* CW-2: Dismiss button (replaces delete) */}
        {!isDeleting && !showDismissReasons && (
          <button
            onClick={() => setShowDismissReasons(true)}
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
            title="Dismiss task"
          >
            ×
          </button>
        )}
      </div>

      {/* CW-2: Dismiss with reason picker */}
      {showDismissReasons && (
        <div
          style={{
            background: `${C.cl}10`,
            border: `1px solid ${C.cl}30`,
            borderRadius: 6,
            padding: "10px 12px",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>Why dismiss?</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DISMISS_REASONS.map((reason) => (
              <button
                key={reason.value}
                onClick={() => {
                  onDismiss(item.id, reason.value);
                  setShowDismissReasons(false);
                }}
                style={{
                  background: C.surface,
                  color: C.text,
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  padding: "5px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {reason.label}
              </button>
            ))}
            <button
              onClick={() => setShowDismissReasons(false)}
              style={{
                background: "none",
                color: C.textFaint,
                border: "none",
                padding: "5px 6px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Legacy delete confirmation (fallback) */}
      {isDeleting && !showDismissReasons && (
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
      {sourceLabel && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontStyle: "italic", color: C.textFaint }}>
            {sourceLabel}
          </span>
        </div>
      )}

      {/* Why High-Leverage? Section — CW-1: Show "Analyzing..." when null */}
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
              color: whyContent ? C.text : C.textDim,
              fontStyle: "italic",
              lineHeight: 1.5,
            }}
          >
            {whyContent || "Analyzing..."}
          </div>
        )}
      </div>

      {/* Feedback Row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: C.textFaint }}>
          {feedbackGiven ? "Thanks for the feedback" : "Is this high-leverage?"}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => handleFeedback("up")}
            disabled={!!feedbackGiven || feedbackSaving}
            style={{
              background: feedbackGiven === "up" ? `${C.todo}25` : "none",
              border: feedbackGiven === "up" ? `1px solid ${C.todo}60` : `1px solid ${C.border}`,
              color: feedbackGiven === "up" ? C.todo : C.textDim,
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 14,
              cursor: feedbackGiven ? "default" : "pointer",
              opacity: feedbackGiven && feedbackGiven !== "up" ? 0.3 : 1,
              transition: "all 0.15s",
            }}
            title="Yes, high-leverage"
          >
            ▲
          </button>
          <button
            onClick={() => handleFeedback("down")}
            disabled={!!feedbackGiven || feedbackSaving}
            style={{
              background: feedbackGiven === "down" ? `${C.reminder}25` : "none",
              border: feedbackGiven === "down" ? `1px solid ${C.reminder}60` : `1px solid ${C.border}`,
              color: feedbackGiven === "down" ? C.reminder : C.textDim,
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 14,
              cursor: feedbackGiven ? "default" : "pointer",
              opacity: feedbackGiven && feedbackGiven !== "down" ? 0.3 : 1,
              transition: "all 0.15s",
            }}
            title="Not high-leverage"
          >
            ▼
          </button>
          {/* Reply button */}
          <button
            onClick={handleReplyToggle}
            style={{
              background: replyOpen ? `${C.cl}20` : "none",
              border: replyOpen ? `1px solid ${C.cl}60` : `1px solid ${C.border}`,
              color: replyOpen ? C.cl : C.textDim,
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 11,
              cursor: "pointer",
              transition: "all 0.15s",
              fontFamily: C.mono,
            }}
            title="Reply with feedback"
          >
            💬 Reply
          </button>
        </div>
      </div>

      {/* Inline Reply Panel */}
      {replyOpen && (
        <div
          style={{
            background: `${C.surface}80`,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "10px 12px",
            marginBottom: 10,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {replyHistory.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textDim, marginBottom: 4 }}>Previous replies:</div>
              {replyHistory.slice(0, 5).map((r, idx) => (
                <div key={idx} style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginBottom: 2, lineHeight: 1.4 }}>
                  • {r.reply}
                </div>
              ))}
            </div>
          )}
          {replySaved && (
            <div style={{ fontFamily: C.mono, fontSize: 10, color: C.gpt }}>
              Saved — the system will learn from this.
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitReply();
                }
              }}
              placeholder="Tell the system something about this task... context, corrections, why it's wrong"
              rows={2}
              style={{
                flex: 1,
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                padding: "6px 8px",
                fontFamily: C.mono,
                fontSize: 11,
                color: C.text,
                outline: "none",
                resize: "none",
                lineHeight: 1.4,
              }}
            />
            <button
              onClick={handleSubmitReply}
              disabled={!replyText.trim() || replyLoading}
              style={{
                padding: "6px 12px",
                borderRadius: 4,
                background: replyText.trim() && !replyLoading ? C.cl : C.border,
                color: replyText.trim() && !replyLoading ? C.bg : C.textFaint,
                border: "none",
                fontFamily: C.mono,
                fontSize: 11,
                cursor: replyText.trim() && !replyLoading ? "pointer" : "default",
                whiteSpace: "nowrap",
                height: "fit-content",
                alignSelf: "flex-end",
              }}
            >
              {replyLoading ? "..." : "Send"}
            </button>
          </div>
        </div>
      )}

      {/* Action Row — CW-1: One-tap execution (Start/Done/Block) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {/* Primary: Open in recommended AI tool */}
        <button
          onClick={handleOpenAI}
          style={{
            background: aiTool.color,
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <span>{aiTool.icon}</span>
          {aiTool.label}
        </button>
        {/* CW-1: State-based one-tap actions */}
        {item.state !== "started" && (
          <button
            onClick={() => onSetState(item.id, "started")}
            style={{
              background: `${C.gpt}18`,
              color: C.gpt,
              border: `1px solid ${C.gpt}30`,
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Start
          </button>
        )}
        <button
          onClick={() => onSetState(item.id, "done")}
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
        <button
          onClick={() => onSetState(item.id, "blocked")}
          style={{
            background: C.surface,
            color: C.task,
            border: `1px solid ${C.task}30`,
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Block
        </button>
      </div>
    </div>
  );
}
