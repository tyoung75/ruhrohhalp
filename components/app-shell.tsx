"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { api } from "@/lib/client-api";
import type { PlanTier, PlannerItem, ProcessInputResponse } from "@/lib/types/domain";
import { C } from "@/lib/ui";
import { TIERS } from "@/lib/tiers";
import { PROVIDERS, MODELS } from "@/lib/ai/registry";
import { CaptureBar } from "@/components/capture-bar";
import { PlannerCard } from "@/components/planner-card";
import { AgentTerminal } from "@/components/agent-terminal";
import { PricingModal } from "@/components/pricing-modal";
import { SettingsPanel } from "@/components/settings-panel";
import { Spinner } from "@/components/primitives";

type MeResponse = {
  user: { id: string; email: string | null };
  tier: PlanTier;
  usageCount: number;
  usageLimit: number | null;
  hasKeys: Record<"claude" | "chatgpt" | "gemini", boolean>;
};

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
    aiReason: "Local mode uses a placeholder recommendation so you can test the planner UI.",
    selectedModel: null,
    auditNotes: "",
    memoryKey: "",
    status: "open",
    linearIssueId: null,
    linearUrl: null,
    linearSyncedAt: null,
    sourceText: input,
    projectId: null,
    delegatedTo: null,
    isOpenLoop: false,
    threadRef: null,
    leverageReason: "",
    githubPrUrl: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function AppShell() {
  const supabase = useMemo(() => createSupabaseClient(), []);

  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [hasKeys, setHasKeys] = useState<Record<"claude" | "chatgpt" | "gemini", boolean>>({
    claude: false,
    chatgpt: false,
    gemini: false,
  });

  const [showSettings, setShowSettings] = useState(false);
  const [showPricing, setShowPricing] = useState(false);

  const [email, setEmail] = useState("");
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  async function refreshServerState() {
    const [meData, tasksData] = await Promise.all([
      api<MeResponse>("/api/me"),
      api<{ items: PlannerItem[] }>("/api/tasks"),
    ]);

    setTier(meData.tier);
    setUsageCount(meData.usageCount);
    setUsageLimit(meData.usageLimit);
    setHasKeys(meData.hasKeys);
    setItems(tasksData.items);
  }

  useEffect(() => {
    if (!localMode || typeof window === "undefined") return;
    window.localStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(items));
  }, [items, localMode]);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      if (localModeEnabled() && typeof window !== "undefined") {
        const storedEmail = window.localStorage.getItem(LOCAL_AUTH_KEY);
        const storedItems = window.localStorage.getItem(LOCAL_ITEMS_KEY);

        if (storedEmail) {
          setLocalMode(true);
          setLocalEmail(storedEmail);
          setItems(storedItems ? (JSON.parse(storedItems) as PlannerItem[]) : []);
          setLoading(false);
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);

      if (data.session?.user) {
        try {
          await refreshServerState();
        } catch {
          // no-op, handled in UI via empty state
        }
      }

      setLoading(false);
    }

    void boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) void refreshServerState();
      else {
        setItems([]);
        setTier("free");
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const allowedModels = TIERS[tier].models;

  async function signInGoogle() {
    const redirectTo = `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  }

  async function signInMagicLink() {
    if (!email.trim()) return;
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } });
    setAuthMsg(error ? error.message : "Check your email for a magic link.");
  }

  async function signOut() {
    if (localMode && typeof window !== "undefined") {
      window.localStorage.removeItem(LOCAL_AUTH_KEY);
      window.localStorage.removeItem(LOCAL_ITEMS_KEY);
      setLocalMode(false);
      setLocalEmail("");
      setItems([]);
      setActiveAgent(null);
      setTier("free");
      setUsageCount(0);
      setUsageLimit(5);
      setHasKeys({ claude: false, chatgpt: false, gemini: false });
      return;
    }

    await supabase.auth.signOut();
  }

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
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                ...updates,
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
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
    if (activeAgent?.id === id) setActiveAgent((prev) => (prev ? { ...prev, selectedModel: modelId } : prev));
  }

  async function handlePlanSelect(nextTier: PlanTier) {
    if (localMode) {
      setTier(nextTier);
      setShowPricing(false);
      return;
    }

    if (nextTier === "free") {
      setShowPricing(false);
      return;
    }

    const data = await api<{ url: string }>("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ tier: nextTier }),
    });

    if (data.url) window.location.href = data.url;
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

  const openCount = items.filter((i) => i.status === "open").length;
  const doneCount = items.filter((i) => i.status === "done").length;
  const authed = localMode || (!!session && !!user);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: C.bg }}>
        <Spinner color={C.cl} size={20} />
      </div>
    );
  }

  if (!authed) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 460, background: C.surface, border: `1px solid ${C.borderMid}`, borderRadius: 16, padding: 24 }}>
          <div style={{ fontFamily: C.serif, fontSize: 34, fontStyle: "italic", color: C.cream }}>ruh-roh. halp.</div>
          <p style={{ color: C.textDim, marginTop: 8, marginBottom: 20 }}>Sign in to access your cross-device planner, task agents, and tier settings.</p>
          <button onClick={() => void signInGoogle()} style={{ width: "100%", border: `1px solid ${C.border}`, background: C.card, color: C.text, borderRadius: 10, padding: "10px 14px", marginBottom: 10, cursor: "pointer" }}>
            Continue with Google
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{ flex: 1, border: `1px solid ${C.border}`, background: C.card, color: C.text, borderRadius: 10, padding: "10px 12px" }}
            />
            <button onClick={() => void signInMagicLink()} style={{ border: "none", background: C.cl, color: C.bg, borderRadius: 10, padding: "10px 14px", fontWeight: 600 }}>
              Magic Link
            </button>
          </div>
          {localModeEnabled() ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 10px" }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ fontSize: 10, color: C.textFaint, fontFamily: C.mono }}>LOCAL DEV</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>
              <button
                onClick={() => {
                  const nextEmail = email.trim();
                  if (!nextEmail) {
                    setAuthMsg("Enter an email to continue in local dev mode.");
                    return;
                  }

                  window.localStorage.setItem(LOCAL_AUTH_KEY, nextEmail);
                  window.localStorage.removeItem(LOCAL_ITEMS_KEY);
                  setLocalMode(true);
                  setLocalEmail(nextEmail);
                  setItems([]);
                  setTier("free");
                  setUsageCount(0);
                  setUsageLimit(5);
                  setAuthMsg("Local dev mode enabled. Planner data stays in this browser.");
                }}
                style={{ width: "100%", border: `1px solid ${C.border}`, background: C.card, color: C.cream, borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}
              >
                Continue with Email Only
              </button>
            </>
          ) : null}
          {authMsg ? <p style={{ color: C.textDim, marginTop: 10, fontSize: 13 }}>{authMsg}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, color: C.text, overflow: "hidden" }}>
      {showPricing ? <PricingModal current={tier} onSelect={handlePlanSelect} onClose={() => setShowPricing(false)} /> : null}
      {showSettings && !localMode ? (
        <SettingsPanel
          tier={tier}
          hasKeys={hasKeys}
          onClose={() => setShowSettings(false)}
          onChangePlan={() => {
            setShowSettings(false);
            setShowPricing(true);
          }}
          onSaved={refreshServerState}
        />
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", flex: activeAgent ? "0 0 52%" : "1", minWidth: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 22px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontFamily: C.serif, fontSize: 24, fontStyle: "italic", color: C.cream }}>ruh-roh. halp.</div>
            <div style={{ fontSize: 9, fontFamily: C.mono, color: C.textFaint, letterSpacing: 2 }}>RUHROHHALP.COM</div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: C.textDim }}>
              {usageLimit === null ? `${usageCount} this month` : `${usageCount}/${usageLimit} tasks`}
            </span>
            <button onClick={() => setShowPricing(true)} style={{ background: C.clDim, color: C.cl, border: `1px solid ${C.cl}35`, borderRadius: 20, padding: "3px 10px", fontFamily: C.mono, fontSize: 9 }}>
              {TIERS[tier].label}{TIERS[tier].price > 0 ? ` $${TIERS[tier].price}/mo` : ""}
            </button>
            <button
              onClick={() => {
                if (localMode) {
                  return;
                }
                setShowSettings(true);
              }}
              style={{ background: "none", border: `1px solid ${C.border}`, color: C.textDim, borderRadius: 7, padding: "4px 11px", fontFamily: C.mono, fontSize: 11 }}
            >
              {localMode ? "Local Mode" : "Settings"}
            </button>
            <button onClick={() => void signOut()} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textDim, borderRadius: 7, padding: "4px 11px", fontFamily: C.mono, fontSize: 11 }}>
              Sign Out
            </button>
          </div>
        </div>

        {localMode ? (
          <div style={{ padding: "8px 18px", borderBottom: `1px solid ${C.border}`, background: `${C.cl}10`, color: C.textDim, fontSize: 11 }}>
            Local dev mode for <span style={{ color: C.cream }}>{localEmail}</span>. Planner changes are saved in this browser, and agent chat, billing, and synced settings stay disabled.
          </div>
        ) : null}

        <div style={{ padding: "14px 18px 10px", flexShrink: 0 }}>
          <CaptureBar onCapture={handleCapture} processing={processing} />
        </div>

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
                }}
              >
                {tab.label}
                <span style={{ fontSize: 8 }}>{tab.count}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setAiFilter("all")} style={{ borderRadius: 20, border: `1px solid ${C.border}`, background: aiFilter === "all" ? C.surface : "none", color: C.textFaint, padding: "2px 8px", fontSize: 9 }}>
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
                }}
              >
                {p.icon} {p.name}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 18px 20px", display: "flex", flexDirection: "column", gap: 7 }}>
          {displayed.length === 0 && !processing ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: C.textFaint, fontFamily: C.serif, fontSize: 15, fontStyle: "italic" }}>
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
                if (localMode) {
                  setAuthMsg("Local dev mode does not include agent chat.");
                  return;
                }
                setActiveAgent((prev) => (prev?.id === t.id ? null : t));
              }}
              onModelChange={changeModel}
            />
          ))}
        </div>

        {items.length > 0 ? (
          <div style={{ padding: "6px 18px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 12 }}>
            <span style={{ fontSize: 9, fontFamily: C.mono, color: C.task }}>{openCount} open</span>
            <span style={{ fontSize: 9, fontFamily: C.mono, color: C.textFaint }}>{doneCount} done</span>
          </div>
        ) : null}
      </div>

      {activeAgent ? (
        <div style={{ flex: "0 0 48%", minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <AgentTerminal
            item={activeAgent}
            allItems={items}
            allowedModels={allowedModels}
            onClose={() => setActiveAgent(null)}
            onModelChange={changeModel}
          />
        </div>
      ) : null}
    </div>
  );
}
