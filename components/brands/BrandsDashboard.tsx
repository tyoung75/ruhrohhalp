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
  status: "prospect" as const,
  dont_say: [] as string[],
};

export function BrandsDashboard() {
  const [deals, setDeals] = useState<BrandDeal[]>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [selected, setSelected] = useState<DealDetailResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_BRAND_FORM);
  const [adding, setAdding] = useState(false);

  async function fetchDeals() {
    const [dealsRes, summaryRes] = await Promise.all([
      api<{ deals: BrandDeal[] }>("/api/brands"),
      api<PipelineSummary>("/api/brands/summary"),
    ]);
    setDeals(dealsRes.deals);
    setSummary(summaryRes);
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
    setRunResult(null);
    try {
      const result = await api<RunResponse>("/api/brands/run", { method: "POST" });
      setRunResult(`Run complete: drafted ${result.actions_taken.drafted.length}, replies ${result.actions_taken.replied.length}, archived ${result.actions_taken.archived.length}`);
      window.dispatchEvent(new CustomEvent("brands:refresh"));
    } catch (error) {
      setRunResult(error instanceof Error ? error.message : "Run failed");
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
      window.dispatchEvent(new CustomEvent("brands:refresh"));
    } catch (error) {
      setRunResult(error instanceof Error ? error.message : "Failed to add brand");
    } finally {
      setAdding(false);
    }
  }

  async function openDeal(id: string) {
    const detail = await api<DealDetailResponse>(`/api/brands/${id}`);
    setSelected(detail);
  }

  return (
    <main style={{ background: C.bg, minHeight: "100%", color: C.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontFamily: C.serif, color: C.cream, margin: 0 }}>Brand Outreach Pipeline</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{
            background: showAddForm ? C.border : C.cl,
            color: showAddForm ? C.textDim : C.bg,
            border: "none",
            borderRadius: 8,
            padding: "10px 16px",
            fontFamily: C.mono,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {showAddForm ? "Cancel" : "+ Add Brand"}
        </button>
      </div>

      {showAddForm && (
        <div style={{ marginBottom: 16, padding: 14, border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface }}>
          <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textDim, marginBottom: 10 }}>New brand prospect</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <input placeholder="Brand name *" value={addForm.brand_name} onChange={(e) => setAddForm({ ...addForm, brand_name: e.target.value })} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
            <input placeholder="Contact email" value={addForm.contact_email} onChange={(e) => setAddForm({ ...addForm, contact_email: e.target.value })} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
            <input placeholder="Contact name" value={addForm.contact_name} onChange={(e) => setAddForm({ ...addForm, contact_name: e.target.value })} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 13 }} />
            <select value={addForm.priority} onChange={(e) => setAddForm({ ...addForm, priority: e.target.value as "P0" | "P1" | "P2" })} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 13 }}>
              <option value="P0">P0 — High priority</option>
              <option value="P1">P1 — Normal</option>
              <option value="P2">P2 — Low priority</option>
            </select>
          </div>
          <input placeholder="Product usage — how you already use their product" value={addForm.product_usage} onChange={(e) => setAddForm({ ...addForm, product_usage: e.target.value })} style={{ width: "100%", boxSizing: "border-box", background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, marginBottom: 10 }} />
          <input placeholder="Angle — your pitch hook for this brand" value={addForm.angle} onChange={(e) => setAddForm({ ...addForm, angle: e.target.value })} style={{ width: "100%", boxSizing: "border-box", background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, marginBottom: 10 }} />
          <textarea placeholder="Relationship notes — any existing connection or context" value={addForm.relationship_notes} onChange={(e) => setAddForm({ ...addForm, relationship_notes: e.target.value })} rows={2} style={{ width: "100%", boxSizing: "border-box", background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, marginBottom: 10, resize: "vertical" }} />
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
                  await addBrand();
                  void runPipeline();
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
              {adding || running ? "Working..." : "Add + Draft Email Now"}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 14, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface }}>
        <div style={{ fontFamily: C.mono, fontSize: 11, color: C.textDim, marginBottom: 8 }}>Run pipeline on all prospects</div>
        <button
          onClick={() => void runPipeline()}
          disabled={running}
          style={{
            width: "100%",
            background: running ? C.border : C.cl,
            color: running ? C.textDim : C.bg,
            border: "none",
            borderRadius: 8,
            padding: "10px 12px",
            fontFamily: C.mono,
            fontSize: 12,
            cursor: running ? "default" : "pointer",
          }}
        >
          {running ? "Running brand sourcing + drafts..." : "Run Sourcing + Drafts Now"}
        </button>
      </div>
      {runResult && <div style={{ color: C.textDim, marginBottom: 10, fontSize: 12 }}>{runResult}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 12, borderRadius: 10 }}>
          <div style={{ color: C.textDim, fontFamily: C.mono, fontSize: 11 }}>Active Deals</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{summary?.total_active ?? 0}</div>
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 12, borderRadius: 10 }}>
          <div style={{ color: C.textDim, fontFamily: C.mono, fontSize: 11 }}>Estimated Value</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>${summary?.estimated_value_low ?? 0} - ${summary?.estimated_value_high ?? 0}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, overflowX: "auto", alignItems: "flex-start", paddingBottom: 10 }}>
        {PIPELINE_COLUMNS.map((column) => {
          const cards = grouped.get(column.status) ?? [];
          return (
            <section key={column.status} style={{ minWidth: 280, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <strong style={{ color: C.cream }}>{column.label}</strong>
                <span style={{ color: column.color, fontFamily: C.mono, fontSize: 11 }}>{cards.length}</span>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
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
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{deal.brand_name}</div>
                    <div style={{ color: C.textDim, fontSize: 12 }}>{deal.contact_email ?? "No contact"}</div>
                    <div style={{ marginTop: 8, color: C.textFaint, fontSize: 11 }}>${deal.estimated_value_low ?? 0} - ${deal.estimated_value_high ?? 0}</div>
                    <div style={{ marginTop: 8, fontFamily: C.mono, fontSize: 11, color: C.cl }}>{deal.priority ?? "--"}</div>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {selected && (
        <aside style={{ position: "fixed", top: 0, right: 0, width: 460, maxWidth: "100vw", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, padding: 16, overflowY: "auto" }}>
          <button onClick={() => setSelected(null)} style={{ float: "right", background: "transparent", color: C.textDim, border: `1px solid ${C.border}` }}>Close</button>
          <h2 style={{ fontFamily: C.serif }}>{selected.deal.brand_name}</h2>
          <p style={{ color: C.textDim }}>{selected.deal.relationship_notes}</p>
          <p style={{ color: C.textDim }}>{selected.deal.product_usage}</p>
          <p style={{ color: C.textDim }}>{selected.deal.angle}</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              onClick={async () => {
                await api(`/api/brands/${selected.deal.id}/draft`, { method: "POST" });
                window.dispatchEvent(new CustomEvent("brands:refresh"));
              }}
              style={{ background: C.cl, color: C.bg, border: "none", borderRadius: 8, padding: "8px 10px" }}
            >
              Draft Email
            </button>
            <button
              onClick={async () => {
                await api(`/api/brands/${selected.deal.id}`, { method: "DELETE", body: JSON.stringify({ reason: "Archived from brands UI" }) });
                setSelected(null);
                window.dispatchEvent(new CustomEvent("brands:refresh"));
              }}
              style={{ background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }}
            >
              Archive
            </button>
          </div>
          <h3 style={{ fontFamily: C.mono, fontSize: 12, letterSpacing: 0.5 }}>Email History</h3>
          {selected.emails.map((email) => (
            <div key={email.id} style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ color: C.textFaint, fontSize: 11 }}>{new Date(email.sent_at).toLocaleString()} · {email.email_type} · {email.direction}</div>
              <div>{email.subject ?? "(no subject)"}</div>
              <div style={{ color: C.textDim, fontSize: 12 }}>{email.summary}</div>
            </div>
          ))}
        </aside>
      )}
    </main>
  );
}
