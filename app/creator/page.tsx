"use client";

import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "queue" | "analytics" | "history" | "strategy";

interface QueueItem {
  id: string;
  platform: string;
  content_type: string;
  body: string;
  scheduled_for: string | null;
  status: string;
  post_id: string | null;
  post_url: string | null;
  attempts: number;
  last_error: string | null;
  confidence_score: number | null;
  brand_voice_score: number | null;
  timeliness_score: number | null;
  agent_reasoning: string | null;
  created_at: string;
  updated_at: string;
}

interface QueueResponse {
  items: QueueItem[];
  total: number;
  limit: number;
  offset: number;
}

interface AnalyticsResponse {
  period: { days: number; since: string };
  overview: {
    total_posts: number;
    total_impressions: number;
    total_likes: number;
    total_replies: number;
    total_reposts: number;
    avg_engagement_rate: number;
  };
  top_posts: Array<{
    body: string;
    platform: string;
    impressions: number;
    likes: number;
    replies: number;
    reposts: number;
    engagement_rate: number;
    created_at: string;
  }>;
  daily_trend: Array<{
    date: string;
    impressions: number;
    avg_engagement: number;
    posts: number;
  }>;
  platforms: Array<{
    platform: string;
    posts: number;
    impressions: number;
    avg_engagement: number;
  }>;
  queue_status: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "queue", label: "Queue", icon: "▤" },
  { id: "analytics", label: "Analytics", icon: "◈" },
  { id: "history", label: "History", icon: "◷" },
  { id: "strategy", label: "Strategy", icon: "◉" },
];

const STATUS_COLORS: Record<string, string> = {
  draft: C.textDim,
  queued: C.gem,
  approved: C.gpt,
  posting: C.gold,
  posted: "#6fcf9a",
  failed: C.reminder,
  rejected: "#ef5555",
  expired: C.textDim,
};

/** Try to parse a thread body (JSON array of strings). Returns null if not a thread. */
function parseThreadBody(body: string): string[] | null {
  if (!body.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed) && parsed.length > 1 && parsed.every((p: unknown) => typeof p === "string")) {
      return parsed;
    }
  } catch {
    // Not JSON — regular post
  }
  return null;
}

function statusBadge(status: string) {
  const color = STATUS_COLORS[status] ?? C.textDim;
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 10,
    fontFamily: C.mono,
    color,
    background: `${color}18`,
    border: `1px solid ${color}30`,
    textTransform: "uppercase" as const,
  };
}

/**
 * Compute a simplified composite score from the three available fields.
 * Weights: confidence 30%, brand_voice 40%, timeliness 30% (normalized to 1.0, with brand_voice being Tyler's priority).
 * Returns a value between 0 and 1, defaulting to 0 for null scores.
 */
function computeDisplayScore(item: QueueItem): number {
  const confidence = item.confidence_score ?? 0;
  const brandVoice = item.brand_voice_score ?? 0;
  const timeliness = item.timeliness_score ?? 0;
  return confidence * 0.3 + brandVoice * 0.4 + timeliness * 0.3;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function CreatorPage() {
  const [tab, setTab] = useState<Tab>("queue");

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: C.bg,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 28px 0",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 20, color: C.cl }}>✧</span>
          <h1
            style={{
              fontFamily: C.serif,
              fontSize: 22,
              fontStyle: "italic",
              color: C.cream,
              margin: 0,
            }}
          >
            Creator OS
          </h1>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0 }}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${active ? C.cl : "transparent"}`,
                  padding: "8px 18px 10px",
                  fontFamily: C.sans,
                  fontSize: 13,
                  color: active ? C.cream : C.textDim,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "all 0.15s ease",
                }}
              >
                <span style={{ fontSize: 12, color: active ? C.cl : C.textFaint }}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px" }}>
        {tab === "queue" && <QueueTab />}
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "history" && <HistoryTab />}
        {tab === "strategy" && <StrategyTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue Tab
// ---------------------------------------------------------------------------

function QueueTab() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("upcoming"); // upcoming, draft, all
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSchedule, setEditSchedule] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [postsPerJob, setPostsPerJob] = useState(2);
  const [savingPostsPerJob, setSavingPostsPerJob] = useState(false);
  const [postsPerJobMessage, setPostsPerJobMessage] = useState<string | null>(null);
  const [maxBackfill, setMaxBackfill] = useState(6);
  const [savingBackfill, setSavingBackfill] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const [staleAfterDays, setStaleAfterDays] = useState(7);
  const [savingStale, setSavingStale] = useState(false);
  const [staleSaveMessage, setStaleSaveMessage] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const statusMap: Record<string, string> = {
        upcoming: "queued,approved",
        draft: "draft",
        failed: "failed",
        all: "",
      };
      const statusParam = statusMap[filter] ?? "";
      const params = new URLSearchParams({ limit: "100" });
      if (statusParam) params.set("status", statusParam);

      const data = await api<QueueResponse>(`/api/creator/queue?${params}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      console.error("Failed to fetch queue:", e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await api<{
        posts_per_job: number;
        max_backfill: number;
        stale_after_days: number;
        isDefault?: boolean;
      }>("/api/creator/settings");
      setPostsPerJob(data.posts_per_job);
      setMaxBackfill(data.max_backfill);
      setStaleAfterDays(data.stale_after_days);
    } catch (e) {
      console.error("Failed to fetch settings:", e);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    fetchSettings();
  }, [fetchQueue, fetchSettings]);

  async function updateItem(id: string, updates: Record<string, unknown>) {
    setSaving(true);
    try {
      await api("/api/creator/queue", {
        method: "PATCH",
        body: JSON.stringify({ id, ...updates }),
      });
      setEditingId(null);
      fetchQueue();
    } catch (e) {
      console.error("Failed to update:", e);
    } finally {
      setSaving(false);
    }
  }

  function startEditing(item: QueueItem) {
    setEditingId(item.id);
    setEditBody(item.body);
    setEditSchedule(
      item.scheduled_for
        ? new Date(item.scheduled_for).toISOString().slice(0, 16)
        : ""
    );
  }

  async function handleGenerate() {
    setSaving(true);
    try {
      await api("/api/creator/generate", { method: "POST" });
      fetchQueue();
    } catch (e) {
      console.error("Generation failed:", e);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishNow() {
    setSaving(true);
    try {
      await api("/api/creator/publish-now", { method: "POST" });
      fetchQueue();
    } catch (e) {
      console.error("Publish failed:", e);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishSingle(postId: string) {
    setPublishingId(postId);
    try {
      await api("/api/creator/publish-single", {
        method: "POST",
        body: JSON.stringify({ postId }),
      });
      fetchQueue();
    } catch (e) {
      console.error("Single publish failed:", e);
    } finally {
      setPublishingId(null);
    }
  }

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api<{ imported: number; errors: number }>("/api/creator/sync", {
        method: "POST",
      });
      setSyncResult(
        result.imported > 0
          ? `Synced ${result.imported} external post${result.imported !== 1 ? "s" : ""}`
          : "All posts already synced"
      );
      if (result.imported > 0) fetchQueue();
    } catch (e) {
      console.error("Sync failed:", e);
      setSyncResult("Sync failed");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 4000);
    }
  }

  async function handleUpdatePostsPerJob(newValue: number) {
    if (newValue < 1 || newValue === postsPerJob) return;

    setSavingPostsPerJob(true);
    try {
      await api("/api/creator/settings", {
        method: "PATCH",
        body: JSON.stringify({ posts_per_job: newValue }),
      });
      setPostsPerJob(newValue);
      setPostsPerJobMessage("Saved");
      setTimeout(() => setPostsPerJobMessage(null), 2000);
    } catch (e) {
      console.error("Failed to update posts per job:", e);
      setPostsPerJobMessage("Failed");
      setTimeout(() => setPostsPerJobMessage(null), 2000);
    } finally {
      setSavingPostsPerJob(false);
    }
  }

  async function handleUpdateMaxBackfill(newValue: number) {
    if (newValue < 1 || newValue === maxBackfill) return;

    setSavingBackfill(true);
    try {
      await api("/api/creator/settings", {
        method: "PATCH",
        body: JSON.stringify({ max_backfill: newValue }),
      });
      setMaxBackfill(newValue);
      setBackfillMessage("Saved");
      setTimeout(() => setBackfillMessage(null), 2000);
    } catch (e) {
      console.error("Failed to update max backfill:", e);
      setBackfillMessage("Failed");
      setTimeout(() => setBackfillMessage(null), 2000);
    } finally {
      setSavingBackfill(false);
    }
  }

  async function handleUpdateStaleAfterDays(newDays: number) {
    if (newDays < 1 || newDays === staleAfterDays) return;

    setSavingStale(true);
    try {
      await api("/api/creator/settings", {
        method: "PATCH",
        body: JSON.stringify({ stale_after_days: newDays }),
      });
      setStaleAfterDays(newDays);
      setStaleSaveMessage("Saved");
      setTimeout(() => setStaleSaveMessage(null), 2000);
    } catch (e) {
      console.error("Failed to update stale threshold:", e);
      setStaleSaveMessage("Failed");
      setTimeout(() => setStaleSaveMessage(null), 2000);
    } finally {
      setSavingStale(false);
    }
  }

  const filters = [
    { id: "upcoming", label: "Upcoming" },
    { id: "draft", label: "Drafts" },
    { id: "failed", label: "Failed" },
    { id: "all", label: "All" },
  ];

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                background: filter === f.id ? C.card : "transparent",
                border: `1px solid ${filter === f.id ? C.borderMid : "transparent"}`,
                color: filter === f.id ? C.cream : C.textDim,
                padding: "5px 12px",
                borderRadius: 6,
                fontFamily: C.sans,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}

          {/* Posts per job control */}
          <div style={{ marginLeft: 16, display: "flex", gap: 8, alignItems: "center", paddingLeft: 12, borderLeft: `1px solid ${C.borderMid}` }}>
            <label style={{ fontFamily: C.sans, fontSize: 12, color: C.textDim }}>
              Posts/job:
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={postsPerJob}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) setPostsPerJob(val);
              }}
              onBlur={() => handleUpdatePostsPerJob(postsPerJob)}
              disabled={savingPostsPerJob}
              style={{
                width: 40,
                padding: "4px 8px",
                fontFamily: C.mono,
                fontSize: 12,
                background: C.surface,
                border: `1px solid ${C.borderMid}`,
                color: C.text,
                borderRadius: 4,
                cursor: savingPostsPerJob ? "wait" : "text",
                opacity: savingPostsPerJob ? 0.6 : 1,
              }}
            />
            {postsPerJobMessage && (
              <span
                style={{
                  fontFamily: C.mono,
                  fontSize: 10,
                  color: postsPerJobMessage === "Saved" ? C.gpt : C.reminder,
                  animation: "fadeUp 0.2s ease both",
                  minWidth: 45,
                }}
              >
                {postsPerJobMessage}
              </span>
            )}

            {/* Max backfill control */}
            <div style={{ marginLeft: 16, display: "flex", gap: 8, alignItems: "center", paddingLeft: 12, borderLeft: `1px solid ${C.borderMid}` }}>
              <label style={{ fontFamily: C.sans, fontSize: 12, color: C.textDim }}>
                Max backfill:
              </label>
              <input
                type="number"
                min="1"
                max="365"
                value={maxBackfill}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setMaxBackfill(val);
                }}
                onBlur={() => handleUpdateMaxBackfill(maxBackfill)}
                disabled={savingBackfill}
                style={{
                  width: 40,
                  padding: "4px 8px",
                  fontFamily: C.mono,
                  fontSize: 12,
                  background: C.surface,
                  border: `1px solid ${C.borderMid}`,
                  color: C.text,
                  borderRadius: 4,
                  cursor: savingBackfill ? "wait" : "text",
                  opacity: savingBackfill ? 0.6 : 1,
                }}
              />
              {backfillMessage && (
                <span
                  style={{
                    fontFamily: C.mono,
                    fontSize: 10,
                    color: backfillMessage === "Saved" ? C.gpt : C.reminder,
                    animation: "fadeUp 0.2s ease both",
                    minWidth: 45,
                  }}
                >
                  {backfillMessage}
                </span>
              )}
            </div>

            {/* Stale after (days) control */}
            <div style={{ marginLeft: 16, display: "flex", gap: 8, alignItems: "center", paddingLeft: 12, borderLeft: `1px solid ${C.borderMid}` }}>
              <label style={{ fontFamily: C.sans, fontSize: 12, color: C.textDim }}>
                Stale after (days):
              </label>
              <input
                type="number"
                min="1"
                max="365"
                value={staleAfterDays}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setStaleAfterDays(val);
                }}
                onBlur={() => handleUpdateStaleAfterDays(staleAfterDays)}
                disabled={savingStale}
                style={{
                  width: 40,
                  padding: "4px 8px",
                  fontFamily: C.mono,
                  fontSize: 12,
                  background: C.surface,
                  border: `1px solid ${C.borderMid}`,
                  color: C.text,
                  borderRadius: 4,
                  cursor: savingStale ? "wait" : "text",
                  opacity: savingStale ? 0.6 : 1,
                }}
              />
              {staleSaveMessage && (
                <span
                  style={{
                    fontFamily: C.mono,
                    fontSize: 10,
                    color: staleSaveMessage === "Saved" ? C.gpt : C.reminder,
                    animation: "fadeUp 0.2s ease both",
                    minWidth: 45,
                  }}
                >
                  {staleSaveMessage}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {syncResult && (
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, animation: "fadeUp 0.2s ease both" }}>
              {syncResult}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              background: "transparent",
              border: `1px solid ${C.gem}50`,
              color: C.gem,
              padding: "6px 16px",
              borderRadius: 6,
              fontFamily: C.sans,
              fontSize: 12,
              fontWeight: 600,
              cursor: syncing ? "wait" : "pointer",
              opacity: syncing ? 0.6 : 1,
            }}
          >
            {syncing ? "Syncing..." : "Sync Posts"}
          </button>
          <button
            onClick={handlePublishNow}
            disabled={saving}
            style={{
              background: "transparent",
              border: `1px solid ${C.gpt}50`,
              color: C.gpt,
              padding: "6px 16px",
              borderRadius: 6,
              fontFamily: C.sans,
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Publishing..." : "Publish Now"}
          </button>
          <button
            onClick={handleGenerate}
            disabled={saving}
            style={{
              background: C.cl,
              border: "none",
              color: "#fff",
              padding: "6px 16px",
              borderRadius: 6,
              fontFamily: C.sans,
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Generating..." : "Generate Posts"}
          </button>
        </div>
      </div>

      {/* Count */}
      <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginBottom: 12 }}>
        {total} post{total !== 1 ? "s" : ""}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: C.textDim,
            fontFamily: C.sans,
            fontSize: 13,
          }}
        >
          No posts in queue. Hit &ldquo;Generate Posts&rdquo; to create your first batch.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(() => {
            // Sort items by composite score (descending) only for "upcoming" filter
            const displayItems = filter === "upcoming"
              ? [...items].sort((a, b) => computeDisplayScore(b) - computeDisplayScore(a))
              : items;
            return displayItems.map((item) => {
              const isEditing = editingId === item.id;
              const isExpanded = expandedId === item.id;

              return (
              <div
                key={item.id}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "12px 16px",
                  animation: "fadeUp 0.22s ease both",
                }}
              >
                {/* Row header */}
                <div
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {(() => {
                      const threadParts = parseThreadBody(item.body);
                      const isThread = threadParts !== null;

                      if (isEditing) {
                        if (isThread) {
                          // Edit each thread part individually
                          const editParts: string[] = (() => {
                            try { return JSON.parse(editBody); } catch { return [editBody]; }
                          })();
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                              {editParts.map((part, idx) => (
                                <div key={idx} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                                  <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, paddingTop: 10, flexShrink: 0 }}>
                                    {idx + 1}/{editParts.length}
                                  </span>
                                  <textarea
                                    value={part}
                                    onChange={(e) => {
                                      const updated = [...editParts];
                                      updated[idx] = e.target.value;
                                      setEditBody(JSON.stringify(updated));
                                    }}
                                    style={{
                                      flex: 1,
                                      minHeight: 60,
                                      background: C.surface,
                                      border: `1px solid ${C.borderMid}`,
                                      borderRadius: 6,
                                      color: C.text,
                                      fontFamily: C.sans,
                                      fontSize: 13,
                                      padding: "8px 10px",
                                      resize: "vertical",
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          );
                        }
                        return (
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: "100%",
                              minHeight: 80,
                              background: C.surface,
                              border: `1px solid ${C.borderMid}`,
                              borderRadius: 6,
                              color: C.text,
                              fontFamily: C.sans,
                              fontSize: 13,
                              padding: "8px 10px",
                              resize: "vertical",
                            }}
                          />
                        );
                      }

                      // Display mode
                      if (isThread && isExpanded) {
                        return (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {threadParts.map((part, idx) => (
                              <div key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                                <span style={{
                                  fontFamily: C.mono,
                                  fontSize: 9,
                                  color: C.cl,
                                  background: `${C.cl}15`,
                                  borderRadius: 4,
                                  padding: "2px 5px",
                                  flexShrink: 0,
                                  marginTop: 1,
                                }}>
                                  {idx + 1}/{threadParts.length}
                                </span>
                                <span style={{ fontFamily: C.sans, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                                  {part}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      // Collapsed: show first part preview for threads, or full body for single posts
                      const previewText = isThread ? threadParts[0] : item.body;
                      return (
                        <div
                          style={{
                            fontFamily: C.sans,
                            fontSize: 13,
                            color: C.text,
                            lineHeight: 1.5,
                            whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                            overflow: isExpanded ? "visible" : "hidden",
                            textOverflow: isExpanded ? "unset" : "ellipsis",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          {isThread && (
                            <span style={{
                              fontFamily: C.mono,
                              fontSize: 9,
                              color: C.cl,
                              background: `${C.cl}15`,
                              borderRadius: 4,
                              padding: "2px 5px",
                              flexShrink: 0,
                            }}>
                              {threadParts.length}-part thread
                            </span>
                          )}
                          {previewText}
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={statusBadge(item.status)}>{item.status}</span>
                    {(() => {
                      const score = computeDisplayScore(item);
                      return score > 0 ? (
                        <span style={{
                          fontFamily: C.mono,
                          fontSize: 10,
                          color: C.textFaint,
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: `${C.textFaint}08`,
                        }}>
                          {Math.round(score * 100)}% match
                        </span>
                      ) : null;
                    })()}
                    <span
                      style={{
                        fontFamily: C.mono,
                        fontSize: 10,
                        color: C.textFaint,
                      }}
                    >
                      {item.platform}
                    </span>
                  </div>
                </div>

                {/* Schedule row */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                  {isEditing ? (
                    <input
                      type="datetime-local"
                      value={editSchedule}
                      onChange={(e) => setEditSchedule(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: C.surface,
                        border: `1px solid ${C.borderMid}`,
                        borderRadius: 4,
                        color: C.text,
                        fontFamily: C.mono,
                        fontSize: 11,
                        padding: "3px 8px",
                      }}
                    />
                  ) : (
                    <span style={{ fontFamily: C.mono, fontSize: 11, color: C.textDim }}>
                      {item.scheduled_for
                        ? `Scheduled: ${new Date(item.scheduled_for).toLocaleString("en-US", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}`
                        : "No schedule"}
                    </span>
                  )}

                  {item.confidence_score != null && (
                    <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>
                      {Math.round(item.confidence_score * 100)}% confidence
                    </span>
                  )}
                  {item.brand_voice_score != null && (
                    <span style={{ fontFamily: C.mono, fontSize: 10, color: item.brand_voice_score >= 0.7 ? C.gpt : C.textFaint }}>
                      {Math.round(item.brand_voice_score * 100)}% on-brand
                    </span>
                  )}
                  {item.timeliness_score != null && (
                    <span style={{ fontFamily: C.mono, fontSize: 10, color: item.timeliness_score >= 0.7 ? C.cl : C.textFaint }}>
                      {Math.round(item.timeliness_score * 100)}% timely
                    </span>
                  )}

                  <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    {isEditing ? (
                      <>
                        <ActionBtn
                          label="Save"
                          color={C.gpt}
                          disabled={saving}
                          onClick={(e) => {
                            e.stopPropagation();
                            const updates: Record<string, unknown> = {};
                            if (editBody !== item.body) updates.body = editBody;
                            if (editSchedule) updates.scheduled_for = new Date(editSchedule).toISOString();
                            if (Object.keys(updates).length) updateItem(item.id, updates);
                            else setEditingId(null);
                          }}
                        />
                        <ActionBtn
                          label="Cancel"
                          color={C.textDim}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(null);
                          }}
                        />
                      </>
                    ) : (
                      <>
                        {(item.status === "draft" || item.status === "queued") && (
                          <ActionBtn
                            label="Edit"
                            color={C.gem}
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditing(item);
                            }}
                          />
                        )}
                        {item.status === "draft" && (
                          <ActionBtn
                            label="Approve"
                            color={C.gpt}
                            onClick={(e) => {
                              e.stopPropagation();
                              updateItem(item.id, { status: "queued" });
                            }}
                          />
                        )}
                        {(item.status === "draft" || item.status === "queued") && (
                          <ActionBtn
                            label={publishingId === item.id ? "Publishing..." : "Publish"}
                            color="#6fcf9a"
                            disabled={publishingId === item.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePublishSingle(item.id);
                            }}
                          />
                        )}
                        {(item.status === "draft" || item.status === "queued") && (
                          <ActionBtn
                            label="Reject"
                            color={C.reminder}
                            onClick={(e) => {
                              e.stopPropagation();
                              updateItem(item.id, { status: "rejected" });
                            }}
                          />
                        )}
                        {item.status === "failed" && (
                          <ActionBtn
                            label="Retry"
                            color={C.gold}
                            onClick={(e) => {
                              e.stopPropagation();
                              updateItem(item.id, { status: "queued" });
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && !isEditing && (
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: `1px solid ${C.border}`,
                      animation: "fadeUp 0.15s ease both",
                    }}
                  >
                    {item.agent_reasoning && (
                      <div style={{ marginBottom: 8 }}>
                        <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textTransform: "uppercase" }}>
                          Agent Reasoning
                        </span>
                        <div style={{ fontFamily: C.sans, fontSize: 12, color: C.textDim, marginTop: 3 }}>
                          {item.agent_reasoning}
                        </div>
                      </div>
                    )}
                    {item.last_error && (
                      <div style={{ marginBottom: 8 }}>
                        <span style={{ fontFamily: C.mono, fontSize: 9, color: C.reminder, textTransform: "uppercase" }}>
                          Last Error
                        </span>
                        <div style={{ fontFamily: C.mono, fontSize: 11, color: C.reminder, marginTop: 3, opacity: 0.8 }}>
                          {item.last_error}
                        </div>
                      </div>
                    )}
                    <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>
                      Type: {item.content_type} &middot; Attempts: {item.attempts} &middot; Created:{" "}
                      {new Date(item.created_at).toLocaleDateString()}
                    </div>
                  </div>
                )}
              </div>
            );
            });
          })()}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics Tab
// ---------------------------------------------------------------------------

function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    api<AnalyticsResponse>(`/api/creator/analytics?days=${days}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.textDim, fontFamily: C.sans, fontSize: 13 }}>
        No analytics data yet. Posts need to be published first.
      </div>
    );
  }

  const { overview, top_posts, daily_trend, platforms, queue_status } = data;

  // Find max impressions for the bar chart scaling
  const maxImpressions = Math.max(...daily_trend.map((d) => d.impressions), 1);

  return (
    <div>
      {/* Follower Tracking Cards */}
      <FollowerCards />

      {/* Period selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, marginTop: 20 }}>
        {[7, 14, 30, 60].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              background: days === d ? C.card : "transparent",
              border: `1px solid ${days === d ? C.borderMid : "transparent"}`,
              color: days === d ? C.cream : C.textDim,
              padding: "4px 12px",
              borderRadius: 6,
              fontFamily: C.mono,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Overview cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="Posts" value={overview.total_posts} />
        <StatCard label="Impressions" value={overview.total_impressions.toLocaleString()} />
        <StatCard label="Engagement" value={`${(overview.avg_engagement_rate * 100).toFixed(1)}%`} accent />
        <StatCard label="Likes" value={overview.total_likes} />
      </div>

      {/* Engagement trend (bar chart) */}
      {daily_trend.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionHeader>Daily Impressions</SectionHeader>
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "16px 16px 8px",
              height: 160,
              display: "flex",
              alignItems: "flex-end",
              gap: 2,
            }}
          >
            {daily_trend.map((d) => {
              const height = Math.max(4, (d.impressions / maxImpressions) * 120);
              return (
                <div
                  key={d.date}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
                  title={`${d.date}\n${d.impressions} impressions\n${d.posts} posts\n${(d.avg_engagement * 100).toFixed(1)}% engagement`}
                >
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 24,
                      height,
                      background: `linear-gradient(to top, ${C.cl}88, ${C.cl})`,
                      borderRadius: "3px 3px 0 0",
                      transition: "height 0.3s ease",
                    }}
                  />
                  <span style={{ fontFamily: C.mono, fontSize: 7, color: C.textFaint, whiteSpace: "nowrap" }}>
                    {d.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Two columns: Top Posts + Platform/Queue */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Top Posts */}
        <div>
          <SectionHeader>Top Posts</SectionHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {top_posts.length === 0 ? (
              <div style={{ color: C.textDim, fontFamily: C.sans, fontSize: 12 }}>No data yet</div>
            ) : (
              top_posts.map((post, i) => (
                <div
                  key={i}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                  }}
                >
                  <div
                    style={{
                      fontFamily: C.sans,
                      fontSize: 12,
                      color: C.text,
                      lineHeight: 1.4,
                      marginBottom: 6,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {post.body}
                  </div>
                  <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, display: "flex", gap: 10 }}>
                    <span>{(post.engagement_rate * 100).toFixed(1)}% eng</span>
                    <span>{post.impressions} views</span>
                    <span>{post.likes} likes</span>
                    <span>{post.replies} replies</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right column: Platform + Queue */}
        <div>
          {/* Platform breakdown */}
          <SectionHeader>Platforms</SectionHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
            {platforms.length === 0 ? (
              <div style={{ color: C.textDim, fontFamily: C.sans, fontSize: 12 }}>No data yet</div>
            ) : (
              platforms.map((p) => (
                <div
                  key={p.platform}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontFamily: C.sans, fontSize: 13, color: C.cream, textTransform: "capitalize" }}>
                      {p.platform}
                    </div>
                    <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginTop: 2 }}>
                      {p.posts} posts &middot; {p.impressions.toLocaleString()} impressions
                    </div>
                  </div>
                  <div style={{ fontFamily: C.mono, fontSize: 14, color: C.cl }}>
                    {(p.avg_engagement * 100).toFixed(1)}%
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Queue status */}
          <SectionHeader>Queue Status</SectionHeader>
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "12px 14px",
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            {Object.entries(queue_status).length === 0 ? (
              <div style={{ color: C.textDim, fontFamily: C.sans, fontSize: 12 }}>Empty</div>
            ) : (
              Object.entries(queue_status).map(([status, count]) => (
                <div key={status} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: C.mono, fontSize: 18, color: STATUS_COLORS[status] ?? C.textDim }}>
                    {count}
                  </div>
                  <div
                    style={{
                      fontFamily: C.mono,
                      fontSize: 9,
                      color: C.textFaint,
                      textTransform: "uppercase",
                      marginTop: 2,
                    }}
                  >
                    {status}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History Tab (posted + feedback)
// ---------------------------------------------------------------------------

function HistoryTab() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedbackStates, setFeedbackStates] = useState<Record<string, number | null>>({});
  const [feedbackNotes, setFeedbackNotes] = useState<Record<string, string>>({});
  const [submittingFeedback, setSubmittingFeedback] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api<QueueResponse>("/api/creator/queue?status=posted&limit=100")
      .then((data) => setItems(data.items))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function submitFeedback(itemId: string) {
    const rating = feedbackStates[itemId];
    const feedback = feedbackNotes[itemId];
    if (!rating && !feedback) return;

    setSubmittingFeedback(itemId);
    try {
      await api("/api/creator/feedback", {
        method: "POST",
        body: JSON.stringify({
          contentQueueId: itemId,
          rating,
          feedback: feedback || undefined,
        }),
      });
      // Visual confirmation — clear the note
      setFeedbackNotes((prev) => ({ ...prev, [itemId]: "" }));
    } catch (e) {
      console.error("Feedback failed:", e);
    } finally {
      setSubmittingFeedback(null);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Spinner />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.textDim, fontFamily: C.sans, fontSize: 13 }}>
        No posted content yet. Once posts are published, they&apos;ll appear here for review.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item) => {
        const isExpanded = expandedId === item.id;
        const currentRating = feedbackStates[item.id] ?? null;
        const isSaving = submittingFeedback === item.id;

        return (
          <div
            key={item.id}
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "14px 16px",
              animation: "fadeUp 0.22s ease both",
            }}
          >
            {/* Post content */}
            <div
              style={{ cursor: "pointer" }}
              onClick={() => setExpandedId(isExpanded ? null : item.id)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div
                  style={{
                    fontFamily: C.sans,
                    fontSize: 13,
                    color: C.text,
                    lineHeight: 1.5,
                    flex: 1,
                    whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                    overflow: isExpanded ? "visible" : "hidden",
                    textOverflow: isExpanded ? "unset" : "ellipsis",
                  }}
                >
                  {item.body}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>
                    {item.platform}
                  </span>
                  {item.post_url && (
                    <a
                      href={item.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        fontFamily: C.mono,
                        fontSize: 10,
                        color: C.gem,
                        textDecoration: "none",
                      }}
                    >
                      View
                    </a>
                  )}
                </div>
              </div>

              <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginTop: 6 }}>
                Posted {item.scheduled_for
                  ? new Date(item.scheduled_for).toLocaleString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : new Date(item.updated_at).toLocaleDateString()}
              </div>
            </div>

            {/* Feedback section */}
            {isExpanded && (
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: `1px solid ${C.border}`,
                  animation: "fadeUp 0.15s ease both",
                }}
              >
                {/* Rating buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>Rate:</span>
                  {[1, 2, 3, 4, 5].map((r) => (
                    <button
                      key={r}
                      onClick={() =>
                        setFeedbackStates((prev) => ({
                          ...prev,
                          [item.id]: prev[item.id] === r ? null : r,
                        }))
                      }
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: `1px solid ${currentRating === r ? C.cl : C.border}`,
                        background: currentRating === r ? `${C.cl}20` : "transparent",
                        color: currentRating !== null && r <= currentRating ? C.cl : C.textFaint,
                        fontFamily: C.mono,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {r <= (currentRating ?? 0) ? "★" : "☆"}
                    </button>
                  ))}
                </div>

                {/* Feedback note */}
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Optional note..."
                    value={feedbackNotes[item.id] ?? ""}
                    onChange={(e) =>
                      setFeedbackNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    style={{
                      flex: 1,
                      background: C.surface,
                      border: `1px solid ${C.borderMid}`,
                      borderRadius: 6,
                      color: C.text,
                      fontFamily: C.sans,
                      fontSize: 12,
                      padding: "6px 10px",
                    }}
                  />
                  <button
                    onClick={() => submitFeedback(item.id)}
                    disabled={isSaving || (!currentRating && !feedbackNotes[item.id])}
                    style={{
                      background: C.cl,
                      border: "none",
                      color: "#fff",
                      padding: "6px 14px",
                      borderRadius: 6,
                      fontFamily: C.sans,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: isSaving ? "wait" : "pointer",
                      opacity: isSaving || (!currentRating && !feedbackNotes[item.id]) ? 0.4 : 1,
                    }}
                  >
                    {isSaving ? "..." : "Submit"}
                  </button>
                </div>

                {/* Agent reasoning */}
                {item.agent_reasoning && (
                  <div style={{ marginTop: 10 }}>
                    <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textTransform: "uppercase" }}>
                      Agent Reasoning
                    </span>
                    <div style={{ fontFamily: C.sans, fontSize: 12, color: C.textDim, marginTop: 3 }}>
                      {item.agent_reasoning}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

function ActionBtn({
  label,
  color,
  onClick,
  disabled,
}: {
  label: string;
  color: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "transparent",
        border: `1px solid ${color}40`,
        color,
        padding: "3px 10px",
        borderRadius: 5,
        fontFamily: C.mono,
        fontSize: 10,
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = `${color}15`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "14px 16px",
      }}
    >
      <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: C.mono, fontSize: 22, color: accent ? C.cl : C.cream }}>
        {value}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: C.mono,
        fontSize: 10,
        color: C.textFaint,
        textTransform: "uppercase",
        letterSpacing: 1.5,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follower Cards (shown atop Analytics tab)
// ---------------------------------------------------------------------------

interface FollowerSummaryData {
  total: number;
  byPlatform: Record<string, {
    current: number;
    delta7d: number;
    delta30d: number;
    growthRate7d: number;
    growthRate30d: number;
    engagementRate: number | null;
    reachRate: number | null;
    viralityRate: number | null;
    nonFollowerPct: number | null;
    avgImpressionsPerPost: number | null;
  }>;
  sparklines: Record<string, Array<{ date: string; followers: number }>>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: C.mono, fontSize: 11, color: C.textDim,
      textTransform: "uppercase", letterSpacing: "0.05em",
      marginBottom: 10, marginTop: 16,
    }}>
      {children}
    </div>
  );
}

function FollowerCards() {
  const [data, setData] = useState<FollowerSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<FollowerSummaryData>("/api/creator/followers")
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null; // Don't block analytics render
  if (!data || data.total === 0) return null;

  const platforms = Object.entries(data.byPlatform);
  const pctFmt = (n: number | null) => n != null ? `${(n * 100).toFixed(1)}%` : "--";
  const deltaColor = (n: number) => n > 0 ? "#6fcf9a" : n < 0 ? C.reminder : C.textDim;
  const deltaArrow = (n: number) => n > 0 ? "+" : "";

  return (
    <div>
      <SectionLabel>Audience Growth</SectionLabel>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        {/* Total card */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: "14px 18px", minWidth: 160, flex: 1,
        }}>
          <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, textTransform: "uppercase", marginBottom: 4 }}>
            Total Followers
          </div>
          <div style={{ fontFamily: C.serif, fontSize: 28, color: C.cream, fontStyle: "italic" }}>
            {data.total.toLocaleString()}
          </div>
        </div>

        {/* Per-platform cards */}
        {platforms.map(([platform, stats]) => {
          const sparkline = data.sparklines[platform] ?? [];
          const sparkMax = Math.max(...sparkline.map((s) => s.followers), 1);
          const sparkMin = Math.min(...sparkline.map((s) => s.followers), 0);
          const sparkRange = sparkMax - sparkMin || 1;

          return (
            <div key={platform} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "14px 18px", minWidth: 200, flex: 1,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, textTransform: "uppercase" }}>
                  {platform}
                </span>
                {/* Mini sparkline */}
                {sparkline.length > 2 && (
                  <svg width={60} height={20} viewBox={`0 0 ${sparkline.length - 1} 20`}>
                    <polyline
                      fill="none"
                      stroke={C.cl}
                      strokeWidth={1.5}
                      points={sparkline.map((s, i) => `${i},${20 - ((s.followers - sparkMin) / sparkRange) * 18}`).join(" ")}
                    />
                  </svg>
                )}
              </div>
              <div style={{ fontFamily: C.serif, fontSize: 22, color: C.cream, fontStyle: "italic" }}>
                {stats.current.toLocaleString()}
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 6, fontFamily: C.mono, fontSize: 10 }}>
                <span style={{ color: deltaColor(stats.delta7d) }}>
                  7d: {deltaArrow(stats.delta7d)}{stats.delta7d} ({deltaArrow(stats.growthRate7d)}{stats.growthRate7d}%)
                </span>
                <span style={{ color: deltaColor(stats.delta30d) }}>
                  30d: {deltaArrow(stats.delta30d)}{stats.delta30d} ({deltaArrow(stats.growthRate30d)}{stats.growthRate30d}%)
                </span>
              </div>
              {/* KPI row */}
              <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                {stats.engagementRate != null && <KPIChip label="Eng" value={pctFmt(stats.engagementRate)} />}
                {stats.reachRate != null && <KPIChip label="Reach" value={pctFmt(stats.reachRate)} />}
                {stats.viralityRate != null && <KPIChip label="Viral" value={pctFmt(stats.viralityRate)} />}
                {stats.nonFollowerPct != null && <KPIChip label="Non-fol" value={pctFmt(stats.nonFollowerPct)} />}
                {stats.avgImpressionsPerPost != null && <KPIChip label="Avg imp" value={Math.round(stats.avgImpressionsPerPost).toLocaleString()} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KPIChip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      fontFamily: C.mono, fontSize: 9, color: C.textDim,
      background: `${C.border}40`, padding: "2px 6px", borderRadius: 4,
    }}>
      {label}: <span style={{ color: C.cream }}>{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Strategy Tab
// ---------------------------------------------------------------------------

interface StrategyData {
  insights: Array<{ type: string; content: string; confidence: number; data: Record<string, unknown>; created_at: string }>;
  recommendations: Array<{ topic: string; platform: string; format: string; suggestedTiming: string; rationale: string; trendRelevance: number }>;
  velocity: { postsPerWeek: number; platformBreakdown: Record<string, number>; bestTimes: string[] } | null;
  trends: Array<{ topic: string; platform: string | null; relevance_score: number; context: string | null }>;
  lastUpdated: string | null;
}

function StrategyTab() {
  const [data, setData] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [regenMessage, setRegenMessage] = useState<string | null>(null);

  const fetchStrategy = useCallback(() => {
    setLoading(true);
    api<StrategyData>("/api/creator/strategy")
      .then(setData)
      .catch((err) => {
        console.error("[strategy] fetch error:", err);
        const msg = err instanceof Error ? err.message : "Request failed";
        setRegenMessage(msg === "Load failed" ? "Request timed out - please retry." : msg);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchStrategy(); }, [fetchStrategy]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setRegenMessage(null);
    try {
      const result = await api<{ success: boolean; recommendations: number; insights: number; shifts: string[] }>(
        "/api/creator/strategy",
        { method: "POST", body: JSON.stringify({}) }
      );
      setRegenMessage(`Updated: ${result.insights} insights, ${result.recommendations} recommendations`);
      fetchStrategy();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to regenerate";
      setRegenMessage(msg === "Load failed" ? "Request timed out. Strategy generation can take up to a minute - please try again." : msg);
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;

  const empty = !data || (!data.insights.length && !data.trends.length);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <SectionLabel>Social Media Strategy</SectionLabel>
          {data?.lastUpdated && (
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>
              Last updated: {new Date(data.lastUpdated).toLocaleDateString()}
            </span>
          )}
        </div>
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          style={{
            background: C.cl, color: C.bg, border: "none", borderRadius: 6,
            padding: "6px 14px", fontFamily: C.sans, fontSize: 12, cursor: "pointer",
            opacity: regenerating ? 0.5 : 1,
          }}
        >
          {regenerating ? "Analyzing..." : "Regenerate Strategy"}
        </button>
      </div>

      {regenMessage && (
        <div style={{ fontFamily: C.mono, fontSize: 11, color: C.gpt, marginBottom: 16 }}>
          {regenMessage}
        </div>
      )}

      {empty ? (
        <div style={{ padding: 40, textAlign: "center", color: C.textDim, fontFamily: C.sans, fontSize: 13 }}>
          No strategy generated yet. Click &quot;Regenerate Strategy&quot; to analyze your content and generate recommendations.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Velocity & Timing */}
          {data?.velocity && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 18 }}>
              <SectionLabel>Posting Velocity & Timing</SectionLabel>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 8 }}>
                <div>
                  <span style={{ fontFamily: C.serif, fontSize: 24, color: C.cream, fontStyle: "italic" }}>
                    {data.velocity.postsPerWeek}
                  </span>
                  <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, marginLeft: 6 }}>posts/week target</span>
                </div>
                {Object.entries(data.velocity.platformBreakdown).map(([p, count]) => (
                  <span key={p} style={{ fontFamily: C.mono, fontSize: 11, color: C.textDim }}>
                    {p}: <span style={{ color: C.cream }}>{count}/wk</span>
                  </span>
                ))}
              </div>
              {data.velocity.bestTimes.length > 0 && (
                <div style={{ marginTop: 10, fontFamily: C.mono, fontSize: 11, color: C.textDim }}>
                  Best times: {data.velocity.bestTimes.map((t, i) => (
                    <span key={i} style={{ color: C.cream, marginRight: 8 }}>{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Content Recommendations */}
          {data && data.recommendations.length > 0 && (
            <div>
              <SectionLabel>Content Recommendations</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.recommendations.map((rec, i) => (
                  <div key={i} style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 16px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontFamily: C.sans, fontSize: 13, color: C.cream }}>{rec.topic}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <span style={statusBadge(rec.platform)}>{rec.platform}</span>
                        <span style={{ ...statusBadge(rec.format), color: C.gold, borderColor: `${C.gold}30`, background: `${C.gold}10` }}>
                          {rec.format.replace("_", " ")}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, marginTop: 6 }}>
                      {rec.rationale}
                    </div>
                    {rec.suggestedTiming && (
                      <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginTop: 4, display: "inline-block" }}>
                        Timing: {rec.suggestedTiming}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strategic Insights */}
          {data && data.insights.length > 0 && (
            <div>
              <SectionLabel>Strategic Insights</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.insights.map((insight, i) => (
                  <div key={i} style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 16px",
                    borderLeft: `3px solid ${insight.confidence > 0.7 ? C.gpt : insight.confidence > 0.4 ? C.gold : C.textDim}`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={statusBadge(insight.type)}>{insight.type.replace("_", " ")}</span>
                      <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>
                        {Math.round(insight.confidence * 100)}% confidence
                      </span>
                    </div>
                    <div style={{ fontFamily: C.sans, fontSize: 12, color: C.text, lineHeight: 1.5 }}>
                      {insight.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trend Signals */}
          {data && data.trends.length > 0 && (
            <div>
              <SectionLabel>Active Trends</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.trends.map((trend, i) => (
                  <div key={i} style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <div>
                      <span style={{ fontFamily: C.sans, fontSize: 12, color: C.cream }}>{trend.topic}</span>
                      {trend.context && (
                        <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, marginTop: 2 }}>
                          {trend.context}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {trend.platform && <span style={statusBadge(trend.platform)}>{trend.platform}</span>}
                      <span style={{ fontFamily: C.mono, fontSize: 10, color: C.cl }}>
                        {Math.round(trend.relevance_score * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
