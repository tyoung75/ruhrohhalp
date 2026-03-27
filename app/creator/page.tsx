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
  // Track feedback per item: "like" | "dislike" | "deleted" | null
  const [feedbackStates, setFeedbackStates] = useState<Record<string, string | null>>({});
  const [feedbackNotes, setFeedbackNotes] = useState<Record<string, string>>({});
  const [submittingFeedback, setSubmittingFeedback] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // "I deleted this" flow — shows reason prompt
  const [deletedPromptId, setDeletedPromptId] = useState<string | null>(null);
  // Track which items already have feedback saved (green check)
  const [savedItems, setSavedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLoading(true);
    api<QueueResponse>("/api/creator/queue?status=posted&limit=100")
      .then((data) => setItems(data.items))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function submitFeedback(itemId: string, overrideType?: string, overrideContent?: string) {
    const state = overrideType ?? feedbackStates[itemId];
    const note = overrideContent ?? feedbackNotes[itemId] ?? "";
    if (!state) return;

    // Map UI states to API feedback types
    let feedbackType: string;
    let content: string;
    if (state === "deleted") {
      feedbackType = "dislike";
      content = `[DELETED POST] ${note || "Post was deleted — do not repeat this style/topic."}`;
    } else if (state === "dislike") {
      feedbackType = "dislike";
      content = note || "Disliked this post.";
    } else if (state === "like") {
      feedbackType = "like";
      content = note || "Liked this post — more like this.";
    } else {
      feedbackType = "correction";
      content = note;
    }

    setSubmittingFeedback(itemId);
    try {
      const item = items.find((i) => i.id === itemId);
      await api("/api/creator/feedback", {
        method: "POST",
        body: JSON.stringify({
          contentQueueId: itemId,
          feedbackType,
          content,
          context: {
            postBody: item?.body?.slice(0, 300),
            platform: item?.platform,
            action: state,
          },
        }),
      });
      setSavedItems((prev) => ({ ...prev, [itemId]: true }));
      setFeedbackNotes((prev) => ({ ...prev, [itemId]: "" }));
      setDeletedPromptId(null);
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
        const currentState = feedbackStates[item.id] ?? null;
        const isSaving = submittingFeedback === item.id;
        const hasSaved = savedItems[item.id] ?? false;
        const isDeletePrompt = deletedPromptId === item.id;

        return (
          <div
            key={item.id}
            style={{
              background: C.card,
              border: `1px solid ${currentState === "deleted" ? "#ef444480" : C.border}`,
              borderRadius: 8,
              padding: "14px 16px",
              animation: "fadeUp 0.22s ease both",
              opacity: currentState === "deleted" ? 0.6 : 1,
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
                  {/* Saved indicator */}
                  {hasSaved && (
                    <span style={{ fontSize: 11, color: C.gpt }}>Saved</span>
                  )}
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
                {/* Quick action row: thumbs up, thumbs down, I deleted this */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  {/* Thumbs up */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFeedbackStates((prev) => ({
                        ...prev,
                        [item.id]: prev[item.id] === "like" ? null : "like",
                      }));
                      setDeletedPromptId(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "5px 12px",
                      borderRadius: 6,
                      border: `1px solid ${currentState === "like" ? C.gpt : C.border}`,
                      background: currentState === "like" ? `${C.gpt}18` : "transparent",
                      color: currentState === "like" ? C.gpt : C.textDim,
                      fontFamily: C.sans,
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: 14 }}>&#x1F44D;</span> More like this
                  </button>

                  {/* Thumbs down */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFeedbackStates((prev) => ({
                        ...prev,
                        [item.id]: prev[item.id] === "dislike" ? null : "dislike",
                      }));
                      setDeletedPromptId(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "5px 12px",
                      borderRadius: 6,
                      border: `1px solid ${currentState === "dislike" ? "#ef4444" : C.border}`,
                      background: currentState === "dislike" ? "#ef444418" : "transparent",
                      color: currentState === "dislike" ? "#ef4444" : C.textDim,
                      fontFamily: C.sans,
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: 14 }}>&#x1F44E;</span> Less like this
                  </button>

                  {/* I deleted this */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFeedbackStates((prev) => ({ ...prev, [item.id]: "deleted" }));
                      setDeletedPromptId(item.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "5px 12px",
                      borderRadius: 6,
                      border: `1px solid ${currentState === "deleted" ? "#ef4444" : C.border}`,
                      background: currentState === "deleted" ? "#ef444418" : "transparent",
                      color: currentState === "deleted" ? "#ef4444" : C.textDim,
                      fontFamily: C.sans,
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontSize: 13 }}>&#x1F5D1;</span> I deleted this
                  </button>
                </div>

                {/* Delete reason prompt */}
                {isDeletePrompt && (
                  <div style={{
                    background: "#ef444410",
                    border: "1px solid #ef444430",
                    borderRadius: 6,
                    padding: "10px 12px",
                    marginBottom: 10,
                  }}>
                    <div style={{ fontFamily: C.sans, fontSize: 11, color: "#ef4444", marginBottom: 6, fontWeight: 600 }}>
                      Why did you delete it? This helps the agent avoid repeating the mistake.
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        placeholder="e.g. Too salesy, wrong tone, not relevant..."
                        value={feedbackNotes[item.id] ?? ""}
                        onChange={(e) =>
                          setFeedbackNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitFeedback(item.id);
                        }}
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
                        disabled={isSaving}
                        style={{
                          background: "#ef4444",
                          border: "none",
                          color: "#fff",
                          padding: "6px 14px",
                          borderRadius: 6,
                          fontFamily: C.sans,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: isSaving ? "wait" : "pointer",
                          opacity: isSaving ? 0.5 : 1,
                        }}
                      >
                        {isSaving ? "..." : "Save"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Optional note + submit for like/dislike */}
                {(currentState === "like" || currentState === "dislike") && !isDeletePrompt && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input
                      type="text"
                      placeholder={currentState === "like" ? "What did you like? (optional)" : "What was wrong? (optional)"}
                      value={feedbackNotes[item.id] ?? ""}
                      onChange={(e) =>
                        setFeedbackNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitFeedback(item.id);
                      }}
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
                      disabled={isSaving}
                      style={{
                        background: currentState === "like" ? C.gpt : "#ef4444",
                        border: "none",
                        color: "#fff",
                        padding: "6px 14px",
                        borderRadius: 6,
                        fontFamily: C.sans,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: isSaving ? "wait" : "pointer",
                        opacity: isSaving ? 0.5 : 1,
                      }}
                    >
                      {isSaving ? "..." : "Save"}
                    </button>
                  </div>
                )}

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
// Strategy Tab — Redesigned
// ---------------------------------------------------------------------------

interface StrategyData {
  insights: Array<{ type: string; content: string; confidence: number; data: Record<string, unknown>; created_at: string }>;
  recommendations: Array<{ topic: string; platform: string; format: string; suggestedTiming: string; rationale: string; trendRelevance: number; pillar?: string }>;
  velocity: { postsPerWeek: number; platformBreakdown: Record<string, number>; bestTimes: string[] } | null;
  trends: Array<{ topic: string; platform: string | null; relevance_score: number; context: string | null }>;
  lastUpdated: string | null;
}

interface FeedbackItem {
  id: string;
  feedback_type: string;
  content: string;
  context: Record<string, unknown> | null;
  created_at: string;
}

const PILLARS = [
  { id: "running", label: "Running & Endurance", color: C.cl, icon: "🏃" },
  { id: "building", label: "Building in Public", color: C.gem, icon: "⚡" },
  { id: "nyc", label: "NYC Lifestyle", color: C.gold, icon: "🏙" },
  { id: "fitness", label: "Fitness & Strength", color: C.gpt, icon: "💪" },
  { id: "travel", label: "Travel & Adventure", color: C.note, icon: "✈" },
];

const PLATFORM_ICONS: Record<string, string> = {
  threads: "◉",
  instagram: "◧",
  tiktok: "▶",
  youtube: "▷",
};

const PLATFORM_COLORS: Record<string, string> = {
  threads: C.text,
  instagram: "#E1306C",
  tiktok: "#69C9D0",
  youtube: "#FF0000",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_SLOTS = ["Morning", "Midday", "Evening", "Late"];

function StrategyTab() {
  const [data, setData] = useState<StrategyData | null>(null);
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [regenMessage, setRegenMessage] = useState<string | null>(null);
  const [feedbackInput, setFeedbackInput] = useState("");
  const [feedbackType, setFeedbackType] = useState<"directive" | "dislike" | "correction">("directive");
  const [feedbackSending, setFeedbackSending] = useState(false);

  const fetchStrategy = useCallback(() => {
    setLoading(true);
    Promise.all([
      api<StrategyData>("/api/creator/strategy").catch(() => null),
      api<{ feedback: FeedbackItem[] }>("/api/creator/feedback?limit=10").catch(() => ({ feedback: [] })),
    ]).then(([strat, fb]) => {
      setData(strat);
      setFeedbackList(fb?.feedback ?? []);
    }).finally(() => setLoading(false));
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
      setRegenMessage(`Strategy updated: ${result.insights} insights, ${result.recommendations} recommendations`);
      fetchStrategy();
    } catch (err) {
      setRegenMessage(err instanceof Error ? err.message : "Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  };

  const submitFeedback = async () => {
    if (!feedbackInput.trim()) return;
    setFeedbackSending(true);
    try {
      await api("/api/creator/feedback", {
        method: "POST",
        body: JSON.stringify({
          feedbackType,
          content: feedbackInput.trim(),
        }),
      });
      setFeedbackInput("");
      fetchStrategy(); // refresh feedback list
    } catch (err) {
      console.error("Feedback submit failed:", err);
    } finally {
      setFeedbackSending(false);
    }
  };

  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);

  const generateFromRec = async (rec: StrategyData["recommendations"][0], idx: number) => {
    setGeneratingIdx(idx);
    try {
      await api("/api/creator/generate", {
        method: "POST",
        body: JSON.stringify({
          seedTopic: rec.topic,
          seedPlatform: rec.platform,
          seedFormat: rec.format,
          seedRationale: rec.rationale,
        }),
      });
      setRegenMessage(`Content generated from: "${rec.topic.slice(0, 60)}..."`);
    } catch (err) {
      console.error("Generate from rec failed:", err);
    } finally {
      setGeneratingIdx(null);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center" }}><Spinner /></div>;

  const empty = !data || (!data.insights.length && !data.recommendations.length && !data.trends.length);

  // Build "Today" recommendations — filter to today's day name
  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const todayShort = new Date().toLocaleDateString("en-US", { weekday: "short" });
  const todayRecs = (data?.recommendations ?? []).filter((r) => {
    if (!r.suggestedTiming) return false;
    const timing = r.suggestedTiming.toLowerCase();
    return timing.includes(todayName.toLowerCase()) || timing.includes(todayShort.toLowerCase()) || timing.includes("daily") || timing.includes("today");
  });
  // If no day-specific recs, show the top 3 by relevance
  const heroRecs = todayRecs.length > 0 ? todayRecs.slice(0, 3) : (data?.recommendations ?? []).slice(0, 3);

  // Group recommendations by day for the game plan grid
  const _recs = data?.recommendations ?? [];
  const _recsByDay: Record<string, StrategyData["recommendations"]> = {};
  for (const rec of data?.recommendations ?? []) {
    const day = rec.suggestedTiming?.split(/\s+/)[0] ?? "Anytime";
    if (!recsByDay[day]) recsByDay[day] = [];
    recsByDay[day].push(rec);
  }

  // Pillar coverage: count recs per pillar
  const pillarCounts: Record<string, number> = {};
  for (const rec of data?.recommendations ?? []) {
    const pillar = rec.pillar ?? guessPillar(rec.topic + " " + rec.rationale);
    pillarCounts[pillar] = (pillarCounts[pillar] ?? 0) + 1;
  }

  // Split insights into what's working vs what needs adjustment
  const working = (data?.insights ?? []).filter(
    (i) => i.type === "content_pattern" || i.type === "algorithm" || (i.confidence > 0.7 && i.type !== "trend_shift")
  );
  const adjustments = (data?.insights ?? []).filter(
    (i) => i.type === "trend_shift" || i.type === "platform_rec" || i.type === "velocity" || i.type === "audience" ||
    (i.confidence <= 0.7 && i.type !== "content_pattern" && i.type !== "algorithm")
  );

  // Build timing heatmap from best times
  const heatmap = buildTimingHeatmap(data?.velocity?.bestTimes ?? []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontFamily: C.serif, fontSize: 20, color: C.cream, fontStyle: "italic" }}>
            Your Strategy
          </div>
          {data?.lastUpdated && (
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>
              Updated {new Date(data.lastUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          style={{
            background: regenerating ? C.card : C.cl,
            color: regenerating ? C.textDim : C.bg,
            border: regenerating ? `1px solid ${C.border}` : "none",
            borderRadius: 6, padding: "8px 16px",
            fontFamily: C.sans, fontSize: 12, fontWeight: 600,
            cursor: regenerating ? "wait" : "pointer",
          }}
        >
          {regenerating ? "Analyzing all sources..." : "Regenerate Strategy"}
        </button>
      </div>
      {regenMessage && (
        <div style={{ fontFamily: C.mono, fontSize: 11, color: C.gpt, padding: "6px 10px", background: C.gptDim, borderRadius: 6 }}>
          {regenMessage}
        </div>
      )}

      {empty ? (
        <div style={{ padding: 60, textAlign: "center", color: C.textDim, fontFamily: C.sans }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>◉</div>
          <div style={{ fontSize: 14 }}>No strategy generated yet.</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Click &quot;Regenerate Strategy&quot; to analyze your content across all platforms and generate tailored recommendations.</div>
        </div>
      ) : (
        <>
          {/* ── 0. Today's Focus (hero) ── */}
          {heroRecs.length > 0 && (
            <div style={{
              background: `linear-gradient(135deg, ${C.card}, ${C.surface})`,
              border: `1px solid ${C.cl}30`,
              borderRadius: 10, padding: 20,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: C.serif, fontSize: 18, color: C.cream, fontStyle: "italic" }}>
                    Today&apos;s Focus
                  </div>
                  <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>
                    {todayName} — {heroRecs.length} content {heroRecs.length === 1 ? "idea" : "ideas"} ready
                  </span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {heroRecs.map((rec, i) => (
                  <div key={`today-${i}`} style={{
                    background: C.card, borderRadius: 8, padding: "14px 16px",
                    borderLeft: `3px solid ${PLATFORM_COLORS[rec.platform] ?? C.cl}`,
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 13 }}>{PLATFORM_ICONS[rec.platform] ?? "○"}</span>
                        <span style={{ fontFamily: C.sans, fontSize: 13, color: C.cream, fontWeight: 500 }}>
                          {rec.topic}
                        </span>
                      </div>
                      <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>
                        {rec.suggestedTiming} · {rec.format.replace(/_/g, " ")}
                      </span>
                    </div>
                    <button
                      onClick={() => generateFromRec(rec, i)}
                      disabled={generatingIdx === i}
                      style={{
                        background: generatingIdx === i ? C.surface : `${C.cl}20`,
                        color: C.cl, border: `1px solid ${C.cl}40`,
                        borderRadius: 6, padding: "6px 12px",
                        fontFamily: C.mono, fontSize: 10, cursor: generatingIdx === i ? "wait" : "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {generatingIdx === i ? "Generating..." : "Generate This"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 1. This Week's Game Plan ── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <SectionLabel>This Week&apos;s Game Plan</SectionLabel>
            {data?.velocity && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                <StatBox label="Posts / Week" value={String(data.velocity.postsPerWeek)} color={C.cream} />
                {Object.entries(data.velocity.platformBreakdown).map(([p, count]) => (
                  <StatBox key={p} label={p} value={`${count}/wk`} color={PLATFORM_COLORS[p] ?? C.textDim} />
                ))}
              </div>
            )}

            {/* Recommendation cards grouped by platform */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(data?.recommendations ?? []).map((rec, i) => (
                <div key={i} style={{
                  background: C.surface, borderRadius: 8, padding: "12px 16px",
                  borderLeft: `3px solid ${PLATFORM_COLORS[rec.platform] ?? C.textDim}`,
                  display: "flex", gap: 12, alignItems: "flex-start",
                }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12 }}>{PLATFORM_ICONS[rec.platform] ?? "○"}</span>
                      <span style={{ fontFamily: C.sans, fontSize: 13, color: C.cream, fontWeight: 500 }}>
                        {rec.topic}
                      </span>
                    </div>
                    <div style={{ fontFamily: C.sans, fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>
                      {rec.rationale}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                    <span style={{
                      fontFamily: C.mono, fontSize: 9, color: PLATFORM_COLORS[rec.platform] ?? C.textDim,
                      background: `${PLATFORM_COLORS[rec.platform] ?? C.textDim}15`,
                      padding: "2px 8px", borderRadius: 4,
                    }}>
                      {rec.platform}
                    </span>
                    <span style={{
                      fontFamily: C.mono, fontSize: 9, color: C.gold,
                      background: `${C.gold}15`, padding: "2px 8px", borderRadius: 4,
                    }}>
                      {rec.format.replace(/_/g, " ")}
                    </span>
                    {rec.suggestedTiming && (
                      <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>
                        {rec.suggestedTiming}
                      </span>
                    )}
                    <button
                      onClick={() => generateFromRec(rec, 100 + i)}
                      disabled={generatingIdx === 100 + i}
                      style={{
                        background: generatingIdx === 100 + i ? C.surface : `${C.cl}15`,
                        color: C.cl, border: `1px solid ${C.cl}30`,
                        borderRadius: 4, padding: "3px 8px", marginTop: 2,
                        fontFamily: C.mono, fontSize: 9, cursor: generatingIdx === 100 + i ? "wait" : "pointer",
                      }}
                    >
                      {generatingIdx === 100 + i ? "..." : "Generate"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 2. Brand Pillar Coverage ── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <SectionLabel>Brand Pillar Coverage</SectionLabel>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {PILLARS.map((p) => {
                const count = pillarCounts[p.id] ?? 0;
                const isActive = count > 0;
                return (
                  <div key={p.id} style={{
                    flex: "1 1 140px", minWidth: 140,
                    background: isActive ? `${p.color}12` : C.surface,
                    border: `1px solid ${isActive ? `${p.color}40` : C.border}`,
                    borderRadius: 8, padding: "12px 14px",
                    opacity: isActive ? 1 : 0.5,
                  }}>
                    <div style={{ fontSize: 16, marginBottom: 4 }}>{p.icon}</div>
                    <div style={{ fontFamily: C.sans, fontSize: 11, color: isActive ? p.color : C.textDim, fontWeight: 500 }}>
                      {p.label}
                    </div>
                    <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginTop: 2 }}>
                      {count > 0 ? `${count} rec${count !== 1 ? "s" : ""} this week` : "No recs — consider adding"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 3. What's Working / Adjustments ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* What's Working */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
              <SectionLabel>What&apos;s Working</SectionLabel>
              {working.length === 0 ? (
                <div style={{ fontFamily: C.sans, fontSize: 12, color: C.textFaint, padding: 12 }}>
                  Generate strategy to see patterns
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {working.slice(0, 4).map((insight, i) => (
                    <div key={i} style={{
                      borderLeft: `2px solid ${C.gpt}`,
                      paddingLeft: 12,
                    }}>
                      <div style={{ fontFamily: C.sans, fontSize: 12, color: C.text, lineHeight: 1.5 }}>
                        {insight.content}
                      </div>
                      <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginTop: 2 }}>
                        {insight.type.replace(/_/g, " ")} · {Math.round(insight.confidence * 100)}%
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Adjustments Needed */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
              <SectionLabel>Adjust & Improve</SectionLabel>
              {adjustments.length === 0 ? (
                <div style={{ fontFamily: C.sans, fontSize: 12, color: C.textFaint, padding: 12 }}>
                  No adjustments identified yet
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {adjustments.slice(0, 4).map((insight, i) => (
                    <div key={i} style={{
                      borderLeft: `2px solid ${C.gold}`,
                      paddingLeft: 12,
                    }}>
                      <div style={{ fontFamily: C.sans, fontSize: 12, color: C.text, lineHeight: 1.5 }}>
                        {insight.content}
                      </div>
                      <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginTop: 2 }}>
                        {insight.type.replace(/_/g, " ")} · {Math.round(insight.confidence * 100)}%
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── 4. Timing Heatmap ── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
            <SectionLabel>Best Posting Times</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "60px repeat(7, 1fr)", gap: 4 }}>
              {/* Header row */}
              <div />
              {DAY_LABELS.map((d) => (
                <div key={d} style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textAlign: "center", paddingBottom: 4 }}>
                  {d}
                </div>
              ))}
              {/* Slot rows */}
              {TIME_SLOTS.map((slot, si) => (
                <>
                  <div key={`label-${si}`} style={{ fontFamily: C.mono, fontSize: 9, color: C.textDim, display: "flex", alignItems: "center" }}>
                    {slot}
                  </div>
                  {DAY_LABELS.map((_, di) => {
                    const heat = heatmap[si]?.[di] ?? 0;
                    return (
                      <div key={`${si}-${di}`} style={{
                        background: heat > 0 ? `${C.cl}${Math.round(heat * 60 + 15).toString(16)}` : C.surface,
                        borderRadius: 4, height: 28,
                        border: `1px solid ${heat > 0.5 ? `${C.cl}40` : C.border}`,
                      }} />
                    );
                  })}
                </>
              ))}
            </div>
            {data?.velocity?.bestTimes && data.velocity.bestTimes.length > 0 && (
              <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, marginTop: 10 }}>
                Peak times: {data.velocity.bestTimes.map((t, i) => (
                  <span key={i} style={{ color: C.cl, marginRight: 10 }}>{t}</span>
                ))}
              </div>
            )}
          </div>

          {/* ── 5. Trend Radar ── */}
          {(data?.trends ?? []).length > 0 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
              <SectionLabel>Trend Radar</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(data?.trends ?? []).map((trend, i) => {
                  const isHot = trend.relevance_score > 0.7;
                  return (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 12px", borderRadius: 6,
                      background: isHot ? `${C.cl}10` : C.surface,
                      border: `1px solid ${isHot ? `${C.cl}30` : C.border}`,
                    }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontFamily: C.sans, fontSize: 12, color: C.cream }}>
                          {isHot ? "🔥 " : ""}{trend.topic}
                        </span>
                        {trend.context && (
                          <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, marginTop: 2 }}>
                            {trend.context}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                        {trend.platform && (
                          <span style={{ fontFamily: C.mono, fontSize: 9, color: PLATFORM_COLORS[trend.platform] ?? C.textDim }}>
                            {PLATFORM_ICONS[trend.platform] ?? ""} {trend.platform}
                          </span>
                        )}
                        <span style={{
                          fontFamily: C.mono, fontSize: 10, fontWeight: 600,
                          color: isHot ? C.cl : C.textDim,
                        }}>
                          {Math.round(trend.relevance_score * 100)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── 6. Feedback Panel (always visible) ── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20 }}>
        <SectionLabel>Talk to Your Strategy Agent</SectionLabel>
        <div style={{ fontFamily: C.sans, fontSize: 11, color: C.textDim, marginBottom: 12 }}>
          Give the AI direct instructions. Directives are permanent rules. Dislikes flag content patterns to avoid. Corrections explain what should change.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {(["directive", "dislike", "correction"] as const).map((t) => (
            <button key={t} onClick={() => setFeedbackType(t)} style={{
              background: feedbackType === t ? `${C.cl}20` : C.surface,
              border: `1px solid ${feedbackType === t ? C.cl : C.border}`,
              color: feedbackType === t ? C.cl : C.textDim,
              borderRadius: 6, padding: "4px 12px",
              fontFamily: C.mono, fontSize: 10, cursor: "pointer",
              textTransform: "uppercase",
            }}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={feedbackInput}
            onChange={(e) => setFeedbackInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitFeedback()}
            placeholder={
              feedbackType === "directive" ? "e.g., Never use engagement bait or clickbait tactics"
              : feedbackType === "dislike" ? "e.g., That running puns post was cringe — too forced"
              : "e.g., The Iron Passport post should have mentioned the June deadline"
            }
            style={{
              flex: 1, background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 6, padding: "8px 12px",
              fontFamily: C.sans, fontSize: 12, color: C.text,
              outline: "none",
            }}
          />
          <button
            onClick={submitFeedback}
            disabled={feedbackSending || !feedbackInput.trim()}
            style={{
              background: C.cl, color: C.bg, border: "none", borderRadius: 6,
              padding: "8px 16px", fontFamily: C.sans, fontSize: 12, fontWeight: 600,
              cursor: feedbackSending ? "wait" : "pointer",
              opacity: feedbackSending || !feedbackInput.trim() ? 0.5 : 1,
            }}
          >
            Send
          </button>
        </div>

        {/* Recent feedback */}
        {feedbackList.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginBottom: 6, textTransform: "uppercase" }}>
              Recent feedback
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {feedbackList.slice(0, 5).map((fb) => (
                <div key={fb.id} style={{
                  display: "flex", gap: 8, alignItems: "flex-start",
                  padding: "6px 10px", borderRadius: 4, background: C.surface,
                }}>
                  <span style={{
                    fontFamily: C.mono, fontSize: 9,
                    color: fb.feedback_type === "directive" ? C.cl : fb.feedback_type === "dislike" ? C.reminder : C.gold,
                    textTransform: "uppercase", flexShrink: 0, paddingTop: 1,
                  }}>
                    {fb.feedback_type}
                  </span>
                  <span style={{ fontFamily: C.sans, fontSize: 11, color: C.textDim, lineHeight: 1.4 }}>
                    {fb.content}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helpers

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: C.surface, borderRadius: 6, padding: "8px 14px",
      border: `1px solid ${C.border}`,
    }}>
      <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textTransform: "uppercase", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontFamily: C.serif, fontSize: 18, color, fontStyle: "italic" }}>
        {value}
      </div>
    </div>
  );
}

function guessPillar(text: string): string {
  const lower = text.toLowerCase();
  if (/run|marathon|race|pace|mile|endurance|hyrox|vo2/i.test(lower)) return "running";
  if (/build|ship|code|motus|iron passport|mrr|deploy|app|dev|indie/i.test(lower)) return "building";
  if (/nyc|new york|city|manhattan|brooklyn/i.test(lower)) return "nyc";
  if (/gym|lift|strength|muscle|deadlift|squat|functional|concurrent/i.test(lower)) return "fitness";
  if (/travel|trip|adventure|destination|explore/i.test(lower)) return "travel";
  return "running"; // default
}

function buildTimingHeatmap(bestTimes: string[]): number[][] {
  // 4 rows (time slots) x 7 cols (days). Populate from best times.
  const grid: number[][] = Array.from({ length: 4 }, () => Array(7).fill(0));

  for (const t of bestTimes) {
    // Parse times like "7:30 AM ET", "12:00 PM ET", "9:30 PM ET"
    const match = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) continue;
    let hour = parseInt(match[1], 10);
    if (match[3].toUpperCase() === "PM" && hour < 12) hour += 12;
    if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;

    // Map hour to slot
    let slot = 0;
    if (hour >= 6 && hour < 11) slot = 0;      // Morning
    else if (hour >= 11 && hour < 15) slot = 1; // Midday
    else if (hour >= 15 && hour < 20) slot = 2; // Evening
    else slot = 3;                                // Late

    // Light up weekdays more than weekends
    for (let d = 0; d < 7; d++) {
      const weight = d < 5 ? 0.8 : 0.4; // weekday vs weekend
      grid[slot][d] = Math.min(1, grid[slot][d] + weight);
    }
  }

  return grid;
}
