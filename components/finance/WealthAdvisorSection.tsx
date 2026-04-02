"use client";

import { useEffect, useState } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import type { FinancialStatementIngestion, WealthAdvisorSummary } from "@/lib/types/finance";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: C.serif,
        fontSize: 22,
        color: C.cream,
        marginBottom: 14,
        marginTop: 0,
        fontWeight: 500,
      }}
    >
      {children}
    </h2>
  );
}

export function WealthAdvisorSection({
  advisor,
  statements,
  onUploaded,
}: {
  advisor?: WealthAdvisorSummary;
  statements: FinancialStatementIngestion[];
  onUploaded: () => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [liveAdvisor, setLiveAdvisor] = useState<WealthAdvisorSummary | null>(null);
  const [memoryHealth, setMemoryHealth] = useState<{ available: boolean; reason?: string } | null>(null);

  useEffect(() => {
    api<{ available: boolean; reason?: string }>("/api/health/finance-memory")
      .then((res) => setMemoryHealth({ available: res.available, reason: res.reason }))
      .catch(() => setMemoryHealth(null));
  }, []);

  async function handleUpload(formData: FormData) {
    setUploading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/finance/statements", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setMessage("Statement ingested and advisor context refreshed.");
      await onUploaded();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function refreshWithChatGPT() {
    setGenerating(true);
    setMessage(null);
    try {
      const res = await api<{ advisor: WealthAdvisorSummary; source: string }>("/api/finance/wealth-advisor");
      setLiveAdvisor(res.advisor);
      setMessage(`Wealth advisor refreshed via ${res.source}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to refresh advisor");
    } finally {
      setGenerating(false);
    }
  }

  async function saveFeedback() {
    if (!feedback.trim()) return;
    try {
      await api("/api/finance/wealth-advisor", {
        method: "POST",
        body: JSON.stringify({ feedback: feedback.trim(), decision: "manual_feedback" }),
      });
      setFeedback("");
      setMessage("Feedback saved. Future advisor responses will adapt.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to save feedback");
    }
  }

  const effectiveAdvisor = liveAdvisor ?? advisor;

  const cards: Array<{ title: string; items: string[] }> = [
    { title: "Daily Briefing", items: effectiveAdvisor?.dailyBriefing ?? [] },
    { title: "Deep Analysis", items: effectiveAdvisor?.deepAnalysis ?? [] },
    { title: "Portfolio Alerts", items: effectiveAdvisor?.portfolioAlerts ?? [] },
    { title: "Underlying Insights", items: effectiveAdvisor?.underlyingInsights ?? [] },
    { title: "Optimization Plan", items: effectiveAdvisor?.optimizationPlan ?? [] },
    { title: "Tax Optimization", items: effectiveAdvisor?.taxOptimization ?? [] },
    { title: "Budget Optimization", items: effectiveAdvisor?.budgetOptimization ?? [] },
    { title: "Adaptation Loop", items: effectiveAdvisor?.adaptationLoop ?? [] },
  ];

  return (
    <div style={{ marginBottom: 40 }}>
      <SectionTitle>Wealth Advisor</SectionTitle>
      <div style={{ color: C.textDim, fontSize: 12, marginBottom: 14 }}>
        Monthly optimization cadence with tax-aware account-level actions and adaptive feedback learning.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={refreshWithChatGPT}
          disabled={generating}
          style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.gold}40`, background: C.surface, color: C.gold, fontFamily: C.mono, fontSize: 11 }}
        >
          {generating ? "Refreshing..." : "Refresh with ChatGPT"}
        </button>
        <span style={{ color: C.textFaint, fontSize: 11 }}>Uses portfolio + statement history + saved advisor feedback.</span>
      </div>
      {memoryHealth && !memoryHealth.available && (
        <div style={{ marginBottom: 12, padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.reminder}40`, color: C.reminder, fontSize: 11, fontFamily: C.mono }}>
          Advisor memory table unavailable ({memoryHealth.reason ?? "unknown"}). Advisor still works, but history/feedback won't persist yet.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
        {cards.map((card) => (
          <div key={card.title} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ fontFamily: C.mono, color: C.gold, fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8 }}>{card.title}</div>
            {card.items.length === 0 ? (
              <div style={{ color: C.textDim, fontSize: 12 }}>No insights yet.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                {card.items.map((item, idx) => <li key={`${card.title}-${idx}`} style={{ color: C.text, fontSize: 12 }}>{item}</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontFamily: C.mono, color: C.gold, fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 10 }}>
          Monthly Statement Ingestion
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            await handleUpload(formData);
          }}
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.6fr auto", gap: 8, alignItems: "center" }}
        >
          <input required name="accountName" placeholder="Account name" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "8px 10px" }} />
          <input name="institution" placeholder="Institution (optional)" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "8px 10px" }} />
          <input required name="file" type="file" accept=".csv,.txt,.json,.pdf" style={{ color: C.textDim }} />
          <button type="submit" disabled={uploading} style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${C.gold}40`, background: C.surface, color: C.gold }}>
            {uploading ? "Ingesting..." : "Upload"}
          </button>
        </form>
        {message && <div style={{ marginTop: 8, fontSize: 12, color: C.textDim }}>{message}</div>}
        <div style={{ marginTop: 10, color: C.textFaint, fontSize: 11 }}>
          Recent uploads: {statements.length}. Latest: {statements[0]?.fileName ?? "none"}.
        </div>
      </div>

      <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontFamily: C.mono, color: C.gold, fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8 }}>
          Advisor Feedback Memory
        </div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Tell the advisor what you agreed/disagreed with, risk comfort changes, tax preferences, or spending constraints."
          style={{ width: "100%", minHeight: 90, background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: 10 }}
        />
        <div style={{ marginTop: 8 }}>
          <button onClick={saveFeedback} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.gold}40`, background: C.surface, color: C.gold, fontFamily: C.mono, fontSize: 11 }}>
            Save feedback to memory
          </button>
        </div>
      </div>
    </div>
  );
}
