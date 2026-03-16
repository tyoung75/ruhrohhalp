"use client";

import { useState, useRef, useCallback } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";
import type { MemoryCategory, MemorySource } from "@/lib/types/domain";

interface SearchChunk {
  id: string;
  content: string;
  summary: string;
  source: MemorySource;
  sourceId: string | null;
  category: MemoryCategory;
  similarity: number;
  createdAt: string;
}

interface SearchSource {
  id: string;
  source: MemorySource;
  similarity: number;
}

interface SearchResponse {
  answer: string;
  sources: SearchSource[];
  chunks: SearchChunk[];
}

const SOURCE_COLORS: Record<string, string> = {
  manual: C.cl,
  conversation: C.gpt,
  meeting: C.gem,
  document: C.note,
  task: C.task,
};

function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? C.textDim;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: C.mono,
        fontSize: 9,
        letterSpacing: 0.4,
        padding: "1px 6px",
        borderRadius: 3,
        background: `${color}14`,
        color,
        border: `1px solid ${color}28`,
      }}
    >
      {source}
    </span>
  );
}

export function MemorySearch() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await api<SearchResponse>("/api/brain/search", {
        method: "POST",
        body: JSON.stringify({ query: q }),
      });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 3) {
      debounceRef.current = setTimeout(() => search(value), 600);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      search(query);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Search input */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: C.card,
          border: `1px solid ${C.borderMid}`,
          borderRadius: 8,
          padding: "0 12px",
        }}
      >
        <span style={{ color: C.textFaint, fontSize: 13, flexShrink: 0 }}>◇</span>
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search Tyler's brain..."
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: C.text,
            fontFamily: C.sans,
            fontSize: 13,
            padding: "10px 0",
          }}
        />
        {loading && <Spinner color={C.gem} size={13} />}
      </div>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 7,
            background: `${C.reminder}14`,
            border: `1px solid ${C.reminder}28`,
            color: C.reminder,
            fontFamily: C.mono,
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}

      {/* Answer */}
      {result && (
        <div className="fadeUp" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Answer card */}
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: 14,
            }}
          >
            <div
              style={{
                fontFamily: C.serif,
                fontStyle: "italic",
                fontSize: 11,
                color: C.textDim,
                marginBottom: 8,
              }}
            >
              Answer
            </div>
            <div
              style={{
                fontFamily: C.sans,
                fontSize: 12,
                color: C.text,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {result.answer}
            </div>
          </div>

          {/* Chunks / source results */}
          {result.chunks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span
                style={{
                  fontFamily: C.mono,
                  fontSize: 10,
                  color: C.textFaint,
                  letterSpacing: 0.5,
                }}
              >
                RETRIEVED MEMORIES ({result.chunks.length})
              </span>

              {result.chunks.map((chunk, i) => (
                <div
                  key={chunk.id}
                  className="fadeUp"
                  style={{
                    animationDelay: `${i * 0.03}s`,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {/* Chunk header: badges + similarity + date */}
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <SourceBadge source={chunk.source} />
                    {chunk.category !== "general" && (
                      <span
                        style={{
                          fontFamily: C.mono,
                          fontSize: 9,
                          padding: "1px 6px",
                          borderRadius: 3,
                          background: C.surface,
                          border: `1px solid ${C.border}`,
                          color: C.textDim,
                        }}
                      >
                        {chunk.category}
                      </span>
                    )}
                    <span style={{ marginLeft: "auto" }} />
                    <span
                      style={{
                        fontFamily: C.mono,
                        fontSize: 9,
                        color: similarityColor(chunk.similarity),
                      }}
                    >
                      {(chunk.similarity * 100).toFixed(1)}%
                    </span>
                    <span style={{ fontFamily: C.mono, fontSize: 9, color: C.textFaint }}>
                      {chunk.createdAt.slice(0, 10)}
                    </span>
                  </div>

                  {/* Chunk content */}
                  <div
                    style={{
                      fontFamily: C.sans,
                      fontSize: 11,
                      color: C.textDim,
                      lineHeight: 1.5,
                      maxHeight: 80,
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
    </div>
  );
}

function similarityColor(sim: number): string {
  if (sim >= 0.85) return C.gpt;
  if (sim >= 0.75) return C.gem;
  return C.textDim;
}
