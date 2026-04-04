"use client";

import { useEffect, useState } from "react";
import { subscribe, dismiss, type BgTask } from "@/lib/bg-tasks";
import { C } from "@/lib/ui";

/**
 * Global toast overlay for background tasks.
 * Mount once in LayoutShell — it renders toasts for all running/completed/failed tasks.
 */
export function BgTaskToasts() {
  const [tasks, setTasks] = useState<BgTask[]>([]);

  useEffect(() => subscribe(setTasks), []);

  if (tasks.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 380,
        pointerEvents: "none",
      }}
    >
      {tasks.map((t) => (
        <div
          key={t.id}
          style={{
            pointerEvents: "auto",
            background: C.surface,
            border: `1px solid ${
              t.status === "running" ? C.borderMid : t.status === "success" ? `${C.gpt}40` : `${C.reminder}40`
            }`,
            borderRadius: 10,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
            animation: "fadeUp 0.2s ease both",
          }}
        >
          {t.status === "running" && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: C.gold,
                flexShrink: 0,
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          )}
          {t.status === "success" && (
            <span style={{ color: C.gpt, fontSize: 14, flexShrink: 0 }}>&#10003;</span>
          )}
          {t.status === "error" && (
            <span style={{ color: C.reminder, fontSize: 14, flexShrink: 0 }}>&#10007;</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: C.mono,
                fontSize: 11,
                fontWeight: 600,
                color: t.status === "running" ? C.gold : t.status === "success" ? C.gpt : C.reminder,
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              {t.status === "running" ? t.label : t.status === "success" ? "Done" : "Failed"}
            </div>
            {t.message && (
              <div
                style={{
                  fontFamily: C.mono,
                  fontSize: 11,
                  color: C.textDim,
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t.message}
              </div>
            )}
          </div>
          {t.status !== "running" && (
            <button
              onClick={() => dismiss(t.id)}
              style={{
                background: "none",
                border: "none",
                color: C.textFaint,
                cursor: "pointer",
                fontSize: 14,
                padding: 0,
                flexShrink: 0,
              }}
            >
              &times;
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
