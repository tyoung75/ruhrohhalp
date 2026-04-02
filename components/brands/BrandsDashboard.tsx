"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";
import type { BrandDeal, BrandDealStatus, PipelineSummary } from "@/lib/types/brands";
import { PIPELINE_COLUMNS } from "@/lib/types/brands";

interface DealDetailResponse {
  deal: BrandDeal;
  emails: Array<{ id: string; sent_at: string; email_type: string; direction: string; subject: string | null; summary: string | null }>;
}

interface RunResponse {
  ok: boolean;
  actions_taken: { drafted: unknown[]; replied: unknown[]; archived: unknown[] };
}

const EMPTY_BRAND_FORM = {
  brand_name: "",
  contact_email: "",
  contact_name: "",
  relationship_notes: "",
  product_usage: "",
  angle: "",
  priority: "P1" as const,
  dont_say: [] as string[],
};

type SetupState = "loading" | "ready" | "needs_setup" | "setup_running";

export function BrandsDashboard() {
  const [setupState, setSetupState] = useState<SetupState>("loading");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [deals, setDeals] = useState<BrandDeal[]>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [selected, setSelected] = useState<DealDetailResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_BRAND_FORM);
  const [adding, setAdding] = useState(false);

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  async function fetchDeals() {
    try {
      const [dealsRes, summaryRes] = await Promise.all([
        api<{ deals: BrandDeal[] }>("/api/brands"),
        api<PipelineSummary>("/api/brands/summary"),
      ]);
      setDeals(dealsRes.deals);
      setSummary(summaryRes);
      setSetupState("ready");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("brand_deals") || msg.includes("schema cache")) {
        setSetupState("needs_setup");
      } else {
        setSetupState("ready");
        showToast(msg || "Failed to load deals", "error");
      }
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

  async function runPipeline() {
    setRunning(true);
    try {
      const result = await api<RunResponse>("/api/brands/run", { method: "POST" });
      const { drafted, replied, archived } = result.actions_taken;
      const parts = [];
      if (drafted.length) parts.push(`${drafted.length} drafted`);
      if (replied.length) parts.push(`${replied.length} replies processed`);
      if (archived.length) parts.push(`${archived.length} archived`);
      showToast(parts.length ? `Pipeline complete: ${parts.join(", ")}` : "Pipeline ran — no actions needed", "success");
      window.dispatchEvent(new CustomEvent("brands:refresh"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Pipeline run failed", "error");
    } finally {
      setRunning(false);
    }
  }

  async function addBrand() {
    if (!addForm.brand_name.trim()) return;
    setAdding(true);
    try {
      await api("/api/brands", {
        method: "POST",
        body: JSON.stringify({
          brand_name: addForm.brand_name.trim(),
          contact_email: addForm.contact_email.trim() || null,
          contact_name: addForm.contact_name.trim() || null,
          relationship_notes: addForm.relationship_notes.trim() || null,
          product_usage: addForm.product_usage.trim() || null,
          angle: addForm.angle.trim() || null,
          priority: addForm.priority,
          status: "prospect",
          dont_say: addForm.dont_say,
        }),
      });
      setAddForm(EMPTY_BRAND_FORM);
      setShowAddForm(false);
      showToast(`${addForm.brand_name.trim()} added to pipeline`, "success");
      window.dispatchEvent(new CustomEvent("brands:refresh"));
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to add brand", "error");
      return false;
    } finally {
      setAdding(false);
    }
  }

  async function openDeal(id: string) {
    try {
      const detail = await api<DealDetailResponse>(`/api/brands/${id}`);
      setSelected(detail);
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
  const inputStyle = {
    background: C.card,
    color: C.text,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 13,
    outline: "none",
  };

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
          }}
          onClick={() => setToast(null)}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontFamily: C.serif, color: C.cream, margin: 0, fontSize: 22 }}>Brand Outreach</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => void runPipeline()}
            disabled={running}
            style={{
              background: "transparent",
              color: running ? C.textDim : C.cl,
              border: `1px solid ${running ? C.border : C.cl}`,
              borderRadius: 8,
              padding: "8px 14px",
              fontFamily: C.mono,
              fontSize: 11,
              fontWeight: 600,
              cursor: running ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {running ? (
              <>
                <span style={{ display: "inline-block", animation: "spin 1s linear infinite", fontSize: 12 }}>&#8635;</span>
                Running...
              </>
            ) : (
              <>&#9654; Run Pipeline</>
            )}
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              background: showAddForm ? C.border : C.cl,
              color: showAddForm ? C.textDim : C.bg,
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              fontFamily: C.mono,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {showAddForm ? "Cancel" : "+ Add Brand"}
          </button>
        </div>
      </div>

      {/* Add Brand Form */}
      {showAddForm && (
        <div style={{ marginBottom: 16, padding: 16, border: `1px solid ${C.cl}30`, borderRadius: 10, background: C.surface }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.cl, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>New Brand Prospect</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <input placeholder="Brand name *" value={addForm.brand_name} onChange={(e) => setAddForm({ ...addForm, brand_name: e.target.value })} style={inputStyle} />
            <input placeholder="Contact email" value={addForm.contact_email} onChange={(e) => setAddForm({ ...addForm, contact_email: e.target.value })} style={inputStyle} />
            <input placeholder="Contact name" value={addForm.contact_name} onChange={(e) => setAddForm({ ...addForm, contact_name: e.target.value })} style={inputStyle} />
            <select value={addForm.priority} onChange={(e) => setAddForm({ ...addForm, priority: e.target.value as "P0" | "P1" | "P2" })} style={inputStyle}>
              <option value="P0">P0 — High priority</option>
              <option value="P1">P1 — Normal</option>
              <option value="P2">P2 — Low priority</option>
            </select>
          </div>
          <input placeholder="Product usage — how you already use their product" value={addForm.product_usage} onChange={(e) => setAddForm({ ...addForm, product_usage: e.target.value })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
          <input placeholder="Angle — your pitch hook for this brand" value={addForm.angle} onChange={(e) => setAddForm({ ...addForm, angle: e.target.value })} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 10 }} />
          <textarea placeholder="Relationship notes — any existing connection or context" value={addForm.relationship_notes} onChange={(e) => setAddForm({ ...addForm, relationship_notes: e.target.value })} rows={2} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 12, resize: "vertical" }} />
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => void addBrand()}
              disabled={adding || !addForm.brand_name.trim()}
              style={{
                background: addForm.brand_name.trim() ? C.cl : C.border,
                color: addForm.brand_name.trim() ? C.bg : C.textDim,
                border: "none",
                borderRadius: 8,
                padding: "10px 20px",
                fontFamily: C.mono,
                fontSize: 12,
                fontWeight: 700,
                cursor: addForm.brand_name.trim() ? "pointer" : "default",
              }}
            >
              {adding ? "Adding..." : "Add to Pipeline"}
            </button>
            <button
              onClick={() => {
                if (!addForm.brand_name.trim()) return;
                void (async () => {
                  const ok = await addBrand();
                  if (ok) void runPipeline();
                })();
              }}
              disabled={adding || running || !addForm.brand_name.trim()}
              style={{
                background: "transparent",
                color: addForm.brand_name.trim() ? C.cl : C.textDim,
                border: `1px solid ${addForm.brand_name.trim() ? C.cl : C.border}`,
                borderRadius: 8,
                padding: "10px 20px",
                fontFamily: C.mono,
                fontSize: 12,
                cursor: addForm.brand_name.trim() ? "pointer" : "default",
              }}
            >
              {adding || running ? "Working..." : "Add + Draft Email"}
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
                  <button
                    key={deal.id}
                    onClick={() => void openDeal(deal.id)}
                    style={{
                      textAlign: "left",
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: 10,
                      color: C.text,
                      cursor: "pointer",
                      width: "100%",
                      transition: "border-color 0.15s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${column.color}60`; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{deal.brand_name}</div>
                      {deal.priority && <span style={{ fontFamily: C.mono, fontSize: 10, color: C.cl, background: `${C.cl}15`, padding: "1px 6px", borderRadius: 4 }}>{deal.priority}</span>}
                    </div>
                    <div style={{ color: C.textDim, fontSize: 11, marginTop: 4 }}>{deal.contact_email ?? "No contact"}</div>
                    {(deal.estimated_value_low || deal.estimated_value_high) && (
                      <div style={{ marginTop: 6, color: C.textFaint, fontSize: 10, fontFamily: C.mono }}>${deal.estimated_value_low ?? 0}–${deal.estimated_value_high ?? 0}</div>
                    )}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Deal Detail Sidebar */}
      {selected && (
        <aside style={{ position: "fixed", top: 0, right: 0, width: 460, maxWidth: "100vw", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, padding: 20, overflowY: "auto", zIndex: 100, boxShadow: "-4px 0 20px #0004" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <h2 style={{ fontFamily: C.serif, color: C.cream, margin: 0, fontSize: 20 }}>{selected.deal.brand_name}</h2>
            <button
              onClick={() => setSelected(null)}
              style={{ background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 14 }}
            >
              &#10005;
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {selected.deal.status && <span style={{ fontSize: 10, fontFamily: C.mono, padding: "3px 8px", borderRadius: 4, background: `${C.cl}15`, color: C.cl }}>{selected.deal.status}</span>}
            {selected.deal.priority && <span style={{ fontSize: 10, fontFamily: C.mono, padding: "3px 8px", borderRadius: 4, background: `${C.border}`, color: C.textDim }}>{selected.deal.priority}</span>}
            {selected.deal.deal_type && <span style={{ fontSize: 10, fontFamily: C.mono, padding: "3px 8px", borderRadius: 4, background: `${C.border}`, color: C.textDim }}>{selected.deal.deal_type}</span>}
          </div>
          {selected.deal.relationship_notes && <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}><strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Relationship</strong><br />{selected.deal.relationship_notes}</div>}
          {selected.deal.product_usage && <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.6, marginBottom: 8 }}><strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Product Usage</strong><br />{selected.deal.product_usage}</div>}
          {selected.deal.angle && <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.6, marginBottom: 14 }}><strong style={{ color: C.textFaint, fontSize: 10, textTransform: "uppercase" }}>Angle</strong><br />{selected.deal.angle}</div>}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <button
              onClick={async () => {
                await api(`/api/brands/${selected.deal.id}/draft`, { method: "POST" });
                showToast("Draft created", "success");
                window.dispatchEvent(new CustomEvent("brands:refresh"));
              }}
              style={{ background: C.cl, color: C.bg, border: "none", borderRadius: 8, padding: "8px 14px", fontFamily: C.mono, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              Draft Email
            </button>
            <button
              onClick={async () => {
                await api(`/api/brands/${selected.deal.id}`, { method: "DELETE", body: JSON.stringify({ reason: "Archived from brands UI" }) });
                setSelected(null);
                showToast("Deal archived", "success");
                window.dispatchEvent(new CustomEvent("brands:refresh"));
              }}
              style={{ background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", fontFamily: C.mono, fontSize: 11, cursor: "pointer" }}
            >
              Archive
            </button>
          </div>
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
      )}
    </main>
  );
}
