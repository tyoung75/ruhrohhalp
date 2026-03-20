"use client";

import { useEffect, useState, useCallback } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";

interface BriefingSection {
  title: string;
  icon: string;
  color: string;
  items: Array<{
    id?: string;
    text: string;
    type?: "triage" | "recommendation" | "insight";
  }>;
}

interface Briefing {
  id: string;
  content_json: BriefingSection[];
  content_md?: string;
  date?: string;
  period?: string;
  created_at: string;
  updated_at: string;
}

export function BriefingView() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [feedbackGiven, setFeedbackGiven] = useState<Set<string>>(new Set());

  // Load the latest persisted briefing on mount
  const loadBriefing = useCallback(async () => {
    try {
      const data = await api<{ briefing: Briefing | null }>("/api/briefings");
      if (data.briefing && data.briefing.content_json) {
        setBriefing(data.briefing);
        // Expand all sections by default so you see everything
        const titles = data.briefing.content_json.map((s) => s.title);
        setExpandedSections(new Set(titles));
      }
    } catch (e) {
      console.error("Failed to load briefing:", e);
    }
  }, []);

  useEffect(() => {
    loadBriefing().finally(() => setLoading(false));
  }, [loadBriefing]);

  // Listen for briefing refresh events (fired by command bar, task actions, etc.)
  useEffect(() => {
    function handleRefresh() {
      loadBriefing();
    }
    window.addEventListener("briefing:refresh", handleRefresh);
    return () => window.removeEventListener("briefing:refresh", handleRefresh);
  }, [loadBriefing]);

  async function generateBriefing() {
    setGenerating(true);
    setError("");
    try {
      const data = await api<{ briefing: Briefing }>("/api/briefing/daily");
      if (data.briefing) {
        setBriefing(data.briefing);
        const titles = data.briefing.content_json.map((s) => s.title);
        setExpandedSections(new Set(titles));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate briefing");
    } finally {
      setGenerating(false);
    }
  }

  async function handleFeedback(itemId: string | undefined, helpful: boolean) {
    if (!itemId) return;
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          item_id: itemId,
          helpful,
          briefing_id: briefing?.id,
        }),
      });
      setFeedbackGiven((prev) => new Set([...prev, `${itemId}-${helpful}`]));
    } catch (e) {
      console.error("Feedback error:", e);
    }
  }

  async function handleApproveTriage(itemId: string | undefined, text: string) {
    if (!itemId) return;
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: text,
          source: "triage",
          state: "unstarted",
          priority_num: 2,
        }),
      });
      // Notify task rail to refresh
      window.dispatchEvent(new CustomEvent("tasks:refresh"));
    } catch (e) {
      console.error("Triage error:", e);
    }
  }

  async function handleDraftContent(itemId: string | undefined) {
    if (!itemId) return;
    try {
      await api("/api/dispatch", {
        method: "POST",
        body: JSON.stringify({ agent_type: "content", source_id: itemId }),
      });
    } catch (e) {
      console.error("Draft error:", e);
    }
  }

  function toggleSection(title: string) {
    const next = new Set(expandedSections);
    if (next.has(title)) {
      next.delete(title);
    } else {
      next.add(title);
    }
    setExpandedSections(next);
  }

  const lastUpdated = briefing?.updated_at
    ? new Date(briefing.updated_at).toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
        <div>
          <h2
            style={{
              fontFamily: C.serif,
              fontStyle: "italic",
              fontSize: 18,
              color: C.cream,
              margin: 0,
              fontWeight: 400,
            }}
          >
            Briefing
          </h2>
          {lastUpdated && (
            <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginTop: 4 }}>
              Updated {lastUpdated}
            </div>
          )}
        </div>
        <button
          onClick={() => generateBriefing()}
          disabled={generating}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 6,
            border: `1px solid ${generating ? C.border : C.cl}`,
            background: generating ? C.card : C.surface,
            color: generating ? C.textDim : C.cl,
            fontFamily: C.mono,
            fontSize: 10,
            cursor: generating ? "default" : "pointer",
          }}
        >
          {generating ? (
            <>
              <Spinner color={C.cl} size={10} /> Generating…
            </>
          ) : (
            "⟳ Generate Briefing"
          )}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            background: `${C.reminder}14`,
            border: `1px solid ${C.reminder}28`,
            color: C.reminder,
            fontFamily: C.mono,
            fontSize: 10,
          }}
        >
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !briefing && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: C.textFaint }}>
          <Spinner color={C.cl} size={16} />
          <div style={{ fontFamily: C.mono, fontSize: 10, marginTop: 8 }}>Loading briefing…</div>
        </div>
      )}

      {/* Empty state */}
      {!briefing && !loading && !error && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: C.textFaint }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>◈</div>
          <div style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 14, color: C.textDim, marginBottom: 6 }}>
            No briefing loaded
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginBottom: 16 }}>
            Click &quot;Generate Briefing&quot; above, or your next briefing will
            generate automatically at 6 AM ET via the daily cron.
          </div>
          <button
            onClick={() => generateBriefing()}
            disabled={generating}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              background: C.cl,
              color: C.bg,
              border: "none",
              fontFamily: C.mono,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Generate Now
          </button>
        </div>
      )}

      {/* Briefing sections */}
      {briefing && briefing.content_json && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflow: "auto" }}>
          {briefing.content_json.map((section, idx) => {
            const isExpanded = expandedSections.has(section.title);
            return (
              <div
                key={idx}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                {/* Section header */}
                <button
                  onClick={() => toggleSection(section.title)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    background: `${section.color}08`,
                    borderBottom: isExpanded ? `1px solid ${C.border}` : "none",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ color: section.color, fontSize: 12 }}>{section.icon}</span>
                  <span
                    style={{
                      fontFamily: C.serif,
                      fontStyle: "italic",
                      fontSize: 12,
                      color: C.cream,
                      flex: 1,
                    }}
                  >
                    {section.title}
                  </span>
                  <span
                    style={{
                      fontFamily: C.mono,
                      fontSize: 9,
                      color: C.textFaint,
                      background: `${section.color}20`,
                      borderRadius: 8,
                      padding: "1px 6px",
                      minWidth: 16,
                      textAlign: "center",
                    }}
                  >
                    {section.items.length}
                  </span>
                  <span
                    style={{
                      fontFamily: C.mono,
                      fontSize: 9,
                      color: C.textFaint,
                      transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                      transition: "transform 0.2s",
                    }}
                  >
                    ▼
                  </span>
                </button>

                {/* Section content */}
                {isExpanded && (
                  <div style={{ padding: "8px 0" }}>
                    {section.items.map((item, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "8px 12px",
                          borderBottom: i < section.items.length - 1 ? `1px solid ${C.border}22` : "none",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        {/* Item text */}
                        <div
                          style={{
                            fontSize: 11,
                            fontFamily: C.sans,
                            color: C.text,
                            lineHeight: 1.5,
                          }}
                        >
                          {item.text}
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <button
                            onClick={() => handleFeedback(item.id, true)}
                            disabled={feedbackGiven.has(`${item.id}-true`)}
                            style={{
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: feedbackGiven.has(`${item.id}-true`) ? `${C.gpt}20` : "transparent",
                              border: `1px solid ${feedbackGiven.has(`${item.id}-true`) ? C.gpt : C.border}`,
                              color: feedbackGiven.has(`${item.id}-true`) ? C.gpt : C.textDim,
                              fontFamily: C.mono,
                              fontSize: 9,
                              cursor: feedbackGiven.has(`${item.id}-true`) ? "default" : "pointer",
                            }}
                          >
                            👍
                          </button>
                          <button
                            onClick={() => handleFeedback(item.id, false)}
                            disabled={feedbackGiven.has(`${item.id}-false`)}
                            style={{
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: feedbackGiven.has(`${item.id}-false`) ? `${C.reminder}20` : "transparent",
                              border: `1px solid ${feedbackGiven.has(`${item.id}-false`) ? C.reminder : C.border}`,
                              color: feedbackGiven.has(`${item.id}-false`) ? C.reminder : C.textDim,
                              fontFamily: C.mono,
                              fontSize: 9,
                              cursor: feedbackGiven.has(`${item.id}-false`) ? "default" : "pointer",
                            }}
                          >
                            👎
                          </button>

                          {item.type === "triage" && (
                            <>
                              <button
                                onClick={() => handleApproveTriage(item.id, item.text)}
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: `${C.todo}14`,
                                  border: `1px solid ${C.todo}35`,
                                  color: C.todo,
                                  fontFamily: C.mono,
                                  fontSize: 9,
                                  cursor: "pointer",
                                }}
                              >
                                ✓ Approve
                              </button>
                              <button
                                style={{
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: `${C.reminder}14`,
                                  border: `1px solid ${C.reminder}35`,
                                  color: C.reminder,
                                  fontFamily: C.mono,
                                  fontSize: 9,
                                  cursor: "pointer",
                                }}
                              >
                                ✕ Dismiss
                              </button>
                            </>
                          )}

                          {item.type === "recommendation" && (
                            <button
                              onClick={() => handleDraftContent(item.id)}
                              style={{
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: `${C.gem}14`,
                                border: `1px solid ${C.gem}35`,
                                color: C.gem,
                                fontFamily: C.mono,
                                fontSize: 9,
                                cursor: "pointer",
                              }}
                            >
                              ✎ Draft This
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
