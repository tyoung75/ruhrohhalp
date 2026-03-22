"use client";

import { useEffect, useRef, useState } from "react";
import { C } from "@/lib/ui";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/primitives";

interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export function CommandBar() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function handleSubmit() {
    if (!input.trim() || loading) return;

    const command = input.trim();
    setInput("");
    setLoading(true);
    setResult(null);
    setShowResult(true);

    try {
      const data = await api<CommandResult>("/api/command", {
        method: "POST",
        body: JSON.stringify({ input: command }),
      });
      setResult(data);

      // Notify other components to refresh after a successful command
      if (data.success) {
        window.dispatchEvent(new CustomEvent("tasks:refresh"));
        window.dispatchEvent(new CustomEvent("briefing:refresh"));
      }

      // Hide result after 4 seconds
      setTimeout(() => {
        setShowResult(false);
      }, 4000);
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : "Command failed",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, background: C.surface }}>
      {/* Command input */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 20px",
          background: C.surface,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSubmit();
            }
          }}
          placeholder="Type a command, add a task, or ask anything... (Cmd/Ctrl+K)"
          style={{
            flex: 1,
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "8px 12px",
            fontFamily: C.mono,
            fontSize: 12,
            color: C.text,
            outline: "none",
          }}
          disabled={loading}
        />
        <button
          onClick={() => handleSubmit()}
          disabled={!input.trim() || loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            background: input.trim() && !loading ? C.cl : C.border,
            color: input.trim() && !loading ? C.bg : C.textFaint,
            border: "none",
            borderRadius: 6,
            fontFamily: C.mono,
            fontSize: 11,
            cursor: input.trim() && !loading ? "pointer" : "default",
            whiteSpace: "nowrap",
          }}
        >
          {loading ? <Spinner color={input.trim() ? C.bg : C.textFaint} size={10} /> : "↵"}
        </button>
      </div>

      {/* Result area */}
      {showResult && result && (
        <div
          style={{
            padding: "8px 20px 10px",
            borderTop: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: result.success ? `${C.gpt}08` : `${C.reminder}08`,
            fontSize: 12,
            fontFamily: C.mono,
            color: result.success ? C.gpt : C.reminder,
          }}
        >
          <span>{result.success ? "✓" : "✕"}</span>
          <span>{result.message}</span>
        </div>
      )}
    </div>
  );
}
