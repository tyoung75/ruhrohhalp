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

// Shared compact button style helper
const compactBtn = (active: boolean, activeColor: string) => ({
  padding: "2px 6px",
  borderRadius: 4,
  background: active ? `${activeColor}20` : "transparent",
  border: `1px solid ${active ? activeColor : C.border}`,
  color: active ? activeColor : C.textDim,
  fontFamily: C.mono,
  fontSize: 9,
  cursor: active ? ("default" as const) : ("pointer" as const),
});

export function BriefingView() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [allBriefings, setAllBriefings] = useState<Briefing[]>([]);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [feedbackGiven, setFeedbackGiven] = useState<Set<string>>(new Set());
  // Feedback system state
  const [dismissedFingerprints, setDismissedFingerprints] = useState<Set<string>>(new Set());
  const [dismissedItemIds, setDismissedItemIds] = useState<Set<string>>(new Set());
  const [actionTaken, setActionTaken] = useState<Map<string, string>>(new Map());
  const [actionPending, setActionPending] = useState<Set<string>>(new Set());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [replyOpenItemKey, setReplyOpenItemKey] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyHistory, setReplyHistory] = useState<Array<{ reply: string; created_at: string }>>([]);

  // Load dismissed fingerprints on mount
  const loadDismissedFingerprints = useCallback(async () => {
    try {
      const data = await api<{ dismissals: Array<{ fingerprint: string; original_text: string }> }>("/api/signals/dismiss");
      const fps = new Set(data.dismissals?.map((d) => d.fingerprint) ?? []);
      setDismissedFingerprints(fps);
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

  // Show a toast notification
  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  }

  // Fixed: sends correct payload matching /api/feedback POST schema
  async function handleFeedback(itemId: string | undefined, helpful: boolean, sectionTitle: string, itemText: string) {
    if (!itemId) return;
    // Optimistic update
    setFeedbackGiven((prev) => new Set([...prev, `${itemId}-${helpful}`]));
    showToast(helpful ? "Marked as helpful" : "Marked as not helpful");
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          section: sectionTitle,
          action: helpful ? "thumbs_up" : "thumbs_down",
          note: itemText,
          briefing_id: briefing?.id,
        }),
      });
    } catch (e) {
      console.error("Feedback error:", e);
      // Revert on failure
      setFeedbackGiven((prev) => { const next = new Set(prev); next.delete(`${itemId}-${helpful}`); return next; });
      showToast("Failed to save feedback");
    }
  }

  // Persistent dismiss via signal fingerprint — optimistic
  async function handleDismissItem(itemText: string) {
    // Optimistic: hide immediately
    const fp = buildFingerprint(itemText);
    setDismissedFingerprints((prev) => new Set([...prev, fp]));
    setDismissedItemIds((prev) => new Set([...prev, itemText]));
    showToast("Dismissed — won't show again");
    try {
      await api("/api/signals/dismiss", {
        method: "POST",
        body: JSON.stringify({
          text: itemText,
          category: "briefing",
          source: "briefing",
        }),
      });
    } catch (e) {
      console.error("Dismiss error:", e);
      // Revert on failure
      setDismissedFingerprints((prev) => { const next = new Set(prev); next.delete(fp); return next; });
      setDismissedItemIds((prev) => { const next = new Set(prev); next.delete(itemText); return next; });
      showToast("Dismiss failed — item restored");
    }
  }

  // Mark as already done or won't do — optimistic, stores via signal reply + dismiss APIs
  // (avoids the feedback table's CHECK constraint on action values)
  async function handleActionTaken(itemId: string, itemText: string, _sectionTitle: string, action: "already_done" | "wont_do") {
    // Optimistic update — show feedback immediately
    const fp = buildFingerprint(itemText);
    setActionTaken((prev) => new Map([...prev, [itemId, action]]));
    setActionPending((prev) => new Set([...prev, itemId]));
    showToast(action === "already_done" ? "Marked as done" : "Skipped — won't suggest again");

    try {
      const replyMsg = action === "already_done"
        ? "ALREADY DONE — I completed this. Do not suggest again."
        : "WON'T DO — skipping this. Do not suggest again.";

      // 1. Save as a signal reply so the AI learns
      await api("/api/signals/reply", {
        method: "POST",
        body: JSON.stringify({
          signal_text: itemText,
          reply: replyMsg,
          scope: "specific",
        }),
      });

      // 2. Dismiss so it doesn't resurface
      await api("/api/signals/dismiss", {
        method: "POST",
        body: JSON.stringify({
          text: itemText,
          category: "briefing",
          source: action === "already_done" ? "done" : "wont_do",
        }),
      });

      setDismissedFingerprints((prev) => new Set([...prev, fp]));
    } catch (e) {
      console.error("Action error:", e);
      // Revert on failure
      setActionTaken((prev) => { const next = new Map(prev); next.delete(itemId); return next; });
      showToast("Action failed — please try again");
    } finally {
      setActionPending((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
    }
  }

  // Toggle inline reply panel + load history
  async function handleReplyOpen(itemKey: string, itemText: string) {
    if (replyOpenItemKey === itemKey) {
      setReplyOpenItemKey(null);
      return;
    }
    setReplyOpenItemKey(itemKey);
    setReplyText("");
    setReplyHistory([]);
    try {
      const fp = buildFingerprint(itemText);
      const data = await api<{ replies: Array<{ reply: string; created_at: string }> }>(
        `/api/signals/reply?fingerprint=${encodeURIComponent(fp)}`
      );
      setReplyHistory(data.replies ?? []);
    } catch (e) {
      console.error("Failed to load reply history:", e);
    }
  }

  // Submit reply — optimistic
  async function handleSubmitReply(itemText: string) {
    if (!replyText.trim()) return;
    const text = replyText.trim();
    setReplyLoading(true);
    // Optimistic: show reply in history immediately
    setReplyText("");
    setReplyHistory((prev) => [{ reply: text, created_at: new Date().toISOString() }, ...prev]);
    showToast("Reply saved");
    try {
      await api("/api/signals/reply", {
        method: "POST",
        body: JSON.stringify({
          signal_text: itemText,
          reply: text,
          scope: "specific",
        }),
      });
    } catch (e) {
      console.error("Reply error:", e);
      // Revert on failure
      setReplyHistory((prev) => prev.filter((r) => r.reply !== text));
      showToast("Reply failed to save");
    } finally {
      setReplyLoading(false);
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 16, position: "relative" }}>
      {/* Toast notification */}
      {toastMsg && (
        <div style={{
          position: "absolute",
          top: 8,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50,
          padding: "6px 14px",
          borderRadius: 6,
          background: C.card,
          border: `1px solid ${C.cl}`,
          color: C.cream,
          fontFamily: C.mono,
          fontSize: 10,
          boxShadow: `0 4px 12px ${C.bg}88`,
          animation: "fadeIn 0.15s ease-out",
          whiteSpace: "nowrap",
        }}>
          {toastMsg}
        </div>
      )}
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottom: `1px solid ${C.border}` }}>
        <div>
          <h2 style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 18, color: C.cream, margin: 0, fontWeight: 400 }}>
            {periodLabel ? `${periodLabel} Briefing` : "Briefing"}
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            {lastUpdated && (
              <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>Updated {lastUpdated}</span>
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
          {generating ? (<><Spinner color={C.cl} size={10} /> Generating…</>) : "⟳ Generate Briefing"}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ padding: "10px 12px", borderRadius: 6, background: `${C.reminder}14`, border: `1px solid ${C.reminder}28`, color: C.reminder, fontFamily: C.mono, fontSize: 10, lineHeight: 1.5 }}>
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
          <div style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 14, color: C.textDim, marginBottom: 6 }}>No briefing loaded</div>
          <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginBottom: 16 }}>
            Click &quot;Generate Briefing&quot; above, or your next briefing will generate automatically at 6 AM / 8 PM ET.
          </div>
          <button
            onClick={() => generateBriefing()}
            disabled={generating}
            style={{ padding: "8px 16px", borderRadius: 6, background: C.cl, color: C.bg, border: "none", fontFamily: C.mono, fontSize: 11, cursor: "pointer" }}
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
            // Filter dismissed items
            const visibleItems = section.items.filter(
              (item) => !isSignalDismissed(item.text, dismissedFingerprints) && !dismissedItemIds.has(item.text)
            );
            const hiddenCount = section.items.length - visibleItems.length;

            return (
              <div key={idx} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
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
                  <span style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 12, color: C.cream, flex: 1 }}>{section.title}</span>
                  <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, background: `${section.color}20`, borderRadius: 8, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>
                    {visibleItems.length}
                  </span>
                  {hiddenCount > 0 && (
                    <span style={{ fontFamily: C.mono, fontSize: 8, color: C.textFaint }}>({hiddenCount} hidden)</span>
                  )}
                  <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>▼</span>
                </button>

                {/* Section content */}
                {isExpanded && (
                  <div style={{ padding: "8px 0" }}>
                    {visibleItems.map((item, i) => {
                      const itemKey = item.id || `${section.title}-${i}`;
                      const itemAction = actionTaken.get(itemKey);
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
                            opacity: isDimmed ? 0.5 : 1,
                          }}
                        >
                          {/* Item text */}
                          <div style={{ fontSize: 12, fontFamily: C.sans, color: C.text, lineHeight: 1.6, textDecoration: isStrikethrough ? "line-through" : "none" }}>
                            {renderMarkdown(item.text)}
                          </div>

                          {/* Action buttons row */}
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            {/* Thumbs up */}
                            <button
                              onClick={() => handleFeedback(item.id, true, section.title, item.text)}
                              disabled={feedbackGiven.has(`${item.id}-true`)}
                              title="Helpful"
                              style={compactBtn(feedbackGiven.has(`${item.id}-true`), C.gpt)}
                            >
                              👍
                            </button>
                            {/* Thumbs down */}
                            <button
                              onClick={() => handleFeedback(item.id, false, section.title, item.text)}
                              disabled={feedbackGiven.has(`${item.id}-false`)}
                              title="Not helpful"
                              style={compactBtn(feedbackGiven.has(`${item.id}-false`), C.reminder)}
                            >
                              👎
                            </button>
                            {/* Dismiss */}
                            <button
                              onClick={() => handleDismissItem(item.text)}
                              title="Dismiss — won't show again"
                              style={compactBtn(false, C.textDim)}
                            >
                              ✕
                            </button>
                            {/* Already Done */}
                            <button
                              onClick={() => handleActionTaken(itemKey, item.text, section.title, "already_done")}
                              disabled={!!itemAction || actionPending.has(itemKey)}
                              title="Already done"
                              style={{
                                ...compactBtn(itemAction === "already_done", C.gpt),
                                ...(itemAction === "already_done" ? { background: C.gpt, color: C.bg, fontWeight: 700, borderColor: C.gpt } : {}),
                                ...(actionPending.has(itemKey) ? { opacity: 0.6 } : {}),
                              }}
                            >
                              {actionPending.has(itemKey) && itemAction === "already_done" ? "Saving…" : "✓ Done"}
                            </button>
                            {/* Won't Do / Skip */}
                            <button
                              onClick={() => handleActionTaken(itemKey, item.text, section.title, "wont_do")}
                              disabled={!!itemAction || actionPending.has(itemKey)}
                              title="Won't do"
                              style={{
                                ...compactBtn(itemAction === "wont_do", C.reminder),
                                ...(itemAction === "wont_do" ? { background: C.reminder, color: C.bg, fontWeight: 700, borderColor: C.reminder } : {}),
                                ...(actionPending.has(itemKey) ? { opacity: 0.6 } : {}),
                              }}
                            >
                              {actionPending.has(itemKey) && itemAction === "wont_do" ? "Saving…" : "✗ Skip"}
                            </button>
                            {/* Reply */}
                            <button
                              onClick={() => handleReplyOpen(itemKey, item.text)}
                              title="Reply with feedback"
                              style={compactBtn(replyOpenItemKey === itemKey, C.cl)}
                            >
                              💬 Reply
                            </button>

                            {/* Type-specific buttons */}
                            {item.type === "triage" && (
                              <button
                                onClick={() => handleApproveTriage(item.id, item.text)}
                                title="Approve and create task"
                                style={{ ...compactBtn(false, C.todo), background: `${C.todo}14`, borderColor: `${C.todo}35`, color: C.todo }}
                              >
                                ✓ Approve
                              </button>
                            )}

                            {item.type === "recommendation" && (
                              <button
                                onClick={() => handleDraftContent(item.id)}
                                title="Draft this content"
                                style={{ ...compactBtn(false, C.gem), background: `${C.gem}14`, borderColor: `${C.gem}35`, color: C.gem }}
                              >
                                ✎ Draft This
                              </button>
                            )}
                          </div>

                          {/* Reply panel */}
                          {replyOpenItemKey === itemKey && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4, padding: 8, background: `${C.surface}50`, borderRadius: 4 }}>
                              {replyHistory.length > 0 && (
                                <div style={{ marginBottom: 4 }}>
                                  <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textDim, marginBottom: 4 }}>Previous replies:</div>
                                  {replyHistory.slice(0, 5).map((r, ri) => (
                                    <div key={ri} style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginBottom: 2 }}>• {r.reply}</div>
                                  ))}
                                </div>
                              )}
                              <div style={{ display: "flex", gap: 4 }}>
                                <textarea
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmitReply(item.text); } }}
                                  placeholder="Your reply... the system will learn from this"
                                  rows={2}
                                  style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 6px", fontFamily: C.mono, fontSize: 9, color: C.text, outline: "none", resize: "none" }}
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
      <div style={{ marginTop: "auto", paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        {adjustResult && (
          <div style={{ padding: "8px 12px", borderRadius: 6, background: `${C.gpt}14`, border: `1px solid ${C.gpt}28`, color: C.gpt, fontFamily: C.mono, fontSize: 10, marginBottom: 10 }}>
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
            style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", fontFamily: C.mono, fontSize: 11, color: C.text, outline: "none", resize: "none", lineHeight: 1.5 }}
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
