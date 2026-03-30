"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { C } from "@/lib/ui";
import { Spinner } from "@/components/primitives";
import { api } from "@/lib/client-api";
import { OneTapAction, type ActionType } from "@/components/one-tap-action";
import { buildFingerprint, isSignalDismissed } from "@/lib/signal-fingerprint";

// ---------------------------------------------------------------------------
// CW-3/4/5/6: New right-panel section types
// ---------------------------------------------------------------------------

interface BlockedTask {
  id: string;
  title: string;
  state: string;
  ai_metadata?: {
    unblock_hint?: string;
  };
}

interface ZombieAlert {
  id: string;
  type: string;
  task_id?: string;
  task_title?: string;
  days_stale?: number;
  message?: string;
  created_at: string;
}

interface DeadLetterAlert {
  id: string;
  type: string;
  job_name?: string;
  error_snippet?: string;
  created_at: string;
  original_endpoint?: string;
}

interface ContentReviewItem {
  id: string;
  platform: string;
  topic?: string;
  status: string;
  ai_audit_passed?: boolean;
  audit_notes?: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SignalCategory = "insight" | "recommendation" | "proposal" | "alert" | "opportunity";

interface Signal {
  id: string;
  /** Display text */
  text: string;
  /** Category determines visual treatment */
  category: SignalCategory;
  /** Where this signal came from */
  source: string;
  /** When it was generated */
  timestamp: string;
  /** Relevance / importance score (0-1) */
  relevance?: number;
  /** Associated pillar */
  pillar?: string;
  pillarColor?: string;
  /** One-tap action if actionable */
  action?: {
    label: string;
    actionType: ActionType;
    context: string;
    taskId?: string;
    url?: string;
  };
  /** Has the user seen/interacted with this? */
  seen?: boolean;
}

// ---------------------------------------------------------------------------
// Category styling
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<SignalCategory, { icon: string; color: string; label: string }> = {
  insight:        { icon: "◎", color: C.gem,      label: "Insight" },
  recommendation: { icon: "◈", color: C.cl,       label: "Recommendation" },
  proposal:       { icon: "✎", color: C.gpt,      label: "Proposal" },
  alert:          { icon: "⚡", color: C.reminder,  label: "Alert" },
  opportunity:    { icon: "◇", color: C.gold,     label: "Opportunity" },
};

// ---------------------------------------------------------------------------
// Signal card
// ---------------------------------------------------------------------------

interface SignalReply {
  id: string;
  reply: string;
  created_at: string;
  scope: "specific" | "broad";
}

function SignalCard({
  signal,
  index,
  onDismiss,
}: {
  signal: Signal;
  index: number;
  onDismiss: (signal: Signal) => void;
}) {
  const meta = CATEGORY_META[signal.category] ?? CATEGORY_META.insight;
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replies, setReplies] = useState<SignalReply[]>([]);
  const [repliesLoaded, setRepliesLoaded] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load existing replies when the reply panel is opened
  const loadReplies = useCallback(async () => {
    if (repliesLoaded) return;
    try {
      const fp = buildFingerprint(signal.text);
      const res = await api<{ replies: SignalReply[] }>(
        `/api/signals/reply?fingerprint=${encodeURIComponent(fp)}&limit=10`
      );
      setReplies(res.replies ?? []);
    } catch {
      // Silent fail — replies are supplementary
    } finally {
      setRepliesLoaded(true);
    }
  }, [signal.text, repliesLoaded]);

  const handleOpenReply = () => {
    setReplyOpen(true);
    loadReplies();
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSubmitReply = async () => {
    if (!replyText.trim()) return;
    setSubmitting(true);
    try {
      const res = await api<{ reply: SignalReply }>("/api/signals/reply", {
        method: "POST",
        body: JSON.stringify({
          signal_text: signal.text,
          reply: replyText.trim(),
          signal_category: signal.category,
          scope: "specific",
        }),
      });
      setReplies((prev) => [res.reply, ...prev]);
      setReplyText("");
    } catch (e) {
      console.error("Failed to submit reply:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await api("/api/signals/dismiss", {
        method: "POST",
        body: JSON.stringify({
          text: signal.text,
          category: signal.category,
          source: signal.source,
        }),
      });
      onDismiss(signal);
    } catch (e) {
      console.error("Failed to dismiss signal:", e);
      setDismissing(false);
    }
  };

  if (dismissing) return null;

  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${signal.seen ? C.border : `${meta.color}30`}`,
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        animation: `fadeUp 0.3s ease ${index * 0.06}s both`,
        opacity: signal.seen ? 0.7 : 1,
        transition: "opacity 0.3s, border-color 0.2s",
      }}
    >
      {/* Header: category + source + time */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: meta.color, fontSize: 10 }}>{meta.icon}</span>
        <span
          style={{
            fontFamily: C.mono,
            fontSize: 8,
            color: meta.color,
            background: `${meta.color}14`,
            borderRadius: 3,
            padding: "1px 5px",
            letterSpacing: 0.3,
          }}
        >
          {meta.label}
        </span>

        {signal.pillar && (
          <span
            style={{
              fontFamily: C.mono,
              fontSize: 8,
              color: signal.pillarColor ?? C.textDim,
              letterSpacing: 0.3,
            }}
          >
            {signal.pillar}
          </span>
        )}

        <span style={{ flex: 1 }} />

        <span style={{ fontFamily: C.mono, fontSize: 8, color: C.textFaint }}>
          {formatTime(signal.timestamp)}
        </span>

        {/* Reply toggle */}
        <button
          onClick={handleOpenReply}
          style={{
            background: "none",
            border: "none",
            color: replyOpen ? C.cl : C.textFaint,
            cursor: "pointer",
            fontSize: 10,
            padding: "0 2px",
            lineHeight: 1,
            transition: "color 0.15s",
          }}
          title="Reply to this insight"
        >
          ↩
        </button>

        {/* Dismiss — persisted */}
        <button
          onClick={handleDismiss}
          style={{
            background: "none",
            border: "none",
            color: C.textFaint,
            cursor: "pointer",
            fontSize: 10,
            padding: "0 2px",
            lineHeight: 1,
          }}
          title="Dismiss (won't come back)"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          fontFamily: C.sans,
          fontSize: 11,
          color: C.text,
          lineHeight: 1.6,
        }}
      >
        {signal.text}
      </div>

      {/* Source + action */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontFamily: C.mono, fontSize: 8, color: C.textFaint }}>
          via {signal.source}
        </span>

        {signal.action && (
          <OneTapAction
            label={signal.action.label}
            actionType={signal.action.actionType}
            context={signal.action.context}
            taskId={signal.action.taskId}
            url={signal.action.url}
            color={meta.color}
            size="sm"
          />
        )}
      </div>

      {/* Reply section */}
      {replyOpen && (
        <div
          style={{
            borderTop: `1px solid ${C.border}`,
            paddingTop: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {/* Previous replies */}
          {replies.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {replies.map((r) => (
                <div
                  key={r.id}
                  style={{
                    background: `${C.cl}08`,
                    border: `1px solid ${C.cl}15`,
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 10,
                    color: C.textDim,
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ color: C.text, marginBottom: 2 }}>{r.reply}</div>
                  <div style={{ fontFamily: C.mono, fontSize: 8, color: C.textFaint }}>
                    {formatTime(r.created_at)}
                    {r.scope === "broad" && (
                      <span style={{ marginLeft: 4, color: C.gold }}>broad</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Input field */}
          <div style={{ display: "flex", gap: 4 }}>
            <input
              ref={inputRef}
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitReply();
                }
                if (e.key === "Escape") setReplyOpen(false);
              }}
              placeholder="Reply to this insight..."
              disabled={submitting}
              style={{
                flex: 1,
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                padding: "5px 8px",
                fontSize: 10,
                color: C.text,
                fontFamily: C.sans,
                outline: "none",
              }}
            />
            <button
              onClick={handleSubmitReply}
              disabled={submitting || !replyText.trim()}
              style={{
                background: submitting ? C.surface : `${C.cl}14`,
                border: `1px solid ${submitting ? C.border : `${C.cl}30`}`,
                color: submitting ? C.textDim : C.cl,
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 9,
                fontFamily: C.mono,
                cursor: submitting ? "default" : "pointer",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {submitting ? "..." : "Send"}
            </button>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 7, color: C.textFaint, lineHeight: 1.4 }}>
            Your feedback shapes future briefings. Press Esc to close.
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick stats row
// ---------------------------------------------------------------------------

function QuickStats({
  signalCount,
  unreadCount,
  topSource,
}: {
  signalCount: number;
  unreadCount: number;
  topSource?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <StatChip label="Signals" value={signalCount.toString()} color={C.gem} />
      {unreadCount > 0 && <StatChip label="New" value={unreadCount.toString()} color={C.cl} />}
      {topSource && <StatChip label="Top Source" value={topSource} color={C.textDim} />}
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontFamily: C.mono,
        fontSize: 8,
        color: C.textDim,
        background: `${color}10`,
        border: `1px solid ${color}20`,
        borderRadius: 4,
        padding: "2px 6px",
      }}
    >
      <span style={{ color, fontWeight: 600 }}>{value}</span>
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category filter tabs
// ---------------------------------------------------------------------------

function CategoryFilter({
  active,
  onChange,
  counts,
}: {
  active: SignalCategory | "all";
  onChange: (cat: SignalCategory | "all") => void;
  counts: Record<string, number>;
}) {
  const tabs: Array<{ key: SignalCategory | "all"; label: string }> = [
    { key: "all", label: "All" },
    { key: "recommendation", label: "Recs" },
    { key: "insight", label: "Insights" },
    { key: "proposal", label: "Proposals" },
    { key: "alert", label: "Alerts" },
    { key: "opportunity", label: "Opps" },
  ];

  return (
    <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
      {tabs.map((tab) => {
        const count = tab.key === "all" ? Object.values(counts).reduce((s, c) => s + c, 0) : (counts[tab.key] ?? 0);
        if (tab.key !== "all" && count === 0) return null;

        const isActive = active === tab.key;
        const meta = tab.key !== "all" ? CATEGORY_META[tab.key] : null;
        const accentColor = meta?.color ?? C.cl;

        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            style={{
              fontFamily: C.mono,
              fontSize: 8,
              color: isActive ? accentColor : C.textFaint,
              background: isActive ? `${accentColor}14` : "transparent",
              border: `1px solid ${isActive ? `${accentColor}30` : "transparent"}`,
              borderRadius: 4,
              padding: "3px 6px",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
            {count > 0 && (
              <span style={{ marginLeft: 3, opacity: 0.6 }}>{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CW-3: Blocked Tasks Section
// ---------------------------------------------------------------------------

function BlockedTasksSection({ tasks }: { tasks: BlockedTask[] }) {
  const [expanded, setExpanded] = useState(true);
  const visibleTasks = tasks.slice(0, 3);

  const handleUnblock = async (taskId: string) => {
    try {
      await api(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "unstarted" }),
      });
      window.dispatchEvent(new Event("signals:refresh"));
    } catch (e) {
      console.error("Failed to unblock task:", e);
    }
  };

  if (tasks.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none",
          border: "none",
          color: C.task,
          fontFamily: C.mono,
          fontSize: 10,
          fontWeight: 600,
          cursor: "pointer",
          padding: 0,
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          gap: 4,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        <span style={{ fontSize: 8 }}>{expanded ? "▼" : "▶"}</span>
        Blocked ({tasks.length})
      </button>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {visibleTasks.map((task) => (
            <div
              key={task.id}
              style={{
                background: C.card,
                border: `1px solid ${C.task}20`,
                borderLeft: `3px solid ${C.task}`,
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              <div style={{ fontSize: 11, color: C.text, fontWeight: 500, marginBottom: 4 }}>
                {task.title}
              </div>
              {task.ai_metadata?.unblock_hint && (
                <div style={{ fontSize: 10, color: C.textDim, fontStyle: "italic", marginBottom: 6, lineHeight: 1.4 }}>
                  💡 {task.ai_metadata.unblock_hint}
                </div>
              )}
              <button
                onClick={() => handleUnblock(task.id)}
                style={{
                  background: `${C.gpt}14`,
                  border: `1px solid ${C.gpt}30`,
                  color: C.gpt,
                  borderRadius: 4,
                  padding: "3px 8px",
                  fontSize: 9,
                  fontFamily: C.mono,
                  cursor: "pointer",
                }}
              >
                Mark Unblocked
              </button>
            </div>
          ))}
          {tasks.length > 3 && (
            <button
              style={{
                background: "none",
                border: "none",
                color: C.cl,
                fontSize: 10,
                fontFamily: C.mono,
                cursor: "pointer",
                padding: "4px 0",
              }}
            >
              View all {tasks.length} blocked →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CW-4: Zombie Task Alerts Section
// ---------------------------------------------------------------------------

function ZombieAlertsSection({ alerts }: { alerts: ZombieAlert[] }) {
  const [expanded, setExpanded] = useState(true);
  const visibleAlerts = alerts.slice(0, 3);

  const handleAction = async (alertId: string, action: "snooze" | "done" | "remove", taskId?: string) => {
    try {
      if (action === "done" && taskId) {
        await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ state: "done" }) });
      } else if (action === "snooze" && taskId) {
        await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ snoozed_until: new Date(Date.now() + 7 * 86400000).toISOString() }) });
      } else if (action === "remove") {
        await api(`/api/system-alerts/${alertId}`, { method: "DELETE" });
      }
      window.dispatchEvent(new Event("signals:refresh"));
    } catch (e) {
      console.error("Failed to handle zombie action:", e);
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none",
          border: "none",
          color: C.reminder,
          fontFamily: C.mono,
          fontSize: 10,
          fontWeight: 600,
          cursor: "pointer",
          padding: 0,
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          gap: 4,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        <span style={{ fontSize: 8 }}>{expanded ? "▼" : "▶"}</span>
        Stale Tasks ({alerts.length})
      </button>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {visibleAlerts.map((alert) => (
            <div
              key={alert.id}
              style={{
                background: C.card,
                border: `1px solid ${C.reminder}15`,
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              <div style={{ fontSize: 11, color: C.text, fontWeight: 500, marginBottom: 2 }}>
                {alert.task_title || alert.message || "Stale task"}
              </div>
              <div style={{ fontSize: 9, color: C.textFaint, fontFamily: C.mono, marginBottom: 6 }}>
                No update in {alert.days_stale || "7+"} days
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => handleAction(alert.id, "snooze", alert.task_id)}
                  style={{
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    color: C.textDim,
                    borderRadius: 3,
                    padding: "2px 6px",
                    fontSize: 9,
                    fontFamily: C.mono,
                    cursor: "pointer",
                  }}
                >
                  Snooze 7d
                </button>
                <button
                  onClick={() => handleAction(alert.id, "done", alert.task_id)}
                  style={{
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    color: C.gpt,
                    borderRadius: 3,
                    padding: "2px 6px",
                    fontSize: 9,
                    fontFamily: C.mono,
                    cursor: "pointer",
                  }}
                >
                  Mark Done
                </button>
                <button
                  onClick={() => handleAction(alert.id, "remove")}
                  style={{
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    color: C.reminder,
                    borderRadius: 3,
                    padding: "2px 6px",
                    fontSize: 9,
                    fontFamily: C.mono,
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CW-5: Dead-Letter Job Alerts Section
// ---------------------------------------------------------------------------

function DeadLetterSection({ alerts }: { alerts: DeadLetterAlert[] }) {
  const handleRetry = async (alert: DeadLetterAlert) => {
    if (!alert.original_endpoint) return;
    try {
      await api(alert.original_endpoint, {
        method: "POST",
        headers: { "x-idempotency-key": `retry-${alert.id}-${Date.now()}` },
      });
      window.dispatchEvent(new Event("signals:refresh"));
    } catch (e) {
      console.error("Failed to retry job:", e);
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          color: C.reminder,
          fontFamily: C.mono,
          fontSize: 10,
          fontWeight: 600,
          marginBottom: 6,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        ⚡ System Alerts ({alerts.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {alerts.map((alert) => (
          <div
            key={alert.id}
            style={{
              background: `${C.reminder}08`,
              border: `1px solid ${C.reminder}20`,
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            <div style={{ fontSize: 11, color: C.reminder, fontWeight: 500, marginBottom: 2 }}>
              {alert.job_name || "Job failure"}
            </div>
            {alert.error_snippet && (
              <div
                style={{
                  fontSize: 9,
                  color: C.textDim,
                  fontFamily: C.mono,
                  marginBottom: 4,
                  background: C.surface,
                  padding: "4px 6px",
                  borderRadius: 3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {alert.error_snippet}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 8, color: C.textFaint, fontFamily: C.mono }}>
                {formatTime(alert.created_at)}
              </span>
              {alert.original_endpoint && (
                <button
                  onClick={() => handleRetry(alert)}
                  style={{
                    background: `${C.cl}14`,
                    border: `1px solid ${C.cl}30`,
                    color: C.cl,
                    borderRadius: 3,
                    padding: "2px 6px",
                    fontSize: 9,
                    fontFamily: C.mono,
                    cursor: "pointer",
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CW-6: Content Needing Review Section
// ---------------------------------------------------------------------------

function ContentReviewSection({ items }: { items: ContentReviewItem[] }) {
  const platformIcons: Record<string, string> = {
    tiktok: "♪",
    instagram: "◻",
    youtube: "▶",
    threads: "◈",
  };

  const handleApprove = async (itemId: string) => {
    try {
      await api(`/api/content-queue/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "queued" }),
      });
      window.dispatchEvent(new Event("signals:refresh"));
    } catch (e) {
      console.error("Failed to approve content:", e);
    }
  };

  if (items.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          color: C.gem,
          fontFamily: C.mono,
          fontSize: 10,
          fontWeight: 600,
          marginBottom: 6,
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        Content Review ({items.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              background: C.card,
              border: `1px solid ${item.ai_audit_passed ? `${C.gpt}20` : `${C.task}20`}`,
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 12 }}>{platformIcons[item.platform] || "●"}</span>
              <span style={{ fontSize: 11, color: C.text, fontWeight: 500 }}>
                {item.topic || item.platform}
              </span>
              <span
                style={{
                  fontSize: 8,
                  fontFamily: C.mono,
                  color: item.ai_audit_passed ? C.gpt : C.task,
                  background: item.ai_audit_passed ? `${C.gpt}14` : `${C.task}14`,
                  border: `1px solid ${item.ai_audit_passed ? `${C.gpt}30` : `${C.task}30`}`,
                  borderRadius: 3,
                  padding: "1px 4px",
                }}
              >
                {item.ai_audit_passed ? "Ready" : "Needs edit"}
              </span>
            </div>
            {!item.ai_audit_passed && item.audit_notes && (
              <div style={{ fontSize: 10, color: C.textDim, fontStyle: "italic", marginBottom: 6, lineHeight: 1.4 }}>
                {item.audit_notes}
              </div>
            )}
            {item.ai_audit_passed && (
              <button
                onClick={() => handleApprove(item.id)}
                style={{
                  background: `${C.gpt}14`,
                  border: `1px solid ${C.gpt}30`,
                  color: C.gpt,
                  borderRadius: 4,
                  padding: "3px 8px",
                  fontSize: 9,
                  fontFamily: C.mono,
                  cursor: "pointer",
                }}
              >
                Approve & Queue
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SignalsPanel — right sidebar
// ---------------------------------------------------------------------------

export function SignalsPanel() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeFilter, setActiveFilter] = useState<SignalCategory | "all">("all");
  const [error, setError] = useState("");
  // Dismissals: persistent set of fingerprints to suppress
  const [_dismissedFingerprints, setDismissedFingerprints] = useState<Set<string>>(new Set());
  // CW-3/4/5/6: New right-panel section state
  const [blockedTasks, setBlockedTasks] = useState<BlockedTask[]>([]);
  const [zombieAlerts, setZombieAlerts] = useState<ZombieAlert[]>([]);
  const [deadLetterAlerts, setDeadLetterAlerts] = useState<DeadLetterAlert[]>([]);
  const [contentReviewItems, setContentReviewItems] = useState<ContentReviewItem[]>([]);

  const generateBriefing = useCallback(async () => {
    try {
      setGenerating(true);
      setError("");
      await api("/api/briefing/daily");
      // Refresh signals after briefing is generated
      window.dispatchEvent(new Event("briefing:refresh"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to generate briefing";
      setError(msg);
      console.error("Failed to generate briefing:", e);
    } finally {
      setGenerating(false);
    }
  }, []);

  // Handler when a signal is dismissed from a card
  const handleSignalDismissed = useCallback((signal: Signal) => {
    const fp = buildFingerprint(signal.text);
    setDismissedFingerprints((prev) => new Set([...prev, fp]));
    setSignals((prev) => prev.filter((s) => s.id !== signal.id));
  }, []);

  const loadSignals = useCallback(async () => {
    try {
      // Load dismissals in parallel with signals
      const dismissalsPromise = api<{ dismissals: Array<{ fingerprint: string }> }>("/api/signals/dismiss").catch(() => ({ dismissals: [] }));

      // Pull from briefing content + activity feed
      const [briefingRes, activityRes, dismissalsRes] = await Promise.allSettled([
        api<{ briefing: { content_json?: Array<{ title: string; color: string; items: Array<{ id?: string; text: string; type?: string }> }> } | null }>("/api/briefings"),
        api<{ entries: Array<{ id: string; type: string; description: string; created_at: string; metadata?: Record<string, unknown> }> }>("/api/activity?limit=20"),
        dismissalsPromise,
      ]);

      // Build dismissal set
      const dismissedFps = new Set<string>();
      if (dismissalsRes.status === "fulfilled" && dismissalsRes.value.dismissals) {
        for (const d of dismissalsRes.value.dismissals) {
          dismissedFps.add(d.fingerprint);
        }
      }
      setDismissedFingerprints(dismissedFps);

      const sigs: Signal[] = [];

      // Extract signals from briefing sections
      if (briefingRes.status === "fulfilled" && briefingRes.value.briefing?.content_json) {
        const sections = briefingRes.value.briefing.content_json;
        for (const section of sections) {
          for (const item of section.items) {
            const category = classifySignal(item.text, item.type, section.title);
            const action = inferSignalAction(item.text, item.type);

            sigs.push({
              id: item.id ?? `sig-${Math.random().toString(36).slice(2, 8)}`,
              text: item.text,
              category,
              source: "daily briefing",
              timestamp: new Date().toISOString(),
              action: action ?? undefined,
            });
          }
        }
      }

      // Extract from activity feed
      if (activityRes.status === "fulfilled" && activityRes.value.entries) {
        for (const entry of activityRes.value.entries.slice(0, 10)) {
          if (entry.type === "agent_complete" || entry.type === "signal") {
            sigs.push({
              id: entry.id,
              text: entry.description,
              category: "insight",
              source: entry.type,
              timestamp: entry.created_at,
              seen: true,
            });
          }
        }
      }

      // Filter out dismissed signals using fuzzy fingerprint matching
      const filteredSigs = sigs.filter((s) => !isSignalDismissed(s.text, dismissedFps));
      setSignals(filteredSigs);

      // CW-3/4/5/6: Fetch new right-panel section data in parallel (silent fail if endpoints not deployed)
      const [blockedRes, zombieRes, deadLetterRes, contentRes] = await Promise.allSettled([
        // CW-3: Blocked tasks
        api<{ tasks: BlockedTask[] }>("/api/tasks?state=blocked"),
        // CW-4: Zombie alerts
        api<{ alerts: Array<{ id: string; type: string; entity_id: string; payload: Record<string, unknown>; created_at: string }> }>("/api/system-alerts?type=zombie_alert"),
        // CW-5: Dead-letter alerts (job_runs table)
        api<{ dead_letter_jobs: DeadLetterAlert[] }>("/api/system-alerts"),
        // CW-6: Content needing review
        api<{ items: ContentReviewItem[] }>("/api/content-queue?status=draft&ai_audit_passed=false"),
      ]);

      if (blockedRes.status === "fulfilled" && blockedRes.value.tasks) {
        setBlockedTasks(blockedRes.value.tasks);
      }
      if (zombieRes.status === "fulfilled" && zombieRes.value.alerts) {
        // Map activity_log payload fields to ZombieAlert shape
        const mapped: ZombieAlert[] = zombieRes.value.alerts.map((a) => ({
          id: a.id,
          type: a.type,
          task_id: (a.payload?.task_id as string) ?? a.entity_id,
          task_title: (a.payload?.task_title as string) ?? undefined,
          days_stale: (a.payload?.days_stale as number) ?? undefined,
          message: (a.payload?.message as string) ?? undefined,
          created_at: a.created_at,
        }));
        setZombieAlerts(mapped);
      }
      if (deadLetterRes.status === "fulfilled" && deadLetterRes.value.dead_letter_jobs) {
        // Map dead_letter_jobs from job_runs table
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: DeadLetterAlert[] = (deadLetterRes.value.dead_letter_jobs as any[]).map((j) => ({
          id: j.id,
          type: "dead_letter",
          job_name: j.job_type ?? j.job_name ?? "",
          error_snippet: j.error ?? "",
          created_at: j.created_at,
          original_endpoint: undefined,
        }));
        setDeadLetterAlerts(mapped);
      }
      if (contentRes.status === "fulfilled" && contentRes.value.items) {
        setContentReviewItems(contentRes.value.items);
      }
    } catch (e) {
      console.error("Failed to load signals:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSignals();
  }, [loadSignals]);

  useEffect(() => {
    function handleRefresh() {
      loadSignals();
    }
    window.addEventListener("briefing:refresh", handleRefresh);
    window.addEventListener("signals:refresh", handleRefresh);
    return () => {
      window.removeEventListener("briefing:refresh", handleRefresh);
      window.removeEventListener("signals:refresh", handleRefresh);
    };
  }, [loadSignals]);

  // Filter signals
  const filteredSignals =
    activeFilter === "all" ? signals : signals.filter((s) => s.category === activeFilter);

  // Category counts
  const counts: Record<string, number> = {};
  for (const s of signals) {
    counts[s.category] = (counts[s.category] ?? 0) + 1;
  }

  const unreadCount = signals.filter((s) => !s.seen).length;
  const topSource = signals.length > 0 ? getMostCommon(signals.map((s) => s.source)) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3
          style={{
            fontFamily: C.serif,
            fontStyle: "italic",
            fontSize: 14,
            color: C.cream,
            margin: 0,
            fontWeight: 400,
          }}
        >
          Signals & Insights
        </h3>
        <button
          onClick={generateBriefing}
          disabled={generating}
          style={{
            background: generating ? C.surface : `${C.cl}14`,
            border: `1px solid ${generating ? C.border : `${C.cl}30`}`,
            color: generating ? C.textDim : C.cl,
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 9,
            fontFamily: C.mono,
            cursor: generating ? "default" : "pointer",
            transition: "all 0.15s",
          }}
        >
          {generating ? "Generating…" : "Generate Briefing"}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: "8px 12px",
            margin: "0 12px",
            borderRadius: 4,
            background: `${C.reminder}14`,
            border: `1px solid ${C.reminder}28`,
            color: C.reminder,
            fontFamily: C.mono,
            fontSize: 9,
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}

      {/* Quick stats */}
      {signals.length > 0 && (
        <QuickStats signalCount={signals.length} unreadCount={unreadCount} topSource={topSource} />
      )}

      {/* CW-3: Blocked tasks */}
      <BlockedTasksSection tasks={blockedTasks} />

      {/* CW-4: Zombie alerts */}
      <ZombieAlertsSection alerts={zombieAlerts} />

      {/* CW-5: Dead-letter job alerts */}
      <DeadLetterSection alerts={deadLetterAlerts} />

      {/* CW-6: Content needing review */}
      <ContentReviewSection items={contentReviewItems} />

      {/* Category filter */}
      {signals.length > 0 && (
        <CategoryFilter active={activeFilter} onChange={setActiveFilter} counts={counts} />
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "24px 12px", color: C.textFaint }}>
          <Spinner color={C.gem} size={12} />
          <div style={{ fontFamily: C.mono, fontSize: 9, marginTop: 6 }}>Loading signals…</div>
        </div>
      )}

      {/* Signals list */}
      {!loading && (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {filteredSignals.map((signal, i) => (
            <SignalCard key={signal.id} signal={signal} index={i} onDismiss={handleSignalDismissed} />
          ))}

          {filteredSignals.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "24px 12px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>
                {activeFilter === "all"
                  ? "No signals yet."
                  : `No ${activeFilter} signals.`}
              </div>
              {activeFilter === "all" && (
                <button
                  onClick={generateBriefing}
                  disabled={generating}
                  style={{
                    background: generating ? C.surface : C.cl,
                    border: "none",
                    color: generating ? C.textDim : "white",
                    borderRadius: 6,
                    padding: "8px 16px",
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: generating ? "default" : "pointer",
                  }}
                >
                  {generating ? "Generating…" : "Generate Briefing"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifySignal(text: string, type?: string, sectionTitle?: string): SignalCategory {
  if (type === "triage") return "alert";
  if (type === "recommendation") return "recommendation";
  if (type === "insight") return "insight";

  const lower = text.toLowerCase();
  const titleLower = sectionTitle?.toLowerCase() ?? "";

  if (titleLower.includes("decision") || lower.includes("decide") || lower.includes("proposal")) return "proposal";
  if (titleLower.includes("insight") || lower.includes("trend") || lower.includes("data shows")) return "insight";
  if (lower.includes("opportunity") || lower.includes("potential") || lower.includes("could")) return "opportunity";
  if (lower.includes("alert") || lower.includes("urgent") || lower.includes("overdue")) return "alert";
  if (lower.includes("recommend") || lower.includes("should") || lower.includes("suggest")) return "recommendation";

  return "insight";
}

function inferSignalAction(
  text: string,
  type?: string,
): { label: string; actionType: ActionType; context: string } | null {
  const lower = text.toLowerCase();

  if (lower.includes("email") || lower.includes("reach out") || lower.includes("follow up")) {
    return { label: "Draft Email", actionType: "email_draft", context: text };
  }
  if (lower.includes("build") || lower.includes("implement") || lower.includes("code")) {
    return { label: "Send to Code", actionType: "code", context: text };
  }
  if (lower.includes("post") || lower.includes("content") || lower.includes("draft")) {
    return { label: "Draft Content", actionType: "content", context: text };
  }
  if (lower.includes("research") || lower.includes("analyze")) {
    return { label: "Research", actionType: "research", context: text };
  }
  if (type === "triage") {
    return { label: "Review", actionType: "admin", context: text };
  }

  return null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHr < 24) return `${diffHr}h`;
  return `${diffDay}d`;
}

function getMostCommon(arr: string[]): string {
  const freq: Record<string, number> = {};
  for (const v of arr) freq[v] = (freq[v] ?? 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
