"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
  actions?: string[];
}

interface ChatResponse {
  session_id: string;
  message: string;
  title: string;
  actions?: string[];
}

interface FeatureSuggestion {
  title: string;
  description: string;
  prompt: string;
}

const PAGE_LABELS: Record<string, string> = {
  "/": "command-center",
  "/tasks": "tasks",
  "/goals": "goals",
  "/creator": "creator",
  "/brands": "brands",
  "/finance": "finance",
  "/brain": "brain",
  "/settings": "settings",
};

function getPageContext(pathname: string): string {
  for (const [prefix, label] of Object.entries(PAGE_LABELS)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return label;
  }
  return "general";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export function ChiefOfStaff() {
  const pathname = usePathname();
  const pageContext = getPageContext(pathname);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const expandedInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => expandedInputRef.current?.focus(), 120);
  }, [open]);

  // Keyboard shortcuts: Cmd/Ctrl+K or Cmd/Ctrl+J toggles
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "k")) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      // Escape closes
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    const userMsg: ChatMessage = { role: "user", content: text, ts: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await api<ChatResponse>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, session_id: sessionId, page_context: pageContext }),
      });
      setSessionId(res.session_id);
      setMessages((prev) => [...prev, { role: "assistant", content: res.message, ts: new Date().toISOString(), actions: res.actions }]);
      window.dispatchEvent(new CustomEvent("tasks:refresh"));
      window.dispatchEvent(new CustomEvent("brands:refresh"));
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Something went wrong: ${err instanceof Error ? err.message : "Unknown error"}`, ts: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  }

  function newSession() {
    setSessionId(null);
    setMessages([]);
    setInput("");
    setTimeout(() => expandedInputRef.current?.focus(), 50);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const label = file.type.startsWith("image/")
        ? `[Image: ${file.name}]`
        : `[File: ${file.name}]`;
      setInput((prev) => prev ? `${prev} ${label}` : label);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // ── Collapsed bar ──
  if (!open) {
    return (
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 200,
        right: 0,
        zIndex: 80,
        background: `${C.surface}f0`,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: `1px solid ${C.border}`,
        padding: "6px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <button
          onClick={() => setOpen(true)}
          style={{ background: `${C.cl}18`, border: `1px solid ${C.cl}30`, borderRadius: 6, color: C.cl, fontSize: 12, cursor: "pointer", padding: "4px 8px", display: "flex", alignItems: "center", gap: 4 }}
        >
          <span style={{ fontSize: 10 }}>&#9670;</span>
          <span style={{ fontFamily: C.mono, fontSize: 9 }}>CoS</span>
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) {
              e.preventDefault();
              setOpen(true);
              void send();
            }
          }}
          placeholder="Ask anything, create tasks, give feedback, adjust strategy..."
          style={{ flex: 1, background: "transparent", border: "none", color: C.text, fontSize: 13, fontFamily: C.sans, outline: "none" }}
        />
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, background: `${C.card}`, padding: "2px 6px", borderRadius: 4 }}>{pageContext}</span>
          <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, opacity: 0.5 }}>Cmd+K</span>
        </div>
      </div>
    );
  }

  // ── Expanded panel ──
  return (
    <div style={{
      position: "fixed",
      bottom: 0,
      right: 0,
      width: 460,
      maxWidth: "100vw",
      height: "65vh",
      maxHeight: 560,
      zIndex: 90,
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderBottom: "none",
      borderRight: "none",
      borderTopLeftRadius: 16,
      display: "flex",
      flexDirection: "column",
      boxShadow: "-8px -8px 32px #00000040",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: `1px solid ${C.border}`,
        background: C.surface,
        borderTopLeftRadius: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `${C.cl}18`, border: `1px solid ${C.cl}30`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: C.cl, fontSize: 12 }}>&#9670;</span>
          </div>
          <div>
            <div style={{ fontFamily: C.serif, fontStyle: "italic", color: C.cream, fontSize: 14, lineHeight: 1 }}>Chief of Staff</div>
            <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginTop: 2 }}>
              {pageContext} context
              {sessionId && <span> &middot; active session</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={newSession}
            title="New conversation"
            style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", fontFamily: C.mono, fontSize: 10, cursor: "pointer" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.cl; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
          >
            + New
          </button>
          <button
            onClick={() => setOpen(false)}
            title="Minimize (Esc)"
            style={{ background: C.card, color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", fontSize: 14, cursor: "pointer", lineHeight: 1 }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.cl; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
          >
            &#8722;
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", marginTop: 48, padding: "0 20px" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `${C.cl}12`, border: `1px solid ${C.cl}20`, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <span style={{ color: C.cl, fontSize: 20 }}>&#9670;</span>
            </div>
            <div style={{ fontFamily: C.serif, fontStyle: "italic", color: C.cream, fontSize: 16, marginBottom: 6 }}>Chief of Staff</div>
            <div style={{ color: C.textDim, fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
              Your EA, financial advisor, content strategist,<br />brand manager, career coach, and editor.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
              {[
                "What should I focus on today?",
                "Draft outreach to Hyperice",
                "How's my brand pipeline looking?",
                "Create a task to review DexaFit results",
              ].map((hint) => (
                <button
                  key={hint}
                  onClick={() => { setInput(hint); setTimeout(() => expandedInputRef.current?.focus(), 50); }}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "6px 12px",
                    fontSize: 11,
                    color: C.textDim,
                    cursor: "pointer",
                    fontFamily: C.sans,
                    textAlign: "left",
                    transition: "border-color 0.15s, color 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${C.cl}40`; (e.currentTarget as HTMLElement).style.color = C.text; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.color = C.textDim; }}
                >
                  {hint}
                </button>
              ))}
            </div>
            <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginTop: 16 }}>
              Every conversation compounds into the brain.
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          // Parse feature suggestions from assistant messages
          let displayContent = msg.content;
          let featureSuggestion: FeatureSuggestion | null = null;
          if (msg.role === "assistant" && msg.content.includes("[FEATURE_SUGGESTION]")) {
            const match = msg.content.match(/\[FEATURE_SUGGESTION\](.*?)\[\/FEATURE_SUGGESTION\]/s);
            if (match) {
              try { featureSuggestion = JSON.parse(match[1]); } catch { /* ignore */ }
              displayContent = msg.content.replace(/\[FEATURE_SUGGESTION\].*?\[\/FEATURE_SUGGESTION\]/s, "").trim();
            }
          }

          return (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start", gap: 3 }}>
            <div style={{
              maxWidth: "88%",
              background: msg.role === "user" ? `${C.cl}10` : C.surface,
              border: `1px solid ${msg.role === "user" ? `${C.cl}25` : C.border}`,
              borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              padding: "10px 14px",
              fontSize: 13,
              lineHeight: 1.65,
              color: C.text,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {displayContent}

              {/* Actions taken */}
              {msg.actions && msg.actions.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: C.mono, fontSize: 9, color: C.gpt, textTransform: "uppercase", marginBottom: 4 }}>Actions taken</div>
                  {msg.actions.map((a, j) => (
                    <div key={j} style={{ fontSize: 11, color: C.textDim, paddingLeft: 8, borderLeft: `2px solid ${C.gpt}30`, marginBottom: 2 }}>{a}</div>
                  ))}
                </div>
              )}

              {/* Feature suggestion */}
              {featureSuggestion && (
                <div style={{ marginTop: 10, padding: 10, background: `${C.gem}08`, border: `1px solid ${C.gem}25`, borderRadius: 8 }}>
                  <div style={{ fontFamily: C.mono, fontSize: 9, color: C.gem, textTransform: "uppercase", marginBottom: 6 }}>Feature Idea: {featureSuggestion.title}</div>
                  <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8, lineHeight: 1.5 }}>{featureSuggestion.description}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[
                      { label: "Codex", icon: "C", color: "#10B981" },
                      { label: "Claude Code", icon: "CC", color: C.cl },
                      { label: "ChatGPT", icon: "G", color: C.gpt },
                    ].map((target) => (
                      <button
                        key={target.label}
                        onClick={() => {
                          const prompt = `# Feature: ${featureSuggestion!.title}\n\n${featureSuggestion!.description}\n\n## Implementation Prompt\n\n${featureSuggestion!.prompt}`;
                          navigator.clipboard.writeText(prompt);
                          const el = document.createElement("div");
                          el.textContent = `Copied for ${target.label}!`;
                          el.style.cssText = `position:fixed;top:16px;right:16px;z-index:999;padding:8px 16px;background:${target.color};color:#fff;border-radius:8px;font-size:12px;font-family:${C.mono}`;
                          document.body.appendChild(el);
                          setTimeout(() => el.remove(), 2000);
                        }}
                        style={{
                          background: `${target.color}15`,
                          color: target.color,
                          border: `1px solid ${target.color}30`,
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontFamily: C.mono,
                          fontSize: 10,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>{target.icon}</span> Copy for {target.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <span style={{ fontFamily: C.mono, fontSize: 8, color: C.textFaint, padding: "0 4px" }}>
              {formatTime(msg.ts)}
            </span>
          </div>
          );
        })}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: "50%", background: C.cl,
                  opacity: 0.4,
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.textDim }}>thinking</span>
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{
        padding: "12px 16px",
        borderTop: `1px solid ${C.border}`,
        background: C.surface,
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}>
        <input ref={fileRef} type="file" accept="image/*,.pdf,.csv,.txt,.json" onChange={(e) => void handleFileUpload(e)} style={{ display: "none" }} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Attach file"
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.textDim,
            padding: "8px",
            fontSize: 15,
            cursor: "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 34,
            height: 34,
            transition: "border-color 0.15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.cl; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
        >
          {uploading ? "\u2026" : "+"}
        </button>
        <input
          ref={expandedInputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && input.trim()) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="What do you need?"
          disabled={loading}
          style={{
            flex: 1,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "9px 14px",
            fontSize: 13,
            color: C.text,
            fontFamily: C.sans,
            outline: "none",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${C.cl}50`; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
        />
        <button
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          style={{
            background: input.trim() && !loading ? C.cl : C.border,
            color: input.trim() && !loading ? "#fff" : C.textDim,
            border: "none",
            borderRadius: 10,
            width: 34,
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: input.trim() && !loading ? "pointer" : "default",
            flexShrink: 0,
            fontSize: 14,
            transition: "background 0.15s",
          }}
        >
          &#8593;
        </button>
      </div>

      {/* Pulse animation for loading dots */}
      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
