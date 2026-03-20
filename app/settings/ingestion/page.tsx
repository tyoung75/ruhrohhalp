"use client";

import { useState } from "react";
import { C } from "@/lib/ui";

interface IngestionSource {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: "active" | "configured" | "not-configured";
  description: string;
  webhookPath?: string;
  lastSync?: string;
  itemCount?: number;
}

const SOURCES: IngestionSource[] = [
  {
    id: "gmail",
    name: "Gmail",
    icon: "✉",
    color: "#ea4335",
    status: "configured",
    description: "Email ingestion via webhook. Processes incoming emails and extracts tasks, meetings, and context.",
    webhookPath: "/api/webhook/gmail",
    lastSync: undefined,
    itemCount: undefined,
  },
  {
    id: "calendar",
    name: "Google Calendar",
    icon: "◷",
    color: "#4285f4",
    status: "configured",
    description: "Calendar event sync. Pulls upcoming events, meeting details, and attendee info.",
    webhookPath: "/api/webhook/calendar",
  },
  {
    id: "linear",
    name: "Linear",
    icon: "▦",
    color: "#5e6ad2",
    status: "configured",
    description: "Bidirectional task sync with Linear. Mirrors issues, status changes, and assignments.",
    webhookPath: "/api/webhook/linear",
  },
  {
    id: "notion",
    name: "Notion Brain",
    icon: "▣",
    color: C.cream,
    status: "active",
    description: "Daily sync of 9 Notion brain pages into Supabase knowledge tables. Runs at 5:34 AM ET via Cowork scheduled task.",
    lastSync: "2026-03-20 05:34 ET",
    itemCount: 55,
  },
  {
    id: "voice",
    name: "Voice Memos",
    icon: "◉",
    color: C.cl,
    status: "configured",
    description: "Voice memo transcription via Whisper. Processes audio uploads into searchable text memories.",
    webhookPath: "/api/webhook/voice",
  },
  {
    id: "cron",
    name: "Daily Briefing (Cron)",
    icon: "◆",
    color: C.gold,
    status: "active",
    description: "Vercel cron job at 6 AM ET. Generates daily briefing and weekly CEO synthesis (Mondays).",
    webhookPath: "/api/cron",
    lastSync: undefined,
  },
  {
    id: "capture",
    name: "Quick Capture",
    icon: "✦",
    color: C.gpt,
    status: "active",
    description: "Webhook endpoint for quick capture from shortcuts, bookmarklets, or integrations.",
    webhookPath: "/api/webhook/capture",
  },
];

const STATUS_META = {
  active: { label: "Active", color: C.gpt, bg: `${C.gpt}14` },
  configured: { label: "Configured", color: C.gem, bg: `${C.gem}14` },
  "not-configured": { label: "Not Set Up", color: C.textFaint, bg: C.surface },
};

export default function IngestionPage() {
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 720, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: C.serif, fontSize: 22, fontStyle: "italic", color: C.cream }}>
          Ingestion Pipeline
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginTop: 4 }}>
          Data sources feeding into your brain. Configure webhooks, check sync status, and trigger manual syncs.
        </div>
      </div>

      {/* Summary bar */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 20,
          padding: "10px 14px",
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
        }}
      >
        {(["active", "configured", "not-configured"] as const).map((status) => {
          const count = SOURCES.filter((s) => s.status === status).length;
          const meta = STATUS_META[status];
          return (
            <div key={status} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: meta.color,
                  display: "inline-block",
                }}
              />
              <span style={{ fontFamily: C.mono, fontSize: 10, color: meta.color }}>
                {count} {meta.label.toLowerCase()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Source cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {SOURCES.map((source) => {
          const isExpanded = expandedSource === source.id;
          const meta = STATUS_META[source.status];

          return (
            <div
              key={source.id}
              className="fadeUp"
              style={{
                background: C.card,
                border: `1px solid ${isExpanded ? C.borderMid : C.border}`,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              {/* Card header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  cursor: "pointer",
                }}
                onClick={() => setExpandedSource(isExpanded ? null : source.id)}
              >
                <span style={{ fontSize: 16, color: source.color, width: 24, textAlign: "center" }}>
                  {source.icon}
                </span>

                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: C.sans, fontSize: 13, color: C.cream, fontWeight: 500 }}>
                    {source.name}
                  </div>
                </div>

                {/* Status badge */}
                <span
                  style={{
                    fontFamily: C.mono,
                    fontSize: 9,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: meta.bg,
                    color: meta.color,
                    border: `1px solid ${meta.color}28`,
                  }}
                >
                  {meta.label}
                </span>

                <span style={{ color: C.textFaint, fontSize: 10 }}>{isExpanded ? "▾" : "▸"}</span>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div
                  className="fadeUp"
                  style={{
                    padding: "0 14px 14px 48px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ fontFamily: C.sans, fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>
                    {source.description}
                  </div>

                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {source.webhookPath && (
                      <div>
                        <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, display: "block", marginBottom: 2 }}>
                          ENDPOINT
                        </span>
                        <code
                          style={{
                            fontFamily: C.mono,
                            fontSize: 10,
                            color: C.gem,
                            background: `${C.gem}10`,
                            padding: "2px 6px",
                            borderRadius: 3,
                          }}
                        >
                          {source.webhookPath}
                        </code>
                      </div>
                    )}
                    {source.lastSync && (
                      <div>
                        <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, display: "block", marginBottom: 2 }}>
                          LAST SYNC
                        </span>
                        <span style={{ fontFamily: C.mono, fontSize: 10, color: C.text }}>
                          {source.lastSync}
                        </span>
                      </div>
                    )}
                    {source.itemCount !== undefined && (
                      <div>
                        <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, display: "block", marginBottom: 2 }}>
                          ROWS
                        </span>
                        <span style={{ fontFamily: C.mono, fontSize: 10, color: C.text }}>
                          {source.itemCount}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 6, paddingTop: 4 }}>
                    <button
                      style={{
                        padding: "5px 12px",
                        borderRadius: 6,
                        border: `1px solid ${C.border}`,
                        background: "none",
                        color: C.textDim,
                        fontFamily: C.mono,
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                      onClick={() => alert(`Manual sync for ${source.name} not yet implemented. This will trigger the webhook manually.`)}
                    >
                      ↻ Manual Sync
                    </button>
                    <button
                      style={{
                        padding: "5px 12px",
                        borderRadius: 6,
                        border: `1px solid ${C.border}`,
                        background: "none",
                        color: C.textDim,
                        fontFamily: C.mono,
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                      onClick={() => alert(`Error logs for ${source.name} not yet implemented.`)}
                    >
                      ⊟ View Logs
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
