"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { api } from "@/lib/client-api";
import type { PlanTier, PlannerItem, ProcessInputResponse } from "@/lib/types/domain";
import { C } from "@/lib/ui";
import { TIERS } from "@/lib/tiers";
import { MODELS, PROVIDERS } from "@/lib/ai/registry";
import { CaptureBar } from "@/components/capture-bar";
import { PlannerCard } from "@/components/planner-card";
import { AgentTerminal } from "@/components/agent-terminal";

const LOCAL_AUTH_KEY = "ruhrohhalp.local-auth";
const LOCAL_ITEMS_KEY = "ruhrohhalp.local-items";

function localModeEnabled() {
  return process.env.NODE_ENV !== "production";
}

function inferType(input: string): PlannerItem["type"] {
  const text = input.toLowerCase();
  if (text.startsWith("note:")) return "note";
  if (text.startsWith("remind") || text.includes("reminder")) return "reminder";
  if (text.startsWith("todo:") || text.startsWith("- ") || text.startsWith("[ ]")) return "todo";
  return "task";
}

function createLocalPlannerItem(input: string, userEmail: string): PlannerItem {
  const now = new Date().toISOString();
  const title = input.split("\n")[0].trim().slice(0, 120) || "Untitled";
  return {
    id: crypto.randomUUID(),
    userId: userEmail,
    title,
    description: input === title ? "" : input,
    type: inferType(input),
    priority: "medium",
    howTo: "Local mode stores planner changes in your browser only.",
    recommendedAI: "claude",
    recommendedModel: "claude-sonnet-4-5",
    aiReason: "Local mode uses a placeholder recommendation.",
    selectedModel: null,
    auditNotes: "",
    memoryKey: "",
    status: "open",
    sourceText: input,
    projectId: null,
    delegatedTo: null,
    isOpenLoop: false,
    threadRef: null,
    leverageReason: "",
    githubPrUrl: null,
    linearIssueId: null,
    linearUrl: null,
    linearSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

type ViewMode = "list" | "kanban";

export default function TasksPage() {
  const supabase = useMemo(() => createSupabaseClient(), []);

  const [localMode, setLocalMode] = useState(false);
  const [localEmail, setLocalEmail] = useState("");
  const [items, setItems] = useState<PlannerItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [activeAgent, setActiveAgent] = useState<PlannerItem | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "done" | "task" | "todo" | "note" | "reminder">("all");
  const [aiFilter, setAiFilter] = useState<"all" | "claude" | "chatgpt" | "gemini">("all");
  const [tier, setTier] = useState<PlanTier>("free");
  const [usageCount, setUsageCount] = useState(0);
  const [usageLimit, setUsageLimit] = useState<number | null>(5);
  const [view, setView] = useState<ViewMode>("list");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function boot() {
      if (localModeEnabled() && typeof window !== "undefined") {
        const storedEmail = window.localStorage.getItem(LOCAL_AUTH_KEY);
        const storedItems = window.localStorage.getItem(LOCAL_ITEMS_KEY);
        if (storedEmail) {
          setLocalMode(true);
          setLocalEmail(storedEmail);
          setItems(storedItems ? (JSON.parse(storedItems) as PlannerItem[]) : []);
          setLoaded(true);
          return;
        }
      }

      try {
        const [meData, tasksData] = await Promise.all([
          api<{ tier: PlanTier; usageCount: number; usageLimit: number | null }>("/api/me"),
          api<{ items: PlannerItem[] }>("/api/tasks"),
        ]);
        setTier(meData.tier);
        setUsageCount(meData.usageCount);
        setUsageLimit(meData.usageLimit);
        setItems(tasksData.items);
      } catch {
        // handled via empty state
      }
      setLoaded(true);
    }
    void boot();
  }, [supabase]);

  useEffect(() => {
    if (!localMode || typeof window === "undefined") return;
    window.localStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(items));
  }, [items, localMode]);

  const allowedModels = TIERS[tier].models;

  async function handleCapture(input: string) {
    setProcessing(true);
    try {
      if (localMode) {
        const next = createLocalPlannerItem(input, localEmail);
        setItems((prev) => [next, ...prev]);
        setUsageCount((prev) => prev + 1);
        return;
      }
      const result = await api<ProcessInputResponse>("/api/planner/process", {
        method: "POST",
        body: JSON.stringify({ input }),
      });
      setItems((prev) => [...result.items, ...prev]);
      setUsageCount(result.usageCount);
      setUsageLimit(result.usageLimit);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not process input");
    } finally {
      setProcessing(false);
    }
  }

  async function updateTask(id: string, updates: Record<string, unknown>) {
    if (localMode) {
      setItems((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t)),
      );
      return;
    }
    await api<{ ok: boolean }>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async function toggleTask(id: string) {
    const item = items.find((t) => t.id === id);
    if (!item) return;
    const status = item.status === "done" ? "open" : "done";
    await updateTask(id, { status });
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
  }

  async function deleteTask(id: string) {
    if (localMode) {
      setItems((prev) => prev.filter((t) => t.id !== id));
      if (activeAgent?.id === id) setActiveAgent(null);
      return;
    }
    await api<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((t) => t.id !== id));
    if (activeAgent?.id === id) setActiveAgent(null);
  }

  async function changeModel(id: string, modelId: string) {
    await updateTask(id, { selectedModel: modelId });
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, selectedModel: modelId } : t)));
    if (activeAgent?.id === id)
      setActiveAgent((prev) => (prev ? { ...prev, selectedModel: modelId } : prev));
  }

  const displayed = items.filter((item) => {
    const typeMatches =
      filter === "all" ||
      (filter === "open" && item.status === "open") ||
      (filter === "done" && item.status === "done") ||
      item.type === filter;
    const selected = item.selectedModel ? MODELS[item.selectedModel]?.provider : item.recommendedAI;
    const aiMatches = aiFilter === "all" || selected === aiFilter;
    return typeMatches && aiMatches;
  });

  const openItems = displayed.filter((i) => i.status === "open");
  const doneItems = displayed.filter((i) => i.status === "done");
  const openCount = items.filter((i) => i.status === "open").length;
  const doneCount = items.filter((i) => i.status === "done").length;

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: activeAgent ? "0 0 52%" : "1",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 22px 12px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div>
            <div style={{ fontFamily: C.serif, fontSize: 22, fontStyle: "italic", color: C.cream }}>
              Tasks
            </div>
            <div style={{ fontSize: 10, fontFamily: C.mono, color: C.textFaint, marginTop: 2 }}>
              {usageLimit === null ? `${usageCount} this month` : `${usageCount}/${usageLimit} tasks`}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* View switcher */}
            <div style={{ display: "flex", gap: 2, background: C.surface, borderRadius: 6, padding: 2 }}>
              {(["list", "kanban"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    border: "none",
                    background: view === v ? C.card : "transparent",
                    color: view === v ? C.cream : C.textFaint,
                    fontFamily: C.mono,
                    fontSize: 10,
                    cursor: "pointer",
                  }}
                >
                  {v === "list" ? "☰ List" : "▦ Kanban"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Capture bar */}
        <div style={{ padding: "14px 18px 10px", flexShrink: 0 }}>
          <CaptureBar onCapture={handleCapture} processing={processing} />
        </div>

        {/* Filters */}
        <div style={{ padding: "0 18px 10px", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 5 }}>
            {[
              { id: "all", label: "All", count: items.length },
              { id: "open", label: "Open", count: openCount },
              { id: "task", label: "Tasks", count: items.filter((i) => i.type === "task").length },
              { id: "todo", label: "To-Dos", count: items.filter((i) => i.type === "todo").length },
              { id: "note", label: "Notes", count: items.filter((i) => i.type === "note").length },
              { id: "reminder", label: "Reminders", count: items.filter((i) => i.type === "reminder").length },
              { id: "done", label: "Done", count: doneCount },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id as typeof filter)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  background: filter === tab.id ? `${C.cl}14` : "none",
                  border: `1px solid ${filter === tab.id ? `${C.cl}45` : C.border}`,
                  color: filter === tab.id ? C.cl : C.textDim,
                  padding: "3px 9px",
                  borderRadius: 20,
                  fontFamily: C.mono,
                  fontSize: 9,
                  cursor: "pointer",
                }}
              >
                {tab.label}
                <span style={{ fontSize: 8 }}>{tab.count}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setAiFilter("all")}
              style={{
                borderRadius: 20,
                border: `1px solid ${C.border}`,
                background: aiFilter === "all" ? C.surface : "none",
                color: C.textFaint,
                padding: "2px 8px",
                fontSize: 9,
                cursor: "pointer",
              }}
            >
              All AIs
            </button>
            {Object.values(PROVIDERS).map((p) => (
              <button
                key={p.id}
                onClick={() => setAiFilter(aiFilter === p.id ? "all" : p.id)}
                style={{
                  borderRadius: 20,
                  border: `1px solid ${aiFilter === p.id ? `${p.color}45` : C.border}`,
                  background: aiFilter === p.id ? `${p.color}14` : "none",
                  color: aiFilter === p.id ? p.color : C.textFaint,
                  padding: "2px 8px",
                  fontSize: 9,
                  cursor: "pointer",
                }}
              >
                {p.icon} {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Task list / kanban */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 18px 20px",
            display: "flex",
            flexDirection: view === "kanban" ? "row" : "column",
            gap: view === "kanban" ? 12 : 7,
          }}
        >
          {view === "list" ? (
            <>
              {displayed.length === 0 && !processing && loaded ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "60px 20px",
                    color: C.textFaint,
                    fontFamily: C.serif,
                    fontSize: 15,
                    fontStyle: "italic",
                  }}
                >
                  {items.length === 0 ? "Type anything above to start your plan" : "No items match this filter"}
                </div>
              ) : null}
              {displayed.map((item, index) => (
                <PlannerCard
                  key={item.id}
                  item={item}
                  index={index}
                  active={activeAgent?.id === item.id}
                  allowedModels={allowedModels}
                  onToggle={toggleTask}
                  onDelete={deleteTask}
                  onOpen={(t) => {
                    if (localMode) return;
                    setActiveAgent((prev) => (prev?.id === t.id ? null : t));
                  }}
                  onModelChange={changeModel}
                />
              ))}
            </>
          ) : (
            /* Kanban view */
            <>
              {/* Open column */}
              <div style={{ flex: 1, minWidth: 280 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 10,
                    padding: "0 4px",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: C.cl,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ fontFamily: C.mono, fontSize: 10, color: C.cl, letterSpacing: 1 }}>
                    OPEN
                  </span>
                  <span
                    style={{
                      fontFamily: C.mono,
                      fontSize: 9,
                      color: C.textDim,
                      background: `${C.cl}14`,
                      padding: "1px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {openItems.length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {openItems.map((item, index) => (
                    <PlannerCard
                      key={item.id}
                      item={item}
                      index={index}
                      active={activeAgent?.id === item.id}
                      allowedModels={allowedModels}
                      onToggle={toggleTask}
                      onDelete={deleteTask}
                      onOpen={(t) => {
                        if (localMode) return;
                        setActiveAgent((prev) => (prev?.id === t.id ? null : t));
                      }}
                      onModelChange={changeModel}
                    />
                  ))}
                  {openItems.length === 0 && (
                    <div
                      style={{
                        border: `1px dashed ${C.border}`,
                        borderRadius: 8,
                        padding: "30px 16px",
                        textAlign: "center",
                        fontFamily: C.mono,
                        fontSize: 10,
                        color: C.textFaint,
                      }}
                    >
                      No open tasks
                    </div>
                  )}
                </div>
              </div>

              {/* Done column */}
              <div style={{ flex: 1, minWidth: 280 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 10,
                    padding: "0 4px",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: C.gpt,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ fontFamily: C.mono, fontSize: 10, color: C.gpt, letterSpacing: 1 }}>
                    DONE
                  </span>
                  <span
                    style={{
                      fontFamily: C.mono,
                      fontSize: 9,
                      color: C.textDim,
                      background: `${C.gpt}14`,
                      padding: "1px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {doneItems.length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {doneItems.map((item, index) => (
                    <PlannerCard
                      key={item.id}
                      item={item}
                      index={index}
                      active={activeAgent?.id === item.id}
                      allowedModels={allowedModels}
                      onToggle={toggleTask}
                      onDelete={deleteTask}
                      onOpen={(t) => {
                        if (localMode) return;
                        setActiveAgent((prev) => (prev?.id === t.id ? null : t));
                      }}
                      onModelChange={changeModel}
                    />
                  ))}
                  {doneItems.length === 0 && (
                    <div
                      style={{
                        border: `1px dashed ${C.border}`,
                        borderRadius: 8,
                        padding: "30px 16px",
                        textAlign: "center",
                        fontFamily: C.mono,
                        fontSize: 10,
                        color: C.textFaint,
                      }}
                    >
                      No completed tasks
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer status bar */}
        {items.length > 0 && (
          <div style={{ padding: "6px 18px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 12 }}>
            <span style={{ fontSize: 9, fontFamily: C.mono, color: C.task }}>{openCount} open</span>
            <span style={{ fontSize: 9, fontFamily: C.mono, color: C.textFaint }}>{doneCount} done</span>
          </div>
        )}
      </div>

      {/* Agent terminal panel */}
      {activeAgent && (
        <div
          style={{
            flex: "0 0 48%",
            minWidth: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <AgentTerminal
            item={activeAgent}
            allItems={items}
            allowedModels={allowedModels}
            onClose={() => setActiveAgent(null)}
            onModelChange={changeModel}
          />
        </div>
      )}
    </div>
  );
}
