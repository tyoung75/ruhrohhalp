"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client-api";
import { C } from "@/lib/ui";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
}

interface ChatResponse {
  session_id: string;
  message: string;
  title: string;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // Keyboard shortcut: Cmd/Ctrl+J to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          page_context: pageContext,
        }),
      });

      setSessionId(res.session_id);
      const assistantMsg: ChatMessage = { role: "assistant", content: res.message, ts: new Date().toISOString() };
      setMessages((prev) => [...prev, assistantMsg]);

      // Dispatch refresh events in case the agent made changes
      window.dispatchEvent(new CustomEvent("tasks:refresh"));
      window.dispatchEvent(new CustomEvent("brands:refresh"));
    } catch (err) {
      const errMsg: ChatMessage = { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Something went wrong"}`, ts: new Date().toISOString() };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }

  function newSession() {
    setSessionId(null);
    setMessages([]);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      // Convert to base64 for the message
      const reader = new FileReader();
      reader.onload = () => {
        const text = file.type.startsWith("image/")
          ? `[Uploaded image: ${file.name} (${(file.size / 1024).toFixed(0)}KB)]`
          : `[Uploaded file: ${file.name} (${(file.size / 1024).toFixed(0)}KB)]`;

        setInput((prev) => prev ? `${prev} ${text}` : text);
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setUploading(false);
    }

    // Reset file input
    if (fileRef.current) fileRef.current.value = "";
  }

  // Collapsed bar
  if (!open) {
    return (
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 200,
          right: 0,
          zIndex: 80,
          background: C.surface,
          borderTop: `1px solid ${C.border}`,
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button
          onClick={() => setOpen(true)}
          style={{
            background: "transparent",
            border: "none",
            color: C.cl,
            fontSize: 16,
            cursor: "pointer",
            padding: "2px 6px",
          }}
        >
          &#9670;
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { e.preventDefault(); setOpen(true); void send(); } }}
          placeholder="Ask your Chief of Staff anything... (Ctrl+J)"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            color: C.text,
            fontSize: 13,
            fontFamily: C.sans,
            outline: "none",
          }}
        />
        <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>
          {pageContext}
        </span>
      </div>
    );
  }

  // Expanded panel
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        right: 0,
        width: 440,
        maxWidth: "100vw",
        height: "60vh",
        maxHeight: 520,
        zIndex: 90,
        background: C.surface,
        borderLeft: `1px solid ${C.border}`,
        borderTop: `1px solid ${C.border}`,
        borderTopLeftRadius: 12,
        display: "flex",
        flexDirection: "column",
        boxShadow: "-4px -4px 20px #0004",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 14px",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: C.cl, fontSize: 14 }}>&#9670;</span>
          <span style={{ fontFamily: C.serif, fontStyle: "italic", color: C.cream, fontSize: 14 }}>Chief of Staff</span>
          <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, background: C.card, padding: "2px 6px", borderRadius: 4 }}>{pageContext}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={newSession}
            style={{ background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 8px", fontFamily: C.mono, fontSize: 9, cursor: "pointer" }}
          >
            New
          </button>
          <button
            onClick={() => setOpen(false)}
            style={{ background: "transparent", color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 8px", fontSize: 12, cursor: "pointer" }}
          >
            &#8722;
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: C.textFaint, fontSize: 12, marginTop: 40 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>&#9670;</div>
            <div style={{ fontFamily: C.serif, fontStyle: "italic", color: C.textDim, fontSize: 14, marginBottom: 4 }}>Chief of Staff</div>
            <div>Your EA, coach, strategist, and editor.</div>
            <div style={{ marginTop: 8, fontFamily: C.mono, fontSize: 10 }}>Every conversation compounds into the brain.</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: msg.role === "user" ? `${C.cl}14` : C.card,
              border: `1px solid ${msg.role === "user" ? `${C.cl}30` : C.border}`,
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 12,
              lineHeight: 1.6,
              color: C.text,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: "flex-start", color: C.textDim, fontSize: 12, fontFamily: C.mono }}>
            thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div
        style={{
          padding: "10px 14px",
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,.csv,.txt,.json"
          onChange={(e) => void handleFileUpload(e)}
          style={{ display: "none" }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            background: "transparent",
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            color: C.textDim,
            padding: "4px 6px",
            fontSize: 14,
            cursor: "pointer",
            flexShrink: 0,
          }}
          title="Upload file or image"
        >
          {uploading ? "..." : "\u{1F4CE}"}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && input.trim()) { e.preventDefault(); void send(); } }}
          placeholder="What do you need?"
          disabled={loading}
          style={{
            flex: 1,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 13,
            color: C.text,
            fontFamily: C.sans,
            outline: "none",
          }}
        />
        <button
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          style={{
            background: input.trim() ? C.cl : C.border,
            color: input.trim() ? C.bg : C.textDim,
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
            fontFamily: C.mono,
            fontSize: 11,
            fontWeight: 700,
            cursor: input.trim() ? "pointer" : "default",
            flexShrink: 0,
          }}
        >
          {loading ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
