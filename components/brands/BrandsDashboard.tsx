"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { runBgTask, isRunning } from "@/lib/bg-tasks";
import { C } from "@/lib/ui";
import type { BrandDeal, BrandDealStatus, PipelineSummary } from "@/lib/types/brands";
import { PIPELINE_COLUMNS } from "@/lib/types/brands";

interface DealDetailResponse {
  deal: BrandDeal;
  emails: Array<{ id: string; sent_at: string; email_type: string; direction: string; subject: string | null; summary: string | null; gmail_draft_id?: string | null }>;
}

interface RunResponse {
  ok: boolean;
  actions_taken: { drafted: unknown[]; replied: unknown[]; archived: unknown[]; skipped?: unknown[] };
}

interface ResearchResult {
  brand_name: string;
  contact_email: string | null;
  contact_name: string | null;
  contact_confidence: string;
  priority: string;
  relationship_type: string;
  relationship_notes: string;
  product_usage: string;
  angle: string;
  dont_say: string[];
  estimated_value_low: number;
  estimated_value_high: number;
  deal_type: string;
  outreach_strategy: {
    approach: string;
    best_contact_method: string;
    alternative_contacts: string[];
    timing_notes: string;
    key_differentiators: string[];
    suggested_subject: string;
    talking_points: string[];
  };
}

interface BrandFeedback {
  id: string;
  feedback_type: string;
  content: string;
  created_at: string;
}

type SetupState = "loading" | "ready" | "needs_setup" | "setup_running";

export function BrandsDashboard() {
  const [setupState, setSetupState] = useState<SetupState>("loading");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [deals, setDeals] = useState<BrandDeal[]>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [selected, setSelected] = useState<DealDetailResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  // Research prompt box
  const [promptText, setPromptText] = useState("");
  const [researching, setResearching] = useState(false);
  const [researchResult, setResearchResult] = useState<ResearchResult | null>(null);
  const [addingResearched, setAddingResearched] = useState(false);
  // Scout
  const [scouting, setScouting] = useState(false);
  // Sidebar extras
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [reviseText, setReviseText] = useState("");
  const [revising, setRevising] = useState(false);
  const [feedbacks, setFeedbacks] = useState<BrandFeedback[]>([]);
  const [feedbackText, setFeedbackText] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const promptRef = useRef<HTMLInputElement>(null);

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  async function fetchDeals() {
    try {
      const [dealsResult, summaryResult] = await Promise.allSettled([
        api<{ deals: BrandDeal[] }>("/api/brands"),
        api<PipelineSummary>("/api/brands/summary"),
      ]);

      if (dealsResult.status === "fulfilled") {
        setDeals(dealsResult.value.deals);
        setSetupState("ready");
      } else {
        const msg = dealsResult.reason instanceof Error ? dealsResult.reason.message : "";
        if (msg.includes("brand_deals") || msg.includes("schema cache")) {
          setSetupState("needs_setup");
          return;
        }
        setSetupState("ready");
        showToast(msg || "Failed to load deals", "error");
      }

      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      setSetupState("ready");
      showToast(msg || "Failed to load deals", "error");
    }
  }

  async function runSetup() {
    setSetupState("setup_running");
    setSetupError(null);
    try {
      const res = await api<{ ok?: boolean; error?: string; message?: string }>("/api/brands/setup", { method: "POST" });
      if (res.error) {
        setSetupError(res.message ?? res.error);
        setSetupState("needs_setup");
      } else {
        setSetupState("ready");
        void fetchDeals();
      }
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "Setup failed");
      setSetupState("needs_setup");
    }
  }

  useEffect(() => {
    void fetchDeals();
    const onRefresh = () => void fetchDeals();
    window.addEventListener("brands:refresh", onRefresh);
    return () => window.removeEventListener("brands:refresh", onRefresh);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<BrandDealStatus, BrandDeal[]>();
    for (const column of PIPELINE_COLUMNS) map.set(column.status, []);
    for (const deal of deals) {
      if (!map.has(deal.status)) continue;
      map.get(deal.status)?.push(deal);
    }
    return map;
  }, [deals]);

  function runPipeline() {
    if (isRunning("Running brand pipeline")) return;
    setRunning(true);
    runBgTask(
      "Running brand pipeline",
      async () => {
        const result = await api<RunResponse>("/api/brands/run", { method: "POST" });
        const { drafted, replied, archived, skipped } = result.actions_taken;
        const parts = [];
        if (drafted.length) parts.push(`${drafted.length} drafted`);
        if (replied.length) parts.push(`${replied.length} replies processed`);
        if (archived.length) parts.push(`${archived.length} archived`);
        if (skipped?.length) parts.push(`${skipped.length} skipped`);
        window.dispatchEvent(new CustomEvent("brands:refresh"));
        return parts.length ? `Pipeline complete: ${parts.join(", ")}` : "Pipeline ran — no actions needed";
      },
      { onSuccess: () => setRunning(false), onError: () => setRunning(false) },
    );
  }

  function researchBrand() {
    if (!promptText.trim()) return;
    setResearching(true);
    setResearchResult(null);
    const prompt = promptText.trim();
    runBgTask(
      "Researching brand",
      async () => {
        const res = await api<{ ok: boolean; research: ResearchResult }>("/api/brands/research", {
          method: "POST",
          body: JSON.stringify({ prompt }),
        });
        setResearchResult(res.research);
        return `Research complete for ${res.research.brand_name}`;
      },
      { onSuccess: () => setResearching(false), onError: () => setResearching(false) },
    );
  }

  async function addResearchedBrand() {
    if (!researchResult) return;
    setAddingResearched(true);
    try {
      await api("/api/brands", {
        method: "POST",
        body: JSON.stringify({
          brand_name: researchResult.brand_name,
          contact_email: researchResult.contact_email,
          contact_name: researchResult.contact_name,
          contact_confidence: researchResult.contact_confidence,
          relationship_notes: researchResult.relationship_notes,
          product_usage: researchResult.product_usage,
          angle: researchResult.angle,
          priority: researchResult.priority,
          dont_say: researchResult.dont_say,
          estimated_value_low: researchResult.estimated_value_low,
          estimated_value_high: researchResult.estimated_value_high,
          deal_type: researchResult.deal_type,
          relationship_type: researchResult.relationship_type,
          status: "prospect",
        }),
      });
      showToast(`${researchResult.brand_name} added to pipeline`, "success");
      setResearchResult(null);
      setPromptText("");
      window.dispatchEvent(new CustomEvent("brands:refresh"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to add brand", "error");
    } finally {
      setAddingResearched(false);
    }
  }

  function scoutBrands() {
    if (isRunning("Scouting brands")) return;
    setScouting(true);
    runBgTask(
      "Scouting brands",
      async () => {
        const res = await api<{ ok: boolean; persisted: number; attempted?: number; filtered_out?: number; insert_errors?: { brand: string; error: string }[]; claude_count?: number; chatgpt_count?: number; recommendations?: { brand_name: string; source: string; why: string }[]; errors: { claude: string | null; chatgpt: string | null } }>("/api/brands/scout", { method: "POST" });
        console.log("[Scout Brands] Full response:", JSON.stringify(res, null, 2));
        window.dispatchEvent(new CustomEvent("brands:refresh"));
        if (res.insert_errors?.length) {
          console.error("[Scout Brands] Insert errors:", res.insert_errors);
          const errDetail = res.insert_errors.map((e) => `${e.brand}: ${e.error}`).join("\n");
          showToast(`Insert errors:\n${errDetail}`, "error");
        }
        const saved = res.persisted ?? 0;
        if (saved > 0) {
          const names = res.recommendations?.map((r) => r.brand_name).join(", ") ?? "";
          return `${saved} brands scouted!${names ? ` (${names})` : ""}`;
        }
        return `${saved}/${res.attempted ?? 0} saved — check console for errors`;
      },
      { onSuccess: () => setScouting(false), onError: () => setScouting(false) },
    );
  }
      },
      { onSuccess: () => setScouting(false), onError: () => setScouting(false) },
    );
  }

  async function promoteDeal(id: string, status: string) {
    try {
      await api(`/api/brands/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      window.dispatchEvent(new CustomEvent("brands:refresh"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Update failed", "error");
    }
  }

  async function delayDeal(id: string) {
    try {
      await api(`/api/brands/${id}`, { method: "PATCH", body: JSON.stringify({ status: "delayed", next_action: "Revisit later", next_action_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) }) });
      showToast("Brand delayed — will revisit in 30 days", "success");
      window.dispatchEvent(new CustomEvent("brands:refresh"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Update failed", "error");
    }
  }

  function generateDraft() {
    if (!selected) return;
    const dealId = selected.deal.id;
    setDrafting(true);
    runBgTask(
      "Generating draft",
      async () => {
        const res = await api<{ draft_preview: string; subject: string; gmail_draft_id: string | null }>(`/api/brands/${dealId}/draft`, { method: "POST" });
        const detail = await api<DealDetailResponse>(`/api/brands/${dealId}`);
        setSelected(detail);
        window.dispatchEvent(new CustomEvent("brands:refresh"));
        return res.gmail_draft_id ? "Gmail draft created" : "Draft generated (no Gmail)";
      },
      { onSuccess: () => setDrafting(false), onError: () => setDrafting(false) },
    );
  }

  function sendDraft() {
    if (!selected) return;
    const dealId = selected.deal.id;
    const email = selected.deal.contact_email;
    setSending(true);
    runBgTask(
      "Sending email",
      async () => {
        await api(`/api/brands/${dealId}/send`, { method: "POST" });
        const detail = await api<DealDetailResponse>(`/api/brands/${dealId}`);
        setSelected(detail);
        window.dispatchEvent(new CustomEvent("brands:refresh"));
        return `Email sent to ${email}`;
      },
      { onSuccess: () => setSending(false), onError: () => setSending(false) },
    );
  }

  async function reviseDraft() {
    if (!selected || !reviseText.trim()) return;
    setRevising(true);
    try {
      await api(`/api/brands/${selected.deal.id}/revise`, {
        method: "POST",
        body: JSON.stringify({ feedback: reviseText.trim() }),
      });
      showToast("Draft revised", "success");
      setReviseText("");
      const detail = await api<DealDetailResponse>(`/api/brands/${selected.deal.id}`);
      setSelected(detail);
      window.dispatchEvent(new CustomEvent("brands:refresh"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Revise failed", "error");
    } finally {
      setRevising(false);
    }
  }

  async function loadFeedback(dealId: string) {
    try {
      const res = await api<{ feedback: BrandFeedback[] }>(`/api/brands/${dealId}/feedback`);
      setFeedbacks(res.feedback ?? []);
    } catch { setFeedbacks([]); }
  }

  async function submitFeedback(type: string, content: string) {
    if (!selected || !content) return;
    setSubmittingFeedback(true);
    try {
      await api(`/api/brands/${selected.deal.id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ feedback_type: type, content }),
      });
      setFeedbackText("");
      void loadFeedback(selected.deal.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Feedback failed", "error");
    } finally {
      setSubmittingFeedback(false);
    }
  }

  async function openDeal(id: string) {
    try {
      const detail = await api<DealDetailResponse>(`/api/brands/${id}`);
      setSelected(detail);
      setReviseText("");
      setFeedbackText("");
      void loadFeedback(id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load deal", "error");
    }
  }

  // --- Setup required screen ---
  if (setupState === "loading") {
    return (
      <main style={{ background: C.bg, minHeight: "100%", color: C.text, padding: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: C.textDim, fontSize: 13 }}>Loading brand pipeline...</div>
      </main>
    );
  }

  if (setupState === "needs_setup" || setupState === "setup_running") {
    return (
      <main style={{ background: C.bg, minHeight: "100%", color: C.text, padding: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>&#9881;</div>
          <h2 style={{ fontFamily: C.serif, color: C.cream, marginBottom: 8 }}>Brand Pipeline Setup Required</h2>
          <p style={{ color: C.textDim, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
            The brand outreach tables haven&apos;t been created in your database yet.
            Run the migration to get started.
          </p>
          <button
            onClick={() => void runSetup()}
            disabled={setupState === "setup_running"}
            style={{
              background: C.cl,
              color: C.bg,
              border: "none",
              borderRadius: 8,
              padding: "12px 28px",
              fontFamily: C.mono,
              fontSize: 13,
              fontWeight: 700,
              cursor: setupState === "setup_running" ? "default" : "pointer",
              marginBottom: 12,
            }}
          >
            {setupState === "setup_running" ? "Setting up..." : "Run Setup"}
          </button>
          {setupError && (
            <div style={{ marginTop: 12, padding: 12, background: C.card, border: `1px solid #ef444480`, borderRadius: 8, fontSize: 12, color: "#f87171", lineHeight: 1.5, textAlign: "left" }}>
              <strong>Setup could not auto-run.</strong> Please run the migration manually:
              <div style={{ marginTop: 8, padding: 8, background: C.bg, borderRadius: 6, fontFamily: C.mono, fontSize: 11, color: C.textDim }}>
                Copy the SQL from<br />
                <span style={{ color: C.cl }}>supabase/migrations/20260402000000_brand_outreach_pipeline.sql</span><br />
                and run it in the Supabase SQL Editor.
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  // --- Main dashboard ---
  return (
    <main style={{ background: C.bg, minHeight: "100%", color: C.text }}>
      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 200,
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 12,
            fontFamily: C.mono,
            background: toast.type === "error" ? "#7f1d1d" : "#14532d",
            color: toast.type === "error" ? "#fca5a5" : "#86efac",
            border: `1px solid ${toast.type === "error" ? "#ef444450" : "#22c55e50"}`,
            boxShadow: "0 4px 12px #0006",
            cursor: "pointer",
            maxWidth: 500,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
          onClick={() => setToast(null)}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 style={{ fontFamily: C.serif, color: C.cream, margin: 0, fontSize: 22 }}>Brand Outreach</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void scoutBrands()} disabled={scouting} style={{ background: "transparent", color: scouting ? C.textDim : C.gem, border: `1px solid ${scouting ? C.border : C.gem}`, borderRadius: 8, padding: "8px 14px", fontFamily: C.mono, fontSize: 11, fontWeight: 600, cursor: scouting ? "default" : "pointer" }}>
            {scouting ? "Scouting..." : "Scout Brands"}
          </button>
          <button onClick={() => void runPipeline()} disabled={running} style={{ background: "transparent", color: running ? C.textDim : C.cl, border: `1px solid ${running ? C.border : C.cl}`, borderRadius: 8, padding: "8px 14px", fontFamily: C.mono, fontSize: 11, fontWeight: 600, cursor: running ? "default" : "pointer" }}>
            {running ? "Running..." : "Run Pipeline"}
          </button>
        </div>
      </div>

      {/* Research Prompt Box */}
      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <input
          ref={promptRef}
          type="text"
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && promptText.trim()) { e.preventDefault(); void researchBrand(); } }}
          placeholder="I want to work with Hyperice... or describe a brand to research"
          disabled={researching}
          style={{ flex: 1, background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, fontFamily: C.sans, outline: "none" }}
        />
        <button
          onClick={() => void researchBrand()}
          disabled={researching || !promptText.trim()}
          style={{ background: promptText.trim() ? C.cl : C.border, color: promptText.trim() ? C.bg : C.textDim, border: "none", borderRadius: 8, padding: "10px 18px", fontFamily: C.mono, fontSize: 12, fontWeight: 700, cursor: promptText.trim() ? "pointer" : "default", whiteSpace: "nowrap" }}
        >
          {researching ? "Researching..." : "Research"}
        </button>
      </div>

      {/* Research Result Card */}
      {researchResult && (
        <div style={{ marginBottom: 16, padding: 16, border: `1px solid ${C.gem}40`, borderRadius: 10, background: C.surface }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: C.mono, fontSize: 10, color: C.gem, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Research Complete</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.cream }}>{researchResult.brand_name}</div>
            </div>
            <button onClick={() => setResearchResult(null)} style={{ background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>&#10005;</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontFamily: C.mono, padding: "2px 8px", borderRadius: 4, background: `${C.cl}15`, color: C.cl }}>{researchResult.priority}</span>
            <span style={{ fontSize: 10, fontFamily: C.mono, padding: "2px 8px", borderRadius: 4, background: C.border, color: C.textDim }}>{researchResult.deal_type}</span>
            <span style={{ fontSize: 10, fontFamily: C.mono, padding: "2px 8px", borderRadius: 4, background: C.border, color: C.textDim }}>${researchResult.estimated_value_low}–${researchResult.estimated_value_high}</span>
            {researchResult.contact_email && <span style={{ fontSize: 10, fontFamily: C.mono, padding: "2px 8px", borderRadius: 4, background: `${C.gpt}15`, color: C.gpt }}>{researchResult.contact_email} ({researchResult.contact_confidence})</span>}
          </div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginBottom: 6 }}><strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Angle</strong><br />{researchResult.angle}</div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginBottom: 6 }}><strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Product Usage</strong><br />{researchResult.product_usage}</div>
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, marginBottom: 10 }}><strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Strategy</strong><br />{researchResult.outreach_strategy.approach}</div>
          {researchResult.outreach_strategy.key_differentiators.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Why Tyler Stands Out</strong>
              {researchResult.outreach_strategy.key_differentiators.map((d, i) => (
                <div key={i} style={{ fontSize: 11, color: C.text, marginTop: 3, paddingLeft: 10, borderLeft: `2px solid ${C.gem}30` }}>{d}</div>
              ))}
            </div>
          )}
          {researchResult.outreach_strategy.talking_points.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Talking Points</strong>
              {researchResult.outreach_strategy.talking_points.map((p, i) => (
                <div key={i} style={{ fontSize: 11, color: C.textDim, marginTop: 3, paddingLeft: 10, borderLeft: `2px solid ${C.cl}30` }}>{p}</div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => void addResearchedBrand()} disabled={addingResearched} style={{ background: C.cl, color: C.bg, border: "none", borderRadius: 8, padding: "10px 18px", fontFamily: C.mono, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {addingResearched ? "Adding..." : "Add to Pipeline"}
            </button>
            <button onClick={() => { void addResearchedBrand().then(() => { const deal = deals.find((d) => d.brand_name === researchResult?.brand_name); if (deal) void openDeal(deal.id); }); }} disabled={addingResearched} style={{ background: "transparent", color: C.cl, border: `1px solid ${C.cl}`, borderRadius: 8, padding: "10px 18px", fontFamily: C.mono, fontSize: 12, cursor: "pointer" }}>
              Add + Draft Email
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18 }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 12, borderRadius: 10 }}>
          <div style={{ color: C.textFaint, fontFamily: C.mono, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>Active</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.cream }}>{summary?.total_active ?? 0}</div>
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 12, borderRadius: 10 }}>
          <div style={{ color: C.textFaint, fontFamily: C.mono, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>Est. Value</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.cream }}>${summary?.estimated_value_low ?? 0}–${summary?.estimated_value_high ?? 0}</div>
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 12, borderRadius: 10 }}>
          <div style={{ color: C.textFaint, fontFamily: C.mono, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>Follow-ups Due</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: summary?.follow_ups_due?.length ? "#F59E0B" : C.cream }}>{summary?.follow_ups_due?.length ?? 0}</div>
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 12, borderRadius: 10 }}>
          <div style={{ color: C.textFaint, fontFamily: C.mono, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>Replies</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: summary?.recent_replies?.length ? "#10B981" : C.cream }}>{summary?.recent_replies?.length ?? 0}</div>
        </div>
      </div>

      {/* Pipeline Columns */}
      <div style={{ display: "flex", gap: 10, overflowX: "auto", alignItems: "flex-start", paddingBottom: 10 }}>
        {PIPELINE_COLUMNS.map((column) => {
          const cards = grouped.get(column.status) ?? [];
          return (
            <section key={column.status} style={{ minWidth: 260, flex: "1 0 260px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${column.color}30` }}>
                <strong style={{ color: C.cream, fontSize: 12 }}>{column.label}</strong>
                <span style={{ color: column.color, fontFamily: C.mono, fontSize: 12, fontWeight: 700, background: `${column.color}18`, padding: "2px 8px", borderRadius: 10 }}>{cards.length}</span>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {cards.length === 0 && (
                  <div style={{ fontSize: 11, color: C.textFaint, textAlign: "center", padding: "12px 0" }}>No deals</div>
                )}
                {cards.map((deal) => (
                  <div key={deal.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, transition: "border-color 0.15s" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${column.color}60`; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
                  >
                    <button onClick={() => void openDeal(deal.id)} style={{ textAlign: "left", background: "transparent", border: "none", color: C.text, cursor: "pointer", width: "100%", padding: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{deal.brand_name}</div>
                        {deal.priority && <span style={{ fontFamily: C.mono, fontSize: 10, color: C.cl, background: `${C.cl}15`, padding: "1px 6px", borderRadius: 4 }}>{deal.priority}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <span style={{ color: C.textDim, fontSize: 11 }}>{deal.contact_email ?? "No contact"}</span>
                        {deal.scout_reason?.startsWith("[CHATGPT]") && <span style={{ fontFamily: C.mono, fontSize: 8, padding: "1px 5px", borderRadius: 3, background: `${C.gpt}20`, color: C.gpt, fontWeight: 700 }}>WEB</span>}
                        {deal.scout_reason?.startsWith("[CLAUDE]") && <span style={{ fontFamily: C.mono, fontSize: 8, padding: "1px 5px", borderRadius: 3, background: `${C.cl}20`, color: C.cl, fontWeight: 700 }}>AI</span>}
                      </div>
                      {deal.scout_reason && <div style={{ color: C.gem, fontSize: 10, marginTop: 4 }}>{deal.scout_reason.replace(/^\[(CLAUDE|CHATGPT)\]\s*/, "")}</div>}
                      {(deal.estimated_value_low || deal.estimated_value_high) && (
                        <div style={{ marginTop: 6, color: C.textFaint, fontSize: 10, fontFamily: C.mono }}>${deal.estimated_value_low ?? 0}–${deal.estimated_value_high ?? 0}</div>
                      )}
                    </button>
                    {deal.status === "scouted" && (
                      <div style={{ display: "flex", gap: 4, marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                        <button onClick={() => void promoteDeal(deal.id, "prospect")} style={{ flex: 1, background: `${C.gpt}15`, color: C.gpt, border: `1px solid ${C.gpt}30`, borderRadius: 4, padding: "3px 0", fontFamily: C.mono, fontSize: 9, cursor: "pointer" }}>Pursue</button>
                        <button onClick={() => void delayDeal(deal.id)} style={{ flex: 1, background: `${C.gold}10`, color: C.gold, border: `1px solid ${C.gold}25`, borderRadius: 4, padding: "3px 0", fontFamily: C.mono, fontSize: 9, cursor: "pointer" }}>Delay</button>
                        <button onClick={async () => { await api(`/api/brands/${deal.id}`, { method: "DELETE", body: JSON.stringify({ reason: "Not interested — dismissed from scout" }) }); showToast(`${deal.brand_name} dismissed`, "success"); window.dispatchEvent(new CustomEvent("brands:refresh")); }} style={{ flex: 1, background: `${C.reminder}10`, color: C.reminder, border: `1px solid ${C.reminder}25`, borderRadius: 4, padding: "3px 0", fontFamily: C.mono, fontSize: 9, cursor: "pointer" }}>Pass</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Deal Detail Sidebar */}
      {selected && (() => {
        const latestOutbound = selected.emails.find((e) => e.direction === "outbound");
        const hasDraft = latestOutbound?.gmail_draft_id;
        return (
        <aside style={{ position: "fixed", top: 0, right: 0, width: 480, maxWidth: "100vw", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, padding: 20, overflowY: "auto", zIndex: 100, boxShadow: "-4px 0 20px #0004" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <h2 style={{ fontFamily: C.serif, color: C.cream, margin: 0, fontSize: 20 }}>{selected.deal.brand_name}</h2>
            <button onClick={() => setSelected(null)} style={{ background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}>&#10005;</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {selected.deal.status && <span style={{ fontSize: 10, fontFamily: C.mono, padding: "3px 8px", borderRadius: 4, background: `${C.cl}15`, color: C.cl }}>{selected.deal.status}</span>}
            {selected.deal.priority && <span style={{ fontSize: 10, fontFamily: C.mono, padding: "3px 8px", borderRadius: 4, background: C.border, color: C.textDim }}>{selected.deal.priority}</span>}
            {selected.deal.deal_type && <span style={{ fontSize: 10, fontFamily: C.mono, padding: "3px 8px", borderRadius: 4, background: C.border, color: C.textDim }}>{selected.deal.deal_type}</span>}
          </div>
          {selected.deal.relationship_notes && <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}><strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Relationship</strong><br />{selected.deal.relationship_notes}</div>}
          {selected.deal.product_usage && <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}><strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Product Usage</strong><br />{selected.deal.product_usage}</div>}
          {selected.deal.angle && <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.6, marginBottom: 14 }}><strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Angle</strong><br />{selected.deal.angle}</div>}

          {/* Actions: Draft / Send / Archive */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <button onClick={() => void generateDraft()} disabled={drafting} style={{ background: C.cl, color: C.bg, border: "none", borderRadius: 8, padding: "8px 14px", fontFamily: C.mono, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              {drafting ? "Drafting..." : latestOutbound ? "Redraft" : "Draft Email"}
            </button>
            {hasDraft && (
              <button onClick={() => void sendDraft()} disabled={sending} style={{ background: C.gpt, color: C.bg, border: "none", borderRadius: 8, padding: "8px 14px", fontFamily: C.mono, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                {sending ? "Sending..." : "Send Email"}
              </button>
            )}
            <button onClick={async () => { await api(`/api/brands/${selected.deal.id}`, { method: "DELETE", body: JSON.stringify({ reason: "Archived from brands UI" }) }); setSelected(null); showToast("Deal archived", "success"); window.dispatchEvent(new CustomEvent("brands:refresh")); }} style={{ background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", fontFamily: C.mono, fontSize: 11, cursor: "pointer" }}>
              Archive
            </button>
          </div>

          {/* Latest Draft Preview */}
          {latestOutbound && (
            <div style={{ marginBottom: 16, border: `1px solid ${C.cl}30`, borderRadius: 8, background: C.card, padding: 12 }}>
              <div style={{ fontFamily: C.mono, fontSize: 10, color: C.cl, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Latest Draft</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{latestOutbound.subject ?? "(no subject)"}</div>
              {latestOutbound.summary && <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.5 }}>{latestOutbound.summary}</div>}
              {hasDraft && <div style={{ marginTop: 6, fontFamily: C.mono, fontSize: 9, color: C.gpt }}>Gmail draft ready to send</div>}

              {/* Revise box */}
              <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={reviseText}
                  onChange={(e) => setReviseText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && reviseText.trim()) { e.preventDefault(); void reviseDraft(); } }}
                  placeholder="Make it shorter... add Berlin angle... less formal..."
                  disabled={revising}
                  style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 11, color: C.text, outline: "none" }}
                />
                <button onClick={() => void reviseDraft()} disabled={revising || !reviseText.trim()} style={{ background: reviseText.trim() ? `${C.gold}20` : "transparent", color: reviseText.trim() ? C.gold : C.textDim, border: `1px solid ${reviseText.trim() ? `${C.gold}40` : C.border}`, borderRadius: 6, padding: "6px 10px", fontFamily: C.mono, fontSize: 10, cursor: reviseText.trim() ? "pointer" : "default", whiteSpace: "nowrap" }}>
                  {revising ? "..." : "Revise"}
                </button>
              </div>
              <div style={{ fontFamily: C.mono, fontSize: 8, color: C.textFaint, marginTop: 4 }}>Edit instructions are applied by the brand voice agent</div>
            </div>
          )}

          {/* Feedback */}
          <div style={{ marginBottom: 16, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Feedback</div>
            <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
              {(["like", "dislike"] as const).map((type) => (
                <button key={type} onClick={() => void submitFeedback(type, type === "like" ? "Good approach for this brand" : "Wrong approach for this brand")} disabled={submittingFeedback} style={{ background: `${type === "like" ? C.gpt : C.reminder}10`, border: `1px solid ${type === "like" ? C.gpt : C.reminder}25`, borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: submittingFeedback ? "default" : "pointer" }}>
                  {type === "like" ? "\u{1F44D}" : "\u{1F44E}"}
                </button>
              ))}
            </div>
            {feedbacks.slice(0, 3).map((fb) => (
              <div key={fb.id} style={{ fontSize: 10, color: C.textDim, padding: "3px 8px", marginBottom: 3, borderLeft: `2px solid ${fb.feedback_type === "like" ? C.gpt : fb.feedback_type === "dislike" ? C.reminder : C.gold}30` }}>
                [{fb.feedback_type}] {fb.content}
              </div>
            ))}
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              <input type="text" value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && feedbackText.trim()) { e.preventDefault(); void submitFeedback("correction", feedbackText.trim()); } }} placeholder="Feedback on this brand approach..." disabled={submittingFeedback} style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 8px", fontSize: 10, color: C.text, outline: "none" }} />
              <button onClick={() => void submitFeedback("correction", feedbackText.trim())} disabled={submittingFeedback || !feedbackText.trim()} style={{ background: feedbackText.trim() ? `${C.cl}14` : "transparent", border: `1px solid ${feedbackText.trim() ? `${C.cl}30` : C.border}`, color: feedbackText.trim() ? C.cl : C.textDim, borderRadius: 4, padding: "4px 8px", fontSize: 9, fontFamily: C.mono, cursor: feedbackText.trim() ? "pointer" : "default" }}>
                {submittingFeedback ? "..." : "Send"}
              </button>
            </div>
            <div style={{ fontFamily: C.mono, fontSize: 8, color: C.textFaint, marginTop: 4 }}>Feedback trains the brand voice + scouting agents</div>
          </div>

          {/* Email History */}
          <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Email History</div>
          {selected.emails.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>No emails yet</div>}
          {selected.emails.map((email) => (
            <div key={email.id} style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 8, padding: 10, marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: C.textFaint, fontSize: 10 }}>{new Date(email.sent_at).toLocaleDateString()}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <span style={{ fontSize: 9, fontFamily: C.mono, padding: "1px 5px", borderRadius: 3, background: email.direction === "outbound" ? `${C.cl}15` : "#10B98115", color: email.direction === "outbound" ? C.cl : "#10B981" }}>{email.direction}</span>
                  <span style={{ fontSize: 9, fontFamily: C.mono, padding: "1px 5px", borderRadius: 3, background: C.border, color: C.textDim }}>{email.email_type}</span>
                </div>
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>{email.subject ?? "(no subject)"}</div>
              {email.summary && <div style={{ color: C.textDim, fontSize: 11, marginTop: 2 }}>{email.summary}</div>}
            </div>
          ))}
        </aside>
        );
      })()}
    </main>
  );
}
