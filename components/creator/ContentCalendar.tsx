"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";

interface QueueItem {
  id: string;
  platform: string;
  content_type: string;
  body: string;
  status: string;
  scheduled_for: string | null;
  created_at: string;
  topic?: string;
}

const PILLAR_COLORS: Record<string, string> = {
  running: "#3B82F6",
  fitness: "#10B981",
  building: "#F59E0B",
  nyc: "#EC4899",
  travel: "#8B5CF6",
  default: C.textDim,
};

function guessPillar(body: string): string {
  const lower = body.toLowerCase();
  if (/run|marathon|mile|pace|race|berlin|hyrox/i.test(lower)) return "running";
  if (/gym|deadlift|squat|strength|bench|vo2|training/i.test(lower)) return "fitness";
  if (/build|ship|code|motus|app|startup|product/i.test(lower)) return "building";
  if (/nyc|new york|manhattan|brooklyn|coffee/i.test(lower)) return "nyc";
  if (/travel|flight|trip|food|restaurant/i.test(lower)) return "travel";
  return "default";
}

export function ContentCalendar() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [generating, setGenerating] = useState<string | null>(null);

  function loadItems() {
    api<{ items: QueueItem[] }>("/api/creator/queue?status=draft,queued,approved,posted&limit=200")
      .then((r) => setItems(r.items ?? []))
      .catch(() => {});
  }

  useEffect(() => { loadItems(); }, []);

  // Build 7-day calendar starting from Monday of current week + offset
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const today = now.toISOString().slice(0, 10);

  // Group items by date — use scheduled_for first, then created_at
  // For posted items: use created_at (they were posted that day)
  // For draft/queued/approved: use scheduled_for if set, otherwise skip (unscheduled)
  const byDate = new Map<string, QueueItem[]>();
  for (const day of days) byDate.set(day, []);

  const unscheduled: QueueItem[] = [];
  for (const item of items) {
    let date: string | null = null;
    if (item.status === "posted") {
      date = item.created_at?.slice(0, 10);
    } else if (item.scheduled_for) {
      date = item.scheduled_for.slice(0, 10);
    } else {
      // Drafts/queued without scheduled_for — show as unscheduled
      unscheduled.push(item);
      continue;
    }
    if (date && byDate.has(date)) byDate.get(date)?.push(item);
  }

  // Pillar distribution (only counted items)
  const allBodies = items.filter((i) => ["posted", "queued", "approved"].includes(i.status)).map((i) => i.body);
  const pillarCounts: Record<string, number> = {};
  for (const body of allBodies) {
    const p = guessPillar(body);
    pillarCounts[p] = (pillarCounts[p] ?? 0) + 1;
  }
  const totalPosts = allBodies.length || 1;

  async function generateForDay(date: string) {
    setGenerating(date);
    try {
      // Use the CoS to generate content for this specific day
      await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          message: `Generate 2 Threads posts for ${date}. Make sure they cover different content pillars. Schedule them for that day.`,
          page_context: "creator",
        }),
      });
      loadItems();
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Pillar coverage bar */}
      <div style={{ marginBottom: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
        <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Content Pillar Coverage</div>
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
          {Object.entries(pillarCounts).map(([pillar, count]) => (
            <div key={pillar} style={{ width: `${(count / totalPosts) * 100}%`, background: PILLAR_COLORS[pillar] ?? C.textDim }} />
          ))}
          {Object.keys(pillarCounts).length === 0 && <div style={{ width: "100%", background: C.border }} />}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.entries(pillarCounts).map(([pillar, count]) => (
            <span key={pillar} style={{ fontSize: 10, color: PILLAR_COLORS[pillar] ?? C.textDim }}>
              {pillar}: {Math.round((count / totalPosts) * 100)}%
            </span>
          ))}
          {Object.keys(pillarCounts).length === 0 && <span style={{ fontSize: 10, color: C.textFaint }}>No published content yet</span>}
        </div>
      </div>

      {/* Unscheduled drafts */}
      {unscheduled.length > 0 && (
        <div style={{ marginBottom: 16, background: `${C.gold}08`, border: `1px solid ${C.gold}25`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontFamily: C.mono, fontSize: 9, color: C.gold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
            {unscheduled.length} Unscheduled Draft{unscheduled.length !== 1 ? "s" : ""}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {unscheduled.slice(0, 5).map((item) => (
              <div key={item.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", fontSize: 10, color: C.textDim, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                [{item.platform}] {(item.body as string)?.slice(0, 40)}
              </div>
            ))}
            {unscheduled.length > 5 && <span style={{ fontSize: 10, color: C.textFaint }}>+{unscheduled.length - 5} more</span>}
          </div>
        </div>
      )}

      {/* Week navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <button onClick={() => setWeekOffset((w) => w - 1)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 12px", color: C.textDim, cursor: "pointer", fontFamily: C.mono, fontSize: 11 }}>&larr; Prev</button>
        <div style={{ textAlign: "center" }}>
          <span style={{ fontFamily: C.mono, fontSize: 11, color: C.textDim }}>
            {days[0]} — {days[6]}
          </span>
          {weekOffset === 0 && <span style={{ color: C.cl, marginLeft: 6, fontFamily: C.mono, fontSize: 10 }}>This Week</span>}
          {weekOffset > 0 && <span style={{ color: C.gem, marginLeft: 6, fontFamily: C.mono, fontSize: 10 }}>+{weekOffset}w</span>}
        </div>
        <button onClick={() => setWeekOffset((w) => w + 1)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 12px", color: C.textDim, cursor: "pointer", fontFamily: C.mono, fontSize: 11 }}>Next &rarr;</button>
      </div>

      {/* Calendar grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
        {days.map((date, i) => {
          const dayItems = byDate.get(date) ?? [];
          const isToday = date === today;
          const isFuture = date > today;
          const isEmpty = dayItems.length === 0;
          const isPast = date < today;

          return (
            <div key={date} style={{
              background: isToday ? `${C.cl}08` : C.surface,
              border: `1px solid ${isToday ? `${C.cl}30` : isEmpty && isFuture ? `${C.gold}20` : C.border}`,
              borderRadius: 8,
              padding: 8,
              minHeight: 110,
              opacity: isPast && !isToday ? 0.7 : 1,
            }}>
              <div style={{ fontFamily: C.mono, fontSize: 10, color: isToday ? C.cl : C.textFaint, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: isToday ? 700 : 400 }}>{dayLabels[i]}</span>
                <span>{date.slice(5)}</span>
              </div>
              {dayItems.map((item) => {
                const pillar = guessPillar(item.body);
                return (
                  <div key={item.id} style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${PILLAR_COLORS[pillar] ?? C.textDim}`,
                    borderRadius: 4,
                    padding: "4px 6px",
                    marginBottom: 4,
                    fontSize: 10,
                    color: C.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span style={{ fontFamily: C.mono, fontSize: 8, color: item.status === "posted" ? C.gpt : item.status === "approved" ? C.gem : C.textFaint }}>{item.status.slice(0, 3)}</span>
                      <span style={{ fontFamily: C.mono, fontSize: 8, color: PILLAR_COLORS[pillar] }}>{item.platform?.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div style={{ marginTop: 2 }}>{(item.body as string)?.slice(0, 50)}</div>
                  </div>
                );
              })}
              {isEmpty && isFuture && (
                <button
                  onClick={() => void generateForDay(date)}
                  disabled={generating === date}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: `1px dashed ${C.border}`,
                    borderRadius: 6,
                    padding: "8px 4px",
                    color: generating === date ? C.textDim : C.gold,
                    cursor: generating === date ? "default" : "pointer",
                    fontFamily: C.mono,
                    fontSize: 9,
                    textAlign: "center",
                  }}
                >
                  {generating === date ? "generating..." : "+ fill gap"}
                </button>
              )}
              {isEmpty && isPast && !isToday && (
                <div style={{ fontSize: 9, color: C.textFaint, textAlign: "center", padding: "8px 0" }}>—</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
