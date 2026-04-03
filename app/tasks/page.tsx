"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { api } from "@/lib/client-api";
import type { PlanTier, PlannerItem, ProcessInputResponse } from "@/lib/types/domain";
import { C } from "@/lib/ui";
import { TIERS } from "@/lib/tiers";
import { MODELS, PROVIDERS } from "@/lib/ai/registry";
// CaptureBar removed — Chief of Staff handles task capture
import { PlannerCard } from "@/components/planner-card";
import { AgentTerminal } from "@/components/agent-terminal";
import { useMobile } from "@/lib/useMobile";

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
  const isMobile = useMobile();

  const [localMode, setLocalMode] = useState(false);
  const [localEmail, setLocalEmail] = useState("");
  const [items, setItems] = useState<PlannerItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [activeAgent, setActiveAgent] = useState<PlannerItem | null>(null);
  const [filter, setFilter] = useState<"open" | "done">("open");
  const [aiFilter, setAiFilter] = useState<"all" | "claude" | "chatgpt" | "gemini">("all");
  // Pillar/goal data for grouping
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pillars, setPillars] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [goalMap, setGoalMap] = useState<Record<string, { title: string; pillarName: string; pillarId: string }>>({});
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
        const [meData, tasksData, goalsData] = await Promise.all([
          api<{ tier: PlanTier; usageCount: number; usageLimit: number | null }>("/api/me"),
          api<{ items: PlannerItem[]; tasks: Array<{ id: string; goal_id: string | null; priority_score: number; due_date: string | null; state: string }> }>("/api/tasks?ranked=true"),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          api<{ pillars: any[] }>("/api/goals?withPillars=true"),
        ]);
        setTier(meData.tier);
        setUsageCount(meData.usageCount);
        setUsageLimit(meData.usageLimit);

        // Build goal->pillar map
        const gMap: Record<string, { title: string; pillarName: string; pillarId: string }> = {};
        const rawPillars = goalsData?.pillars ?? [];
        setPillars(rawPillars);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const p of rawPillars) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const g of (p.goals ?? [])) {
            gMap[g.id] = { title: g.title, pillarName: p.name, pillarId: p.id };
          }
        }
        setGoalMap(gMap);

        // Enrich items with task-level data (priority_score, goal_id, due_date)
        const taskLookup = new Map<string, { goal_id: string | null; priority_score: number; due_date: string | null }>();
        for (const t of (tasksData.tasks ?? [])) {
          taskLookup.set(t.id, { goal_id: t.goal_id, priority_score: t.priority_score ?? 0, due_date: t.due_date });
        }

        // Attach extra metadata to items
        const enriched = tasksData.items.map((item) => {
          const extra = taskLookup.get(item.id);
          return { ...item, _goalId: extra?.goal_id ?? null, _priorityScore: extra?.priority_score ?? 0, _dueDate: extra?.due_date ?? null };
        });

        setItems(enriched as PlannerItem[]);
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

  // handleCapture removed — Chief of Staff handles task capture

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

  // Stack rank scoring: priority_score from API, plus due date urgency
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function getStackRank(item: any): number {
    const pScore = item._priorityScore ?? 0;
    // Priority weight: high=30, medium=15, low=5
    const priorityWeight = item.priority === "high" ? 30 : item.priority === "medium" ? 15 : 5;
    // Due date urgency: closer = higher score
    let dueDateUrgency = 0;
    if (item._dueDate) {
      const daysUntilDue = (new Date(item._dueDate).getTime() - Date.now()) / 86400000;
      if (daysUntilDue < 0) dueDateUrgency = 50; // overdue
      else if (daysUntilDue < 1) dueDateUrgency = 40;
      else if (daysUntilDue < 3) dueDateUrgency = 30;
      else if (daysUntilDue < 7) dueDateUrgency = 20;
      else dueDateUrgency = 10;
    }
    return pScore + priorityWeight + dueDateUrgency;
  }

  const displayed = items
    .filter((item) => {
      const statusMatches = filter === "open" ? item.status === "open" : item.status === "done";
      const selected = item.selectedModel ? MODELS[item.selectedModel]?.provider : item.recommendedAI;
      const aiMatches = aiFilter === "all" || selected === aiFilter;
      return statusMatches && aiMatches;
    })
    .sort((a, b) => getStackRank(b) - getStackRank(a));

  // Group displayed items by pillar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupedByPillar: { pillarName: string; pillarIcon: string; items: PlannerItem[] }[] = [];
  const ungrouped: PlannerItem[] = [];

  for (const item of displayed) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const goalId = (item as any)._goalId;
    const goalInfo = goalId ? goalMap[goalId] : null;
    if (goalInfo) {
      const existing = groupedByPillar.find((g) => g.pillarName === goalInfo.pillarName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pillar = pillars.find((p: any) => p.id === goalInfo.pillarId);
      if (existing) {
        existing.items.push(item);
      } else {
        groupedByPillar.push({
          pillarName: goalInfo.pillarName,
          pillarIcon: pillar?.icon ?? "",
          items: [item],
        });
      }
    } else {
      ungrouped.push(item);
    }
  }

  const openCount = items.filter((i) => i.status === "open").length;
  const doneCount = items.filter((i) => i.status === "done").length;

  // On mobile, agent terminal is full-screen overlay
  if (isMobile && activeAgent) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <AgentTerminal
          item={activeAgent}
          allItems={items}
          allowedModels={allowedModels}
          onClose={() => setActiveAgent(null)}
          onModelChange={changeModel}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden", flexDirection: isMobile ? "column" : "row" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: !isMobile && activeAgent ? "0 0 52%" : "1",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: isMobile ? "14px 14px 10px" : "16px 22px 12px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div>
            <div style={{ fontFamily: C.serif, fontSize: isMobile ? 20 : 22, fontStyle: "italic", color: C.cream }}>
              Tasks
            </div>
            <div style={{ fontSize: 10, fontFamily: C.mono, color: C.textFaint, marginTop: 2 }}>
              {usageLimit === null ? `${usageCount} this month` : `${usageCount}/${usageLimit} tasks`}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* View switcher - hide kanban on mobile (too wide) */}
            {!isMobile && (
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
            )}
          </div>
        </div>

        {/* Capture bar removed — use Chief of Staff (bottom bar or Ctrl+J) */}

        {/* Open / Done Tabs + AI filters */}
        <div style={{ padding: isMobile ? "0 14px 8px" : "0 18px 10px", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 5, flexWrap: isMobile ? "wrap" : undefined }}>
            {([
              { id: "open" as const, label: "Open", count: openCount },
              { id: "done" as const, label: "Done", count: doneCount },
            ]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  background: filter === tab.id ? `${C.cl}14` : "none",
                  border: `1px solid ${filter === tab.id ? `${C.cl}45` : C.border}`,
                  color: filter === tab.id ? C.cl : C.textDim,
                  padding: "5px 14px",
                  borderRadius: 20,
                  fontFamily: C.mono,
                  fontSize: 10,
                  cursor: "pointer",
                  fontWeight: filter === tab.id ? 600 : 400,
                }}
              >
                {tab.label}
                <span style={{ fontSize: 9, opacity: 0.7 }}>{tab.count}</span>
              </button>
            ))}
            {!isMobile && <div style={{ flex: 1 }} />}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
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
                  {isMobile ? p.icon : `${p.icon} ${p.name}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Task list / kanban */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: isMobile ? "0 14px 16px" : "0 18px 20px",
            display: "flex",
            flexDirection: (view === "kanban" && !isMobile) ? "row" : "column",
            gap: (view === "kanban" && !isMobile) ? 12 : 7,
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
                  {items.length === 0 ? "Type anything above to start your plan" : `No ${filter} items match this filter`}
                </div>
              ) : null}

              {/* Grouped by pillar */}
              {groupedByPillar.map((group) => (
                <div key={group.pillarName} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 4px 6px",
                      borderBottom: `1px solid ${C.border}`,
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{group.pillarIcon}</span>
                    <span style={{ fontFamily: C.mono, fontSize: 11, color: C.cl, textTransform: "uppercase", letterSpacing: 1 }}>
                      {group.pillarName}
                    </span>
                    <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textDim, background: `${C.cl}14`, padding: "1px 6px", borderRadius: 4 }}>
                      {group.items.length}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {group.items.map((item, index) => (
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
                  </div>
                </div>
              ))}

              {/* Ungrouped items (no pillar) */}
              {ungrouped.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {groupedByPillar.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 4px 6px",
                        borderBottom: `1px solid ${C.border}`,
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontFamily: C.mono, fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: 1 }}>
                        Uncategorized
                      </span>
                      <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textDim, background: `${C.border}40`, padding: "1px 6px", borderRadius: 4 }}>
                        {ungrouped.length}
                      </span>
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {ungrouped.map((item, index) => (
                      <PlannerCard
                        key={item.id}
                        item={item}
                        index={index + groupedByPillar.reduce((s, g) => s + g.items.length, 0)}
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
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Kanban view - grouped by pillar columns */
            <div style={{ display: "flex", gap: 12, overflowX: "auto" }}>
              {groupedByPillar.map((group) => (
                <div key={group.pillarName} style={{ flex: 1, minWidth: 280 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "0 4px" }}>
                    <span style={{ fontSize: 12 }}>{group.pillarIcon}</span>
                    <span style={{ fontFamily: C.mono, fontSize: 10, color: C.cl, letterSpacing: 1 }}>
                      {group.pillarName.toUpperCase()}
                    </span>
                    <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textDim, background: `${C.cl}14`, padding: "1px 6px", borderRadius: 4 }}>
                      {group.items.length}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {group.items.map((item, index) => (
                      <PlannerCard
                        key={item.id}
                        item={item}
                        index={index}
                        active={activeAgent?.id === item.id}
                        allowedModels={allowedModels}
                        onToggle={toggleTask}
                        onDelete={deleteTask}
                        onOpen={(t) => { if (localMode) return; setActiveAgent((prev) => (prev?.id === t.id ? null : t)); }}
                        onModelChange={changeModel}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {ungrouped.length > 0 && (
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "0 4px" }}>
                    <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim, letterSpacing: 1 }}>UNCATEGORIZED</span>
                    <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textDim, background: `${C.border}40`, padding: "1px 6px", borderRadius: 4 }}>
                      {ungrouped.length}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {ungrouped.map((item, index) => (
                      <PlannerCard
                        key={item.id}
                        item={item}
                        index={index}
                        active={activeAgent?.id === item.id}
                        allowedModels={allowedModels}
                        onToggle={toggleTask}
                        onDelete={deleteTask}
                        onOpen={(t) => { if (localMode) return; setActiveAgent((prev) => (prev?.id === t.id ? null : t)); }}
                        onModelChange={changeModel}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
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
