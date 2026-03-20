"use client";

import { useEffect, useState } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";

interface AgentRun {
  id: string;
  agent_type: string;
  status: "queued" | "running" | "done" | "failed";
  created_at: string;
  completed_at?: string;
}

interface ActivityResponse {
  events: AgentRun[];
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  queued: { color: C.gold, label: "Queued" },
  running: { color: C.gem, label: "Running" },
  done: { color: C.gpt, label: "Done" },
  failed: { color: C.reminder, label: "Failed" },
};

export function AgentStatus() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  // Poll every 30 seconds
  useEffect(() => {
    async function fetchActivity() {
      try {
        const data = await api<ActivityResponse>("/api/activity?type=agent_dispatched&limit=3");
        setRuns(data.events || []);
      } catch (e) {
        console.error("Activity fetch error:", e);
      }
    }

    fetchActivity();
    const interval = setInterval(fetchActivity, 30000);
    return () => clearInterval(interval);
  }, []);

  if (runs.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        borderTop: `1px solid ${C.border}`,
        background: C.surface,
      }}
    >
      {/* Collapsed state */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span style={{ fontSize: 9, color: C.textFaint }}>◆</span>
          <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim }}>Agent Activity</span>
          <span style={{ marginLeft: "auto", fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>
            {runs.filter((r) => r.status !== "done" && r.status !== "failed").length > 0 ? "●" : ""}
          </span>
        </button>
      )}

      {/* Expanded state */}
      {isExpanded && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <button
            onClick={() => setIsExpanded(false)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderBottom: `1px solid ${C.border}`,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ fontSize: 9, color: C.textFaint }}>◆</span>
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim }}>Agent Activity</span>
            <span style={{ marginLeft: "auto", fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>▲</span>
          </button>

          <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            {runs.map((run) => {
              const meta = STATUS_META[run.status];
              return (
                <div
                  key={run.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: meta.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: C.mono,
                      color: C.text,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {run.agent_type}
                  </span>
                  <span
                    style={{
                      fontFamily: C.mono,
                      fontSize: 8,
                      color: meta.color,
                      flexShrink: 0,
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
