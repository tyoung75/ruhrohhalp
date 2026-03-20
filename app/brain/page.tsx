"use client";

import { useState, useRef, useCallback } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
// Spinner available if needed for future loading states
import { CeoMode } from "@/components/brain/CeoMode";

interface SearchSource {
  id: string;
  source: string;
  similarity: number;
}

interface SearchChunk {
  id: string;
  content: string;
  summary: string;
  source: string;
  category: string;
  similarity: number;
  createdAt: string;
}

interface SearchResponse {
  answer: string;
  sources: SearchSource[];
  chunks: SearchChunk[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SearchSource[];
  chunks?: SearchChunk[];
  timestamp: string;
}

const SOURCE_COLORS: Record<string, string> = {
  manual: C.cl,
  conversation: C.gpt,
  meeting: C.gem,
  document: C.note,
  task: C.task,
};

const SUGGESTED = [
  "What did I decide about Motus pricing?",
  "Who are my key contacts at Instacart?",
  "What are my active projects?",
  "Summarize my infrastructure",
  "What patterns emerged from meetings?",
  "What's the biggest risk across my ventures?",
];

function similarityColor(sim: number): string {
  if (sim >= 0.85) return C.gpt;
  if (sim >= 0.75) return C.gem;
  return C.textDim;
}

export default function BrainPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  async function sendMessage(text?: string) {
    const query = (text || input).trim();
    if (!query || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    scrollToBottom();

    try {
      const data = await api<SearchResponse>("/api/brain/search", {
        method: "POST",
        body: JSON.stringify({ query }),
      });

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer,
        sources: data.sources,
        chunks: data.chunks,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${e instanceof Error ? e.message : "Brain query failed"}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      scrollToBottom();
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ fontFamily: C.serif, fontSize: 22, fontStyle: "italic", color: C.cream }}>
          Brain Search
        </div>
        <div style={{ fontFamily: C.mono, fontSize: 10, color: C.textFaint, marginTop: 2 }}>
          Ask anything — answers grounded in your memories, decisions, and context
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>
        {isEmpty ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", maxWidth: 520, margin: "0 auto" }}>
            <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>◇</div>
            <div style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 18, color: C.cream, marginBottom: 6 }}>
              What do you want to know?
            </div>
            <div style={{ fontFamily: C.sans, fontSize: 12, color: C.textDim, textAlign: "center", marginBottom: 24 }}>
              Your brain has memories, decisions, projects, people, and meeting notes.
            </div>

            {/* Suggested questions */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%" }}>
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  onClick={() => void sendMessage(q)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    color: C.textDim,
                    fontFamily: C.sans,
                    fontSize: 11,
                    lineHeight: 1.4,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = `${C.cl}40`;
                    (e.currentTarget as HTMLElement).style.color = C.text;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = C.border;
                    (e.currentTarget as HTMLElement).style.color = C.textDim;
                  }}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* CEO Mode below suggestions */}
            <div style={{ width: "100%", marginTop: 28 }}>
              <div style={{ fontFamily: C.serif, fontStyle: "italic", fontSize: 13, color: C.cream, marginBottom: 10 }}>
                Or run CEO Mode
              </div>
              <CeoMode />
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className="fadeUp"
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                {msg.role === "assistant" && (
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 7,
                      background: `${C.cl}20`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 2,
                      fontSize: 12,
                      color: C.cl,
                    }}
                  >
                    ◇
                  </div>
                )}

                <div style={{ maxWidth: "80%" }}>
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      fontFamily: C.sans,
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      ...(msg.role === "user"
                        ? { background: C.cl, color: "#0f1117" }
                        : { background: C.card, border: `1px solid ${C.border}`, color: C.text }),
                    }}
                  >
                    {msg.content}
                  </div>

                  {/* Sources row */}
                  {msg.role === "assistant" && msg.chunks && msg.chunks.length > 0 && (
                    <div style={{ marginTop: 6, paddingLeft: 4 }}>
                      <button
                        onClick={() => setExpandedChunks(expandedChunks === msg.id ? null : msg.id)}
                        style={{
                          background: "none",
                          border: "none",
                          fontFamily: C.mono,
                          fontSize: 9,
                          color: C.textFaint,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        {expandedChunks === msg.id ? "▾" : "▸"} {msg.chunks.length} sources
                      </button>

                      {expandedChunks === msg.id && (
                        <div className="fadeUp" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                          {msg.chunks.map((chunk) => (
                            <div
                              key={chunk.id}
                              style={{
                                background: C.surface,
                                border: `1px solid ${C.border}`,
                                borderRadius: 7,
                                padding: "8px 10px",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                                <span
                                  style={{
                                    fontFamily: C.mono,
                                    fontSize: 9,
                                    padding: "1px 5px",
                                    borderRadius: 3,
                                    background: `${SOURCE_COLORS[chunk.source] || C.textDim}14`,
                                    color: SOURCE_COLORS[chunk.source] || C.textDim,
                                    border: `1px solid ${SOURCE_COLORS[chunk.source] || C.textDim}28`,
                                  }}
                                >
                                  {chunk.source}
                                </span>
                                {chunk.category !== "general" && (
                                  <span
                                    style={{
                                      fontFamily: C.mono,
                                      fontSize: 9,
                                      padding: "1px 5px",
                                      borderRadius: 3,
                                      background: C.surface,
                                      border: `1px solid ${C.border}`,
                                      color: C.textDim,
                                    }}
                                  >
                                    {chunk.category}
                                  </span>
                                )}
                                <span style={{ marginLeft: "auto", fontFamily: C.mono, fontSize: 9, color: similarityColor(chunk.similarity) }}>
                                  {(chunk.similarity * 100).toFixed(0)}%
                                </span>
                              </div>
                              <div
                                style={{
                                  fontFamily: C.sans,
                                  fontSize: 10,
                                  color: C.textDim,
                                  lineHeight: 1.5,
                                  maxHeight: 60,
                                  overflow: "hidden",
                                }}
                              >
                                {chunk.summary || chunk.content.slice(0, 200)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Timestamp */}
                  <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, marginTop: 4, paddingLeft: 4 }}>
                    {new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>

                {msg.role === "user" && (
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 7,
                      background: C.card,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 2,
                      fontFamily: C.mono,
                      fontSize: 10,
                      fontWeight: 600,
                      color: C.cream,
                    }}
                  >
                    T
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="fadeUp" style={{ display: "flex", gap: 10 }}>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    background: `${C.cl}20`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontSize: 12,
                    color: C.cl,
                  }}
                >
                  ◇
                </div>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "6px 12px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className={`dot-${i}`}
                        style={{ width: 5, height: 5, borderRadius: "50%", background: C.cl, display: "block" }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{ padding: "12px 22px 20px", borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              background: C.card,
              border: `1px solid ${C.borderMid}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your brain..."
              rows={1}
              disabled={loading}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: C.text,
                fontFamily: C.sans,
                fontSize: 13,
                padding: "12px 14px",
                resize: "none",
                minHeight: 42,
                maxHeight: 120,
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "42px";
                target.style.height = Math.min(target.scrollHeight, 120) + "px";
              }}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || loading}
              style={{
                padding: "10px 14px",
                background: "none",
                border: "none",
                color: input.trim() && !loading ? C.cl : C.textFaint,
                cursor: input.trim() && !loading ? "pointer" : "default",
                fontSize: 16,
              }}
            >
              ▸
            </button>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint, textAlign: "center", marginTop: 6 }}>
            Searches across memories, decisions, projects, people, meetings, and documents
          </div>
        </div>
      </div>
    </div>
  );
}
