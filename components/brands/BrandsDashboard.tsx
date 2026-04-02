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

interface PipelineResult {
  ok: boolean;
  timestamp: string;
  actions_taken: {
    replied: Array<{ brand: string; classification?: string }>;
    drafted: Array<{ brand: string; subject?: string; draftId?: string | null; preview?: string }>;
    archived: Array<{ brand: string }>;
    skipped?: Array<{ brand: string; reason: string }>;
  };
  pipeline_status: PipelineSummary;
}

export function BrandsDashboard() {
  const [deals, setDeals] = useState<BrandDeal[]>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [selected, setSelected] = useState<DealDetailResponse | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

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

  async function openDeal(id: string) {
    const detail = await api<DealDetailResponse>(`/api/brands/${id}`);
    setSelected(detail);
  }

  async function runPipeline() {
    setPipelineRunning(true);
    setPipelineResult(null);
    setPipelineError(null);
    try {
      const result = await api<PipelineResult>("/api/brands/run-pipeline", { method: "POST" });
      setPipelineResult(result);
      void fetchDeals();
    } catch (err) {
      setPipelineError(String(err));
    } finally {
      setPipelineRunning(false);
    }
  }

  const totalActions = pipelineResult
    ? (pipelineResult.actions_taken.replied.length + pipelineResult.actions_taken.drafted.length + pipelineResult.actions_taken.archived.length)
    : 0;

  return (
    <main style={{ background: C.bg, minHeight: "100%", color: C.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontFamily: C.serif, color: C.cream, marginTop: 0, marginBottom: 0 }}>Brand Outreach Pipeline</h1>
        <button
          onClick={() => void runPipeline()}
          disabled={pipelineRunning}
          style={{
            background: pipelineRunning ? C.surface : C.cl,
            color: pipelineRunning ? C.textDim : C.bg,
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontWeight: 700,
            fontFamily: C.mono,
            fontSize: 12,
            cursor: pipelineRunning ? "wait" : "pointer",
            opacity: pipelineRunning ? 0.7 : 1,
          }}
        >
          {pipelineRunning ? "Running Pipeline..." : "Run Pipeline"}
        </button>
      </div>

      {/* Pipeline Results Banner */}
      {pipelineError && (
        <div style={{ background: "#2a1519", border: "1px solid #EF4444", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13 }}>
          <strong style={{ color: "#EF4444" }}>Pipeline Error:</strong> <span style={{ color: C.textDim }}>{pipelineError}</span>
        </div>
      )}
      {pipelineResult && (
        <div style={{ background: totalActions > 0 ? "#152a1a" : C.surface, border: `1px solid ${totalActions > 0 ? "#22C55E" : C.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: totalActions > 0 ? 10 : 0 }}>
            <strong style={{ color: totalActions > 0 ? "#22C55E" : C.textDim, fontSize: 13 }}>
              Pipeline Complete — {totalActions} action{totalActions !== 1 ? "s" : ""} taken
            </strong>
            <span style={{ color: C.textFaint, fontFamily: C.mono, fontSize: 10 }}>{new Date(pipelineResult.timestamp).toLocaleTimeString()}</span>
          </div>
          {pipelineResult.actions_taken.drafted.map((d, i) => (
            <div key={i} style={{ marginTop: 6, fontSize: 12 }}>
              <span style={{ color: C.cl }}>Drafted:</span>{" "}
              <strong>{d.brand}</strong>
              {d.subject && <span style={{ color: C.textDim }}> — {d.subject}</span>}
              {d.draftId && <span style={{ color: C.gpt, fontFamily: C.mono, fontSize: 10 }}> (Gmail draft created)</span>}
              {!d.draftId && <span style={{ color: C.textFaint, fontFamily: C.mono, fontSize: 10 }}> (no Gmail — preview only)</span>}
              {d.preview && <div style={{ color: C.textDim, fontSize: 11, marginTop: 4, paddingLeft: 12, borderLeft: `2px solid ${C.border}` }}>{d.preview}...</div>}
            </div>
          ))}
          {pipelineResult.actions_taken.replied.map((r, i) => (
            <div key={i} style={{ marginTop: 6, fontSize: 12 }}>
              <span style={{ color: C.gpt }}>Reply detected:</span>{" "}
              <strong>{r.brand}</strong>
              {r.classification && <span style={{ color: C.textDim }}> — {r.classification}</span>}
            </div>
          ))}
          {pipelineResult.actions_taken.archived.map((a, i) => (
            <div key={i} style={{ marginTop: 6, fontSize: 12 }}>
              <span style={{ color: "#EF4444" }}>Archived:</span> <strong>{a.brand}</strong> — no response after full cadence
            </div>
          ))}
          {(pipelineResult.actions_taken.skipped ?? []).map((s, i) => (
            <div key={i} style={{ marginTop: 6, fontSize: 12, color: C.textDim }}>
              Skipped: <strong>{s.brand}</strong> — {s.reason}
            </div>
          ))}
          {totalActions === 0 && (
            <div style={{ color: C.textDim, fontSize: 12, marginTop: 4 }}>No actionable deals found. Deals in &quot;sent&quot; status need to pass their next_action_date before follow-ups are generated.</div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 12, borderRadius: 10 }}>
          <div style={{ color: C.textDim, fontFamily: C.mono, fontSize: 11 }}>Active Deals</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{summary?.total_active ?? 0}</div>
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 12, borderRadius: 10 }}>
          <div style={{ color: C.textDim, fontFamily: C.mono, fontSize: 11 }}>Estimated Value</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>${summary?.estimated_value_low ?? 0} - ${summary?.estimated_value_high ?? 0}</div>
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 12, borderRadius: 10 }}>
          <div style={{ color: C.textDim, fontFamily: C.mono, fontSize: 11 }}>Follow-ups Due</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{summary?.follow_ups_due?.length ?? 0}</div>
        </div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 12, borderRadius: 10 }}>
          <div style={{ color: C.textDim, fontFamily: C.mono, fontSize: 11 }}>Drafts Today</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{summary?.drafts_today?.length ?? 0}</div>
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
                    {deal.next_action && (
                      <div style={{ marginTop: 6, color: C.cl, fontSize: 11 }}>{deal.next_action}</div>
                    )}
                    <div style={{ marginTop: 8, color: C.textFaint, fontSize: 11 }}>${deal.estimated_value_low ?? 0} - ${deal.estimated_value_high ?? 0}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ fontFamily: C.mono, fontSize: 11, color: C.cl }}>{deal.priority ?? "--"}</span>
                      {deal.next_action_date && (
                        <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint }}>due {deal.next_action_date}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {selected && (
        <aside style={{ position: "fixed", top: 0, right: 0, width: 460, maxWidth: "100vw", height: "100vh", background: C.surface, borderLeft: `1px solid ${C.border}`, padding: 16, overflowY: "auto", zIndex: 50 }}>
          <button onClick={() => setSelected(null)} style={{ float: "right", background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Close</button>
          <h2 style={{ fontFamily: C.serif }}>{selected.deal.brand_name}</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            {selected.deal.priority && <span style={{ background: C.clDim, color: C.cl, padding: "2px 8px", borderRadius: 4, fontFamily: C.mono, fontSize: 11 }}>{selected.deal.priority}</span>}
            {selected.deal.deal_type && <span style={{ background: C.gemDim, color: C.gem, padding: "2px 8px", borderRadius: 4, fontFamily: C.mono, fontSize: 11 }}>{selected.deal.deal_type}</span>}
            {selected.deal.relationship_type && <span style={{ background: C.gptDim, color: C.gpt, padding: "2px 8px", borderRadius: 4, fontFamily: C.mono, fontSize: 11 }}>{selected.deal.relationship_type}</span>}
          </div>
          {selected.deal.relationship_notes && <p style={{ color: C.textDim, fontSize: 13 }}>{selected.deal.relationship_notes}</p>}
          {selected.deal.product_usage && <p style={{ color: C.textDim, fontSize: 13 }}><strong style={{ color: C.cream }}>Usage:</strong> {selected.deal.product_usage}</p>}
          {selected.deal.angle && <p style={{ color: C.textDim, fontSize: 13 }}><strong style={{ color: C.cream }}>Angle:</strong> {selected.deal.angle}</p>}
          {selected.deal.next_action && <p style={{ color: C.cl, fontSize: 13 }}><strong>Next:</strong> {selected.deal.next_action}{selected.deal.next_action_date ? ` (due ${selected.deal.next_action_date})` : ""}</p>}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button
              onClick={async () => {
                await api(`/api/brands/${selected.deal.id}/draft`, { method: "POST" });
                window.dispatchEvent(new CustomEvent("brands:refresh"));
                const detail = await api<DealDetailResponse>(`/api/brands/${selected.deal.id}`);
                setSelected(detail);
              }}
              style={{ background: C.cl, color: C.bg, border: "none", borderRadius: 8, padding: "8px 10px", cursor: "pointer", fontWeight: 600 }}
            >
              Draft Email
            </button>
            <button
              onClick={async () => {
                await api(`/api/brands/${selected.deal.id}`, { method: "DELETE", body: JSON.stringify({ reason: "Archived from brands UI" }) });
                setSelected(null);
                window.dispatchEvent(new CustomEvent("brands:refresh"));
              }}
              style={{ background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}
            >
              Archive
            </button>
          </div>
          <h3 style={{ fontFamily: C.mono, fontSize: 12, letterSpacing: 0.5 }}>Email History</h3>
          {selected.emails.length === 0 && (
            <div style={{ color: C.textFaint, fontSize: 12, padding: 10 }}>No email history yet. Use &quot;Draft Email&quot; to generate the first outreach.</div>
          )}
          {selected.emails.map((email) => (
            <div key={email.id} style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: email.direction === "inbound" ? C.gpt : C.cl, fontSize: 11, fontFamily: C.mono }}>{email.direction === "inbound" ? "IN" : "OUT"} · {email.email_type}</span>
                <span style={{ color: C.textFaint, fontSize: 11 }}>{new Date(email.sent_at).toLocaleDateString()}</span>
              </div>
              <div style={{ marginTop: 4, fontWeight: 600 }}>{email.subject ?? "(no subject)"}</div>
              {email.summary && <div style={{ color: C.textDim, fontSize: 12, marginTop: 4 }}>{email.summary}</div>}
            </div>
          ))}
        </aside>
      )}
    </main>
  );
}
