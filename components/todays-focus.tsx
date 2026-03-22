"use client";

import React, { useEffect, useState, useCallback } from "react";
import { C } from "@/lib/ui";
import { Spinner } from "@/components/primitives";
import { api } from "@/lib/client-api";
import {
  OneTapAction,
  MarkDoneAction,
  type ActionType,
} from "@/components/one-tap-action";
import { GoalProgressCard, type GoalData } from "@/components/goal-progress-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FocusItem {
  id: string;
  /** Display text */
  title: string;
  /** Why this is high-leverage today */
  rationale: string;
  /** Source: briefing, task, goal, or signal */
  source: "briefing" | "task" | "goal" | "signal";
  /** The primary one-tap action */
  action: {
    label: string;
    actionType: ActionType;
    context: string;
    taskId?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  };
  /** Secondary actions (optional) */
  secondaryActions?: Array<{
    label: string;
    actionType: ActionType;
    context: string;
    taskId?: string;
  }>;
  /** Which pillar this relates to */
  pillar?: string;
  pillarColor?: string;
  /** Priority indicator */
  priority: "critical" | "high" | "medium";
  /** Time estimate */
  estimateMinutes?: number;
}

interface UpcomingEvent {
  id: string;
  title: string;
  time: string;
  duration?: string;
  type: "meeting" | "deadline" | "reminder" | "personal";
}

// ---------------------------------------------------------------------------
// Priority badge
// ---------------------------------------------------------------------------

function PriorityDot({ priority }: { priority: FocusItem["priority"] }) {
  const colors = {
    critical: C.reminder,
    high: C.task,
    medium: C.textDim,
  };
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: colors[priority],
        boxShadow: priority === "critical" ? `0 0 6px ${colors[priority]}60` : "none",
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Focus item card
// ---------------------------------------------------------------------------

function FocusCard({ item, index }: { item: FocusItem; index: number }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "border-color 0.2s, transform 0.15s",
        animation: `fadeUp 0.4s ease ${index * 0.08}s both`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = (item.pillarColor ?? C.cl) + "50";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = C.border;
      }}
    >
      {/* Header: priority + title */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <PriorityDot priority={item.priority} />
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: C.sans,
              fontSize: 13,
              color: C.cream,
              lineHeight: 1.4,
              fontWeight: 500,
            }}
          >
            {item.title}
          </div>

          <div
            style={{
              fontFamily: C.sans,
              fontSize: 11,
              color: C.textDim,
              lineHeight: 1.5,
              marginTop: 4,
            }}
          >
            {item.rationale}
          </div>
        </div>

        {/* Estimate badge */}
        {item.estimateMinutes && (
          <span
            style={{
              fontFamily: C.mono,
              fontSize: 8,
              color: C.textFaint,
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              padding: "2px 6px",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            ~{item.estimateMinutes}m
          </span>
        )}
      </div>

      {/* Pillar tag + source */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {item.pillar && (
          <span
            style={{
              fontFamily: C.mono,
              fontSize: 8,
              color: item.pillarColor ?? C.textDim,
              background: `${item.pillarColor ?? C.textDim}14`,
              borderRadius: 3,
              padding: "1px 5px",
              letterSpacing: 0.3,
            }}
          >
            {item.pillar}
          </span>
        )}
        <span
          style={{
            fontFamily: C.mono,
            fontSize: 8,
            color: C.textFaint,
            letterSpacing: 0.3,
          }}
        >
          via {item.source}
        </span>
      </div>

      {/* Action row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {/* Primary action — slightly larger */}
        <OneTapAction
          label={item.action.label}
          actionType={item.action.actionType}
          context={item.action.context}
          taskId={item.action.taskId}
          url={item.action.url}
          metadata={item.action.metadata}
          color={item.pillarColor ?? C.cl}
          size="md"
        />

        {/* Secondary actions */}
        {item.secondaryActions?.map((sa, i) => (
          <OneTapAction
            key={i}
            label={sa.label}
            actionType={sa.actionType}
            context={sa.context}
            taskId={sa.taskId}
            size="sm"
          />
        ))}

        {/* Quick done if there's a task */}
        {item.action.taskId && (
          <MarkDoneAction taskId={item.action.taskId} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline event
// ---------------------------------------------------------------------------

function TimelineEvent({ event }: { event: UpcomingEvent }) {
  const typeColors = {
    meeting: C.gem,
    deadline: C.reminder,
    reminder: C.task,
    personal: C.gpt,
  };
  const color = typeColors[event.type];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 0",
      }}
    >
      <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, width: 48, flexShrink: 0 }}>
        {event.time}
      </span>
      <span
        style={{
          width: 2,
          height: 16,
          background: color,
          borderRadius: 1,
          flexShrink: 0,
        }}
      />
      <span style={{ fontFamily: C.sans, fontSize: 11, color: C.text, flex: 1 }}>
        {event.title}
      </span>
      {event.duration && (
        <span style={{ fontFamily: C.mono, fontSize: 8, color: C.textFaint }}>
          {event.duration}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Greeting — time-of-day aware
// ---------------------------------------------------------------------------

function getGreeting(): { greeting: string; timeContext: string } {
  const hour = new Date().getHours();
  if (hour < 6) return { greeting: "Late night, Tyler.", timeContext: "Focus on rest and recovery." };
  if (hour < 12) return { greeting: "Good morning, Tyler.", timeContext: "Your highest-leverage window." };
  if (hour < 17) return { greeting: "Afternoon, Tyler.", timeContext: "Execute and ship." };
  if (hour < 21) return { greeting: "Evening, Tyler.", timeContext: "Wind down, plan tomorrow." };
  return { greeting: "Late evening, Tyler.", timeContext: "Rest protects performance." };
}

// ---------------------------------------------------------------------------
// TodaysFocus — main center panel
// ---------------------------------------------------------------------------

export function TodaysFocus() {
  const [focusItems, setFocusItems] = useState<FocusItem[]>([]);
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [topGoals, setTopGoals] = useState<GoalData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      // Fetch today's focus items from briefing + tasks
      const [briefingRes, tasksRes] = await Promise.allSettled([
        api<{ briefing: { content_json?: Array<{ title: string; items: Array<{ id?: string; text: string; type?: string }> }> } | null }>("/api/briefings"),
        api<{ tasks: Array<{ id: string; title: string; priority_num: number; state: string; project_slug?: string; due_date?: string }> }>("/api/tasks?state=started,unstarted&limit=10"),
      ]);

      const items: FocusItem[] = [];

      // Extract from briefing sections
      if (briefingRes.status === "fulfilled" && briefingRes.value.briefing?.content_json) {
        const sections = briefingRes.value.briefing.content_json;
        for (const section of sections) {
          for (const item of section.items.slice(0, 2)) {
            const actionType = inferActionType(item.text, item.type);
            items.push({
              id: item.id ?? `briefing-${Math.random().toString(36).slice(2, 8)}`,
              title: extractTitle(item.text),
              rationale: extractRationale(item.text),
              source: "briefing",
              priority: items.length === 0 ? "critical" : items.length < 3 ? "high" : "medium",
              action: {
                label: actionType.label,
                actionType: actionType.type,
                context: item.text,
              },
              estimateMinutes: estimateMinutes(item.text),
            });
          }
        }
      }

      // Add top-priority tasks
      if (tasksRes.status === "fulfilled" && tasksRes.value.tasks) {
        const topTasks = tasksRes.value.tasks
          .sort((a, b) => a.priority_num - b.priority_num)
          .slice(0, 3);

        for (const task of topTasks) {
          // Don't duplicate if already in briefing
          if (items.some((it) => it.title.includes(task.title.slice(0, 20)))) continue;

          const actionType = inferActionType(task.title);
          items.push({
            id: task.id,
            title: task.title,
            rationale: task.due_date
              ? `Due ${formatRelativeDate(task.due_date)}${task.project_slug ? ` · ${task.project_slug}` : ""}`
              : task.project_slug
                ? `${task.project_slug} project`
                : "Active task",
            source: "task",
            priority: task.priority_num <= 1 ? "critical" : task.priority_num <= 2 ? "high" : "medium",
            action: {
              label: actionType.label,
              actionType: actionType.type,
              context: `Execute task: ${task.title}`,
              taskId: task.id,
            },
            secondaryActions: [
              {
                label: "Snooze",
                actionType: "task_snooze",
                context: "Snooze to tomorrow",
                taskId: task.id,
              },
            ],
          });
        }
      }

      // Cap at 5 focus items (cognitive load management)
      setFocusItems(items.slice(0, 5));
    } catch (e) {
      console.error("Failed to load focus data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for refreshes
  useEffect(() => {
    function handleRefresh() {
      loadData();
    }
    window.addEventListener("briefing:refresh", handleRefresh);
    window.addEventListener("tasks:refresh", handleRefresh);
    return () => {
      window.removeEventListener("briefing:refresh", handleRefresh);
      window.removeEventListener("tasks:refresh", handleRefresh);
    };
  }, [loadData]);

  const { greeting, timeContext } = getGreeting();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 20 }}>
      {/* Greeting + date */}
      <div>
        <h2
          style={{
            fontFamily: C.serif,
            fontStyle: "italic",
            fontSize: 22,
            color: C.cream,
            margin: 0,
            fontWeight: 400,
          }}
        >
          {greeting}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim }}>
            {today}
          </span>
          <span style={{ fontFamily: C.mono, fontSize: 10, color: C.cl }}>
            {timeContext}
          </span>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: C.textFaint }}>
          <Spinner color={C.cl} size={16} />
          <div style={{ fontFamily: C.mono, fontSize: 10, marginTop: 8 }}>
            Loading today&apos;s focus…
          </div>
        </div>
      )}

      {/* Focus items */}
      {!loading && focusItems.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 13, color: C.cream }}>
              High-Leverage Actions
            </span>
            <span
              style={{
                fontFamily: C.mono,
                fontSize: 8,
                color: C.textFaint,
                background: `${C.cl}15`,
                borderRadius: 6,
                padding: "1px 6px",
              }}
            >
              {focusItems.length}
            </span>
          </div>

          {focusItems.map((item, i) => (
            <FocusCard key={item.id} item={item} index={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && focusItems.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            background: C.card,
            borderRadius: 10,
            border: `1px solid ${C.border}`,
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8, color: C.textFaint }}>◈</div>
          <div style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 14, color: C.textDim }}>
            No focus items yet
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginTop: 4 }}>
            Generate a briefing to populate your high-leverage actions
          </div>
        </div>
      )}

      {/* Upcoming timeline (compact) */}
      {events.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: C.serif,
              fontStyle: "italic",
              fontSize: 13,
              color: C.cream,
              marginBottom: 8,
            }}
          >
            Upcoming
          </div>
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            {events.map((ev) => (
              <TimelineEvent key={ev.id} event={ev} />
            ))}
          </div>
        </div>
      )}

      {/* Goal spotlight — top 2 goals closest to completion (Goal-Gradient) */}
      {topGoals.length > 0 && (
        <div>
          <div
            style={{
              fontFamily: C.serif,
              fontStyle: "italic",
              fontSize: 13,
              color: C.cream,
              marginBottom: 8,
            }}
          >
            Nearest to Finish Line
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {topGoals.map((goal) => (
              <GoalProgressCard key={goal.id} goal={goal} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers — heuristic action inference
// ---------------------------------------------------------------------------

function inferActionType(text: string, type?: string): { type: ActionType; label: string } {
  const lower = text.toLowerCase();

  // Email-related
  if (lower.includes("email") || lower.includes("send") || lower.includes("reach out") || lower.includes("reply") || lower.includes("follow up") || lower.includes("draft")) {
    return { type: "email_draft", label: "Draft Email" };
  }

  // Code-related
  if (lower.includes("build") || lower.includes("implement") || lower.includes("fix bug") || lower.includes("feature") || lower.includes("refactor") || lower.includes("deploy") || lower.includes("pr") || lower.includes("code")) {
    if (lower.includes("deploy") || lower.includes("ship")) {
      return { type: "deploy", label: "Deploy" };
    }
    return { type: "code", label: "Send to Code" };
  }

  // Content
  if (lower.includes("post") || lower.includes("content") || lower.includes("caption") || lower.includes("tiktok") || lower.includes("instagram") || lower.includes("thread")) {
    return { type: "content", label: "Draft Content" };
  }

  // Research
  if (lower.includes("research") || lower.includes("analyze") || lower.includes("look into") || lower.includes("investigate")) {
    return { type: "research", label: "Research" };
  }

  // Calendar / scheduling
  if (lower.includes("schedule") || lower.includes("meeting") || lower.includes("calendar") || lower.includes("book")) {
    return { type: "calendar", label: "Schedule" };
  }

  // Triage items
  if (type === "triage") {
    return { type: "admin", label: "Open in Cowork" };
  }

  // Default: open in Cowork as admin task
  return { type: "admin", label: "Open in Cowork" };
}

function extractTitle(text: string): string {
  // Take first sentence or first 80 chars
  const sentence = text.split(/[.!?]\s/)[0];
  if (sentence.length <= 80) return sentence;
  return sentence.slice(0, 77) + "…";
}

function extractRationale(text: string): string {
  // Everything after first sentence
  const parts = text.split(/[.!?]\s/);
  if (parts.length <= 1) return "";
  return parts.slice(1).join(". ").slice(0, 120);
}

function estimateMinutes(text: string): number | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("quick") || lower.includes("simple")) return 5;
  if (lower.includes("email") || lower.includes("reply")) return 10;
  if (lower.includes("build") || lower.includes("implement")) return 45;
  if (lower.includes("review") || lower.includes("analyze")) return 20;
  if (lower.includes("deploy")) return 15;
  return undefined;
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((d.getTime() - now.getTime()) / 86400000);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return `in ${diff}d`;
}
