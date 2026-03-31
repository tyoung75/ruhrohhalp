"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";
import { buildFingerprint, isSignalDismissed } from "@/lib/signal-fingerprint";

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

/** Simple inline markdown → React: handles **bold**, *italic*, `code`, and TYOS-XXX refs */
function renderMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|TYOS-\d+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} style={{ color: C.cream, fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i} style={{ color: C.textDim }}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} style={{ fontFamily: C.mono, fontSize: "0.9em", background: `${C.surface}`, padding: "1px 4px", borderRadius: 3 }}>
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^TYOS-\d+$/.test(part)) {
      return <span key={i} style={{ fontFamily: C.mono, color: C.cl, fontWeight: 500 }}>{part}</span>;
    }
    return part;
  });
}

export function BriefingView() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [allBriefings, setAllBriefings] = useState<Briefing[]>([]);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [feedbackGiven, setFeedbackGiven] = useState<Set<string>>(new Set());
  const [dismissedFingerprints, setDismissedFingerprints] = useState<Set<string>>(new Set());
  const [replyOpenItemId, setReplyOpenItemId] = useState<string | null>(null);
  const [actionTaken, setActionTaken] = useState<Map<string, string>>(new Map());
  const [dismissedItemIds, setDismissedItemIds] = useState<Set<string>>(new Set());
  const [replyText, setReplyText] = useState<string>("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyHistory, setReplyHistory] = useState<Array<{ reply: string; created_at: string }>>([]);

  // Load dismissed fingerprints
  const loadDismissedFingerprints = useCallback(async () => {
    try {
      const data = await api<{ dismissals: Array<{ fingerprint: string; original_text: string }> }>("/api/signals/dismiss");
      const fingerprints = new Set(data.dismissals?.map((d) => d.fingerprint) ?? []);
      setDismissedFingerprints(fingerprints);
    } catch (e) {
      console.error("Failed to load dismissed fingerprints:", e);
    }
  }, []);

  // Load the latest persisted briefing on mount
  const loadBriefing = useCallback(async () => {
    try {
      const data = await api<{ briefing: Briefing | null; briefings?: Briefing[] }>("/api/briefings");
      const briefings = data.briefings ?? (data.briefing ? [data.briefing] : []);
      setAllBriefings(briefings);

      if (data.briefing && data.briefing.content_json) {
        setBriefing(data.briefing);
        setActivePeriod(data.briefing.period ?? null);
        const titles = data.briefing.content_json.map((s) => s.title);
        setExpandedSections(new Set(titles));
      }
    } catch (e) {
      console.error("Failed to load briefing:", e);
    }
  }, []);

  useEffect(() => {
    loadDismissedFingerprints();
    loadBriefing().finally(() => setLoading(false));
  }, [loadBriefing, loadDismissedFingerprints]);

  // Listen for briefing refresh events
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
      // Use AbortController with 60s timeout for long-running RAG query
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const res = await fetch("/api/briefing/daily", {
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
      });
      clearTimeout(timeout);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? `Briefing generation failed (${res.status})`);
      }

      if (data.briefing) {
        setBriefing(data.briefing);
        const titles = data.briefing.content_json?.map((s: BriefingSection) => s.title) ?? [];
        setExpandedSections(new Set(titles));
      } else {
        setError("Briefing generated but returned empty. Check that OPENAI_API_KEY and ANTHROPIC_API_KEY are set in Vercel env vars.");
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Briefing generation timed out (>60s). The RAG query may need optimization, or check Vercel function timeout settings.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to generate briefing");
      }
    } finally {
      setGenerating(false);
    }
  }

  async function handleFeedback(itemId: string | undefined, helpful: boolean, sectionTitle: string, itemText: string) {
    if (!itemId) return;
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          section: sectionTitle,
          action: helpful ? "helpful" : "not_helpful",
          note: itemText,
          briefing_id: briefing?.id,
        }),
      });
      setFeedbackGiven((prev) => new Set([...prev, `${itemId}-${helpful}`]));
    } catch (e) {
      console.error("Feedback error:", e);
    }
  }

  async function handleDismissItem(itemText: string) {
    try {
      await api("/api/signals/dismiss", {
        method: "POST",
        body: JSON.stringify({
          text: itemText,
          category: "briefing",
          source: "briefing",
        }),
      });
      const fingerprint = buildFingerprint(itemText);
      setDismissedFingerprints((prev) => new Set([...prev, fingerprint]));
      setDismissedItemIds((prev) => new Set([...prev, itemText]));
    } catch (e) {
      console.error("Dismiss error:", e);
    }
  }

  async function handleReplyOpen(itemId: string, itemText: string) {
    if (replyOpenItemId === itemId) {
      setReplyOpenItemId(null);
      return;
    }
    setReplyOpenItemId(itemId);
    setReplyText("");
    setReplyHistory([]);

    // Load reply history by fingerprint
    try {
      const fingerprint = buildFingerprint(itemText);
      const data = await api<{ replies: Array<{ reply: string; created_at: string }> }>(
        `/api/signals/reply?fingerprint=${encodeURIComponent(fingerprint)}`
      );
      setReplyHistory(data.replies ?? []);
    } catch (e) {
      console.error("Failed to load reply history:", e);
    }
  }

  async function handleSubmitReply(itemText: string) {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    try {
      const reply = replyText.trim();
      await api("/api/signals/reply", {
        method: "POST",
        body: JSON.stringify({
          signal_text: itemText,
          reply,
          scope: "specific",
        }),
      });
      setReplyText("");
      setReplyHistory((prev) => [...prev, { reply, created_at: new Date().toISOString() }]);
    } catch (e) {
      console.error("Reply error:", e);
    } finally {
      setReplyLoading(false);
    }
  }

  async function handleActionTaken(itemId: string, itemText: string, sectionTitle: string, action: "already_done" | "wont_do") {
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          section: sectionTitle,
          action,
          note: itemText,
          briefing_id: briefing?.id,
        }),
      });
      setActionTaken((prev) => new Map([...prev, [itemId, action]]));
    } catch (e) {
      console.error("Action error:", e);
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

  // --- Interactive adjustment input ---
  const [adjustInput, setAdjustInput] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustResult, setAdjustResult] = useState<string | null>(null);
  const adjustRef = useRef<HTMLTextAreaElement | null>(null);

  async function handleAdjust() {
    if (!adjustInput.trim() || adjusting) return;
    const input = adjustInput.trim();
    setAdjustInput("");
    setAdjusting(true);
    setAdjustResult(null);

    try {
      // 1. Store the context as a high-importance memory
      // Fetch existing brain dump first to preserve goals and weekly context
      let existingGoals: { pillar: string; text: string }[] = [];
      let existingWeeklyContext = "";
      try {
        const existing = await api<{
          dump: { goals: string; weekly_context: string } | null;
          pinnedGoals: { pillar: string; text: string }[] | null;
        }>("/api/brain/dump");
        if (existing.pinnedGoals && existing.pinnedGoals.length > 0) {
          existingGoals = existing.pinnedGoals;
        }
        if (existing.dump?.weekly_context) {
          existingWeeklyContext = existing.dump.weekly_context;
        }
      } catch {
        // Continue with empty defaults if fetch fails
      }

      await api("/api/brain/dump", {
        method: "POST",
        body: JSON.stringify({
          goals: existingGoals,
          weeklyContext: existingWeeklyContext,
          topOfMind: input,
        }),
      });

      // 2. Re-generate the briefing so it incorporates the new context
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const res = await fetch("/api/briefing/daily", {
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
      });
      clearTimeout(timeout);
      const data = await res.json();

      if (res.ok && data.briefing) {
        setBriefing(data.briefing);
        const titles = data.briefing.content_json?.map((s: BriefingSection) => s.title) ?? [];
        setExpandedSections(new Set(titles));
        setAdjustResult("Got it — briefing updated with your context.");
        window.dispatchEvent(new CustomEvent("briefing:refresh"));
      } else {
        setAdjustResult("Saved to memory, but briefing regeneration failed. Try generating manually.");
      }
    } catch {
      setAdjustResult("Context saved to memory. Briefing will reflect it on next generation.");
    } finally {
      setAdjusting(false);
      setTimeout(() => setAdjustResult(null), 5000);
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

  function switchPeriod(period: string) {
    const target = allBriefings.find((b) => b.period === period);
    if (target) {
      setBriefing(target);
      setActivePeriod(period);
      const titles = target.content_json?.map((s) => s.title) ?? [];
      setExpandedSections(new Set(titles));
    }
  }

  const periodLabel = activePeriod === "morning" ? "Morning" : activePeriod === "evening" ? "Evening" : activePeriod === "weekly" ? "Weekly" : "";
  const availablePeriods = allBriefings
    .map((b) => b.period)
    .filter((p): p is string => !!p && p !== "weekly");

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
            {periodLabel ? `${periodLabel} Briefing` : "Briefing"}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            {lastUpdated && (
              <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>
                Updated {lastUpdated}
              </span>
            )}
            {availablePeriods.length > 1 && (
              <div style={{ display: "flex", gap: 4 }}>
                {availablePeriods.map((p) => (
                  <button
                    key={p}
                    onClick={() => switchPeriod(p)}
                    style={{
                      padding: "1px 6px",
                      borderRadius: 4,
                      border: `1px solid ${activePeriod === p ? C.cl : C.border}`,
                      background: activePeriod === p ? `${C.cl}20` : "transparent",
                      color: activePeriod === p ? C.cl : C.textFaint,
                      fontFamily: C.mono,
                      fontSize: 9,
                      cursor: "pointer",
                    }}
                  >
                    {p === "morning" ? "AM" : p === "evening" ? "PM" : p}
                  </button>
                ))}
              </div>
            )}
          </div>
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
            lineHeight: 1.5,
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
            generate automatically at 6 AM / 8 PM ET.
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
            // Filter out dismissed items
            const visibleItems = section.items.filter(
              (item) => !isSignalDismissed(item.text, dismissedFingerprints) && !dismissedItemIds.has(item.text)
            );
            const hiddenCount = section.items.length - visibleItems.length;

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
                    {visibleItems.length}
                  </span>
                  {hiddenCount > 0 && (
                    <span
                      style={{
                        fontFamily: C.mono,
                        fontSize: 8,
                        color: C.textFaint,
                      }}
                    >
                      ({hiddenCount} hidden)
                    </span>
                  )}
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
                    {visibleItems.map((item, i) => {
                      const itemAction = actionTaken.get(item.id || "");
                      const isStrikethrough = itemAction === "already_done";
                      const isDimmed = itemAction === "wont_do";
                      return (
                        <div
                          key={i}
                          style={{
                            padding: "8px 12px",
                            borderBottom: i < visibleItems.length - 1 ? `1px solid ${C.border}22` : "none",
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            opacity: isDimmed ? 0.6 : 1,
                          }}
                        >
                          {/* Item text */}
                          <div
                            style={{
                              fontSize: 12,
                              fontFamily: C.sans,
                              color: C.text,
                              lineHeight: 1.6,
                              textDecoration: isStrikethrough ? "line-through" : "none",
                            }}
                          >
                            {renderMarkdown(item.text)}
                          </div>

                          {/* Action buttons */}
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            {/* Feedback buttons */}
                            <button
                              onClick={() => handleFeedback(item.id, true, section.title, item.text)}
                              disabled={feedbackGiven.has(`${item.id}-true`)}
                              title="Helpful"
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
                              onClick={() => handleFeedback(item.id, false, section.title, item.text)}
                              disabled={feedbackGiven.has(`${item.id}-false`)}
                              title="Not helpful"
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

                            {/* Dismiss button */}
                            <button
                              onClick={() => handleDismissItem(item.text)}
                              title="Dismiss this item"
                              style={{
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "transparent",
                                border: `1px solid ${C.border}`,
                                color: C.textDim,
                                fontFamily: C.mono,
                                fontSize: 9,
                                cursor: "pointer",
                              }}
                            >
                              ✕
                            </button>

                            {/* Already Done button */}
                            <button
                              onClick={() => handleActionTaken(item.id || "", item.text, section.title, "already_done")}
                              disabled={itemAction === "already_done"}
                              title="Mark as already done"
                              style={{
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: itemAction === "already_done" ? `${C.gpt}20` : "transparent",
                                border: `1px solid ${itemAction === "already_done" ? C.gpt : C.border}`,
                                color: itemAction === "already_done" ? C.gpt : C.textDim,
                                fontFamily: C.mono,
                                fontSize: 9,
                                cursor: itemAction === "already_done" ? "default" : "pointer",
                              }}
                            >
                              ✓ Done
                            </button>

                            {/* Won't Do button */}
                            <button
                              onClick={() => handleActionTaken(item.id || "", item.text, section.title, "wont_do")}
                              disabled={itemAction === "wont_do"}
                              title="Mark as won't do"
                              style={{
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: itemAction === "wont_do" ? `${C.reminder}20` : "transparent",
                                border: `1px solid ${itemAction === "wont_do" ? C.reminder : C.border}`,
                                color: itemAction === "wont_do" ? C.reminder : C.textDim,
                                fontFamily: C.mono,
                                fontSize: 9,
                                cursor: itemAction === "wont_do" ? "default" : "pointer",
                              }}
                            >
                              ✗ Skip
                            </button>

                            {/* Reply button */}
                            <button
                              onClick={() => handleReplyOpen(item.id || "", item.text)}
                              title="Reply to this item"
                              style={{
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: replyOpenItemId === (item.id || "") ? `${C.cl}20` : "transparent",
                                border: `1px solid ${replyOpenItemId === (item.id || "") ? C.cl : C.border}`,
                                color: replyOpenItemId === (item.id || "") ? C.cl : C.textDim,
                                fontFamily: C.mono,
                                fontSize: 9,
                                cursor: "pointer",
                              }}
                            >
                              💬 Reply
                            </button>

                            {/* Type-specific buttons */}
                            {item.type === "triage" && (
                              <button
                                onClick={() => handleApproveTriage(item.id, item.text)}
                                title="Approve and create task"
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
                            )}

                            {item.type === "recommendation" && (
                              <button
                                onClick={() => handleDraftContent(item.id)}
                                title="Draft this content"
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

                          {/* Reply panel */}
                          {replyOpenItemId === (item.id || "") && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4, padding: "8px", background: `${C.surface}50`, borderRadius: 4 }}>
                              {replyHistory.length > 0 && (
                                <div style={{ fontSize: 10, color: C.textFaint }}>
                                  <div style={{ fontFamily: C.mono, marginBottom: 4, color: C.textDim }}>Recent replies:</div>
                                  {replyHistory.map((r, idx) => (
                                    <div key={idx} style={{ fontFamily: C.mono, fontSize: 9, marginBottom: 2 }}>
                                      • {r.reply}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div style={{ display: "flex", gap: 4 }}>
                                <textarea
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  placeholder="Your reply..."
                                  rows={2}
                                  style={{
                                    flex: 1,
                                    background: C.card,
                                    border: `1px solid ${C.border}`,
                                    borderRadius: 4,
                                    padding: "4px 6px",
                                    fontFamily: C.mono,
                                    fontSize: 9,
                                    color: C.text,
                                    outline: "none",
                                    resize: "none",
                                  }}
                                />
                                <button
                                  onClick={() => handleSubmitReply(item.text)}
                                  disabled={!replyText.trim() || replyLoading}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: 4,
                                    background: replyText.trim() && !replyLoading ? C.cl : C.border,
                                    color: replyText.trim() && !replyLoading ? C.bg : C.textFaint,
                                    border: "none",
                                    fontFamily: C.mono,
                                    fontSize: 9,
                                    cursor: replyText.trim() && !replyLoading ? "pointer" : "default",
                                    whiteSpace: "nowrap",
                                    height: "fit-content",
                                  }}
                                >
                                  {replyLoading ? "..." : "Send"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Interactive adjustment input */}
      <div
        style={{
          marginTop: "auto",
          paddingTop: 16,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        {adjustResult && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              background: `${C.gpt}14`,
              border: `1px solid ${C.gpt}28`,
              color: C.gpt,
              fontFamily: C.mono,
              fontSize: 10,
              marginBottom: 10,
            }}
          >
            {adjustResult}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            ref={adjustRef}
            value={adjustInput}
            onChange={(e) => setAdjustInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAdjust();
              }
            }}
            placeholder="Tell the briefing something... context, corrections, preferences. It'll remember and adapt."
            rows={2}
            style={{
              flex: 1,
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "8px 12px",
              fontFamily: C.mono,
              fontSize: 11,
              color: C.text,
              outline: "none",
              resize: "none",
              lineHeight: 1.5,
            }}
            disabled={adjusting}
          />
          <button
            onClick={handleAdjust}
            disabled={!adjustInput.trim() || adjusting}
            style={{
              padding: "8px 14px",
              background: adjustInput.trim() && !adjusting ? C.cl : C.border,
              color: adjustInput.trim() && !adjusting ? C.bg : C.textFaint,
              border: "none",
              borderRadius: 6,
              fontFamily: C.mono,
              fontSize: 11,
              fontWeight: 600,
              cursor: adjustInput.trim() && !adjusting ? "pointer" : "default",
              whiteSpace: "nowrap",
              height: "fit-content",
            }}
          >
            {adjusting ? <Spinner color={C.textFaint} size={10} /> : "Update"}
          </button>
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginTop: 4 }}>
          Enter to send. This gets stored as context and regenerates your briefing.
        </div>
      </div>
    </div>
  );
}
