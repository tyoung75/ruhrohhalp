"use client";

import React, { useState } from "react";
import { C } from "@/lib/ui";
import { Spinner } from "@/components/primitives";
import { api } from "@/lib/client-api";

// ---------------------------------------------------------------------------
// Action type system — every recommendation resolves to one of these
// ---------------------------------------------------------------------------

export type ActionType =
  | "email_draft"    // → Gmail: draft + open
  | "code"           // → Claude Code: send prompt
  | "admin"          // → Cowork: open session
  | "deploy"         // → Dispatch: trigger deploy pipeline
  | "research"       // → Dispatch: async research agent
  | "content"        // → Dispatch: content generation agent
  | "task_done"      // → Local: mark task complete
  | "task_snooze"    // → Local: snooze task
  | "open_url"       // → Browser: open link
  | "brain_query"    // → Local: query RAG brain
  | "calendar"       // → Dispatch: calendar event creation
  | "custom";        // → Dispatch: generic agent_type from metadata

export interface OneTapActionProps {
  /** What the button says */
  label: string;
  /** Icon shown before the label */
  icon?: string;
  /** Which action pipeline to use */
  actionType: ActionType;
  /** Accent color for the button */
  color?: string;
  /** Context string — what the agent/action should do */
  context: string;
  /** Associated task ID (if any) */
  taskId?: string;
  /** Extra metadata passed to dispatch */
  metadata?: Record<string, unknown>;
  /** URL for open_url type */
  url?: string;
  /** Callback after action completes */
  onComplete?: (result: { success: boolean; data?: unknown }) => void;
  /** Size variant */
  size?: "sm" | "md";
}

// ---------------------------------------------------------------------------
// Action meta — maps type to visual + behavior
// ---------------------------------------------------------------------------

const ACTION_META: Record<ActionType, { defaultIcon: string; defaultColor: string; verb: string }> = {
  email_draft:  { defaultIcon: "✉",  defaultColor: C.gpt,      verb: "Drafting…" },
  code:         { defaultIcon: "⌘",  defaultColor: C.gem,      verb: "Sending…" },
  admin:        { defaultIcon: "◈",  defaultColor: C.cl,       verb: "Opening…" },
  deploy:       { defaultIcon: "▲",  defaultColor: C.todo,     verb: "Deploying…" },
  research:     { defaultIcon: "◇",  defaultColor: C.note,     verb: "Researching…" },
  content:      { defaultIcon: "✎",  defaultColor: C.gem,      verb: "Drafting…" },
  task_done:    { defaultIcon: "✓",  defaultColor: C.todo,     verb: "Done!" },
  task_snooze:  { defaultIcon: "◷",  defaultColor: C.task,     verb: "Snoozed" },
  open_url:     { defaultIcon: "↗",  defaultColor: C.cream,    verb: "Opening…" },
  brain_query:  { defaultIcon: "◎",  defaultColor: C.cl,       verb: "Thinking…" },
  calendar:     { defaultIcon: "▣",  defaultColor: C.gold,     verb: "Scheduling…" },
  custom:       { defaultIcon: "⟐",  defaultColor: C.textDim,  verb: "Running…" },
};

// ---------------------------------------------------------------------------
// Execution logic
// ---------------------------------------------------------------------------

async function executeAction(props: OneTapActionProps): Promise<{ success: boolean; data?: unknown }> {
  const { actionType, context, taskId, metadata, url } = props;

  switch (actionType) {
    // ---- Task state changes (local) ----
    case "task_done": {
      if (!taskId) throw new Error("task_done requires taskId");
      await api(`/api/tasks/${taskId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: "done" }),
      });
      window.dispatchEvent(new CustomEvent("tasks:refresh"));
      return { success: true };
    }

    case "task_snooze": {
      if (!taskId) throw new Error("task_snooze requires taskId");
      const snoozeDate = metadata?.date ?? new Date(Date.now() + 86400000).toISOString().split("T")[0];
      await api(`/api/tasks/${taskId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action: "snooze", date: snoozeDate }),
      });
      window.dispatchEvent(new CustomEvent("tasks:refresh"));
      return { success: true };
    }

    // ---- Browser open ----
    case "open_url": {
      if (url) window.open(url, "_blank", "noopener");
      return { success: true };
    }

    // ---- Everything else goes through dispatch ----
    default: {
      const agentType = actionType === "custom"
        ? (metadata?.agent_type as string) ?? "custom"
        : actionType;

      const result = await api<{ agent_run_id: string; status: string }>("/api/dispatch", {
        method: "POST",
        body: JSON.stringify({
          agent_type: agentType,
          context,
          task_id: taskId ?? null,
          metadata: {
            ...metadata,
            one_tap: true,
            initiated_at: new Date().toISOString(),
          },
        }),
      });

      return { success: true, data: result };
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OneTapAction(props: OneTapActionProps) {
  const { label, icon, actionType, color, size = "sm", onComplete } = props;
  const meta = ACTION_META[actionType];
  const accentColor = color ?? meta.defaultColor;
  const displayIcon = icon ?? meta.defaultIcon;

  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleClick() {
    if (state === "loading") return;
    setState("loading");

    try {
      const result = await executeAction(props);
      setState("done");
      onComplete?.(result);
      // Reset after brief flash
      setTimeout(() => setState("idle"), 1800);
    } catch (e) {
      console.error("OneTapAction error:", e);
      setState("error");
      onComplete?.({ success: false });
      setTimeout(() => setState("idle"), 2500);
    }
  }

  const isSm = size === "sm";
  const fontSize = isSm ? 9 : 11;
  const padding = isSm ? "3px 8px" : "6px 14px";
  const gap = isSm ? 4 : 6;

  const stateStyles: Record<string, React.CSSProperties> = {
    idle: {
      background: `${accentColor}14`,
      border: `1px solid ${accentColor}35`,
      color: accentColor,
      cursor: "pointer",
    },
    loading: {
      background: `${accentColor}08`,
      border: `1px solid ${accentColor}20`,
      color: `${accentColor}80`,
      cursor: "default",
    },
    done: {
      background: `${C.todo}20`,
      border: `1px solid ${C.todo}50`,
      color: C.todo,
      cursor: "default",
    },
    error: {
      background: `${C.reminder}14`,
      border: `1px solid ${C.reminder}35`,
      color: C.reminder,
      cursor: "default",
    },
  };

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        padding,
        borderRadius: isSm ? 4 : 6,
        fontFamily: C.mono,
        fontSize,
        letterSpacing: 0.3,
        transition: "all 0.2s ease",
        whiteSpace: "nowrap",
        ...stateStyles[state],
      }}
    >
      {state === "loading" ? (
        <>
          <Spinner color={accentColor} size={isSm ? 8 : 10} />
          {meta.verb}
        </>
      ) : state === "done" ? (
        <>✓ Done</>
      ) : state === "error" ? (
        <>✕ Failed</>
      ) : (
        <>
          <span style={{ fontSize: isSm ? 10 : 12 }}>{displayIcon}</span>
          {label}
        </>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Quick-action presets for common patterns
// ---------------------------------------------------------------------------

export function DraftEmailAction({ context, taskId, onComplete }: { context: string; taskId?: string; onComplete?: OneTapActionProps["onComplete"] }) {
  return <OneTapAction label="Draft Email" actionType="email_draft" icon="✉" context={context} taskId={taskId} onComplete={onComplete} />;
}

export function SendToCodeAction({ context, taskId, onComplete }: { context: string; taskId?: string; onComplete?: OneTapActionProps["onComplete"] }) {
  return <OneTapAction label="Send to Code" actionType="code" icon="⌘" context={context} taskId={taskId} onComplete={onComplete} />;
}

export function OpenInCoworkAction({ context, taskId, onComplete }: { context: string; taskId?: string; onComplete?: OneTapActionProps["onComplete"] }) {
  return <OneTapAction label="Open in Cowork" actionType="admin" icon="◈" context={context} taskId={taskId} onComplete={onComplete} />;
}

export function MarkDoneAction({ taskId, onComplete }: { taskId: string; onComplete?: OneTapActionProps["onComplete"] }) {
  return <OneTapAction label="Done" actionType="task_done" context="Mark task complete" taskId={taskId} onComplete={onComplete} />;
}

export function DeployAction({ context, metadata, onComplete }: { context: string; metadata?: Record<string, unknown>; onComplete?: OneTapActionProps["onComplete"] }) {
  return <OneTapAction label="Deploy" actionType="deploy" icon="▲" context={context} metadata={metadata} onComplete={onComplete} />;
}
