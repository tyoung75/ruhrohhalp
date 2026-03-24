"use client";

import { useState, useEffect, useCallback } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "queue" | "analytics" | "history";

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
];

const STATUS_COLORS: Record<string, string> = {
  draft: C.textDim,
  queued: C.gem,
  approved: C.gpt,
  posting: C.gold,
  posted: "#6fcf9a",
  failed: C.reminder,
  rejected: "#ef5555",
};

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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

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
        <div style={{ display: "flex", gap: 4 }}>
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
        </div>

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
          {items.map((item) => {
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
                    {isEditing ? (
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
                    ) : (
                      <div
                        style={{
                          fontFamily: C.sans,
                          fontSize: 13,
                          color: C.text,
                          lineHeight: 1.5,
                          whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                          overflow: isExpanded ? "visible" : "hidden",
                          textOverflow: isExpanded ? "unset" : "ellipsis",
                        }}
                      >
                        {item.body}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={statusBadge(item.status)}>{item.status}</span>
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
          })}
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
      {/* Period selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
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
