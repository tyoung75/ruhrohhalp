"use client";

import { useRef, useState } from "react";
import { C } from "@/lib/ui";
import { Spinner } from "@/components/primitives";

export function CaptureBar({
  onCapture,
  processing,
}: {
  onCapture: (text: string) => Promise<void>;
  processing: boolean;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  async function submit() {
    if (!text.trim() || processing) return;
    const value = text.trim();
    setText("");
    if (ref.current) ref.current.style.height = "auto";
    await onCapture(value);
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.borderMid}`, borderRadius: 12, overflow: "hidden" }}>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={"Dump anything - tasks, notes, to-dos, ideas, reminders...\n\nCmd/Ctrl + Enter to process"}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          outline: "none",
          padding: "14px 16px",
          color: C.text,
          fontFamily: C.sans,
          fontSize: 13,
          lineHeight: 1.7,
          resize: "none",
          minHeight: 120,
        }}
        onInput={(e) => {
          const target = e.target as HTMLTextAreaElement;
          target.style.height = "auto";
          target.style.height = `${Math.min(target.scrollHeight, 260)}px`;
        }}
      />

      <div
        style={{
          padding: "8px 12px",
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: `${C.surface}80`,
        }}
      >
        <div style={{ fontSize: 10, fontFamily: C.mono, color: C.textFaint }}>{text.length > 0 ? `${text.length} chars` : ""}</div>
        <button
          onClick={() => void submit()}
          disabled={!text.trim() || processing}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: text.trim() && !processing ? C.cl : C.border,
            color: text.trim() && !processing ? C.bg : C.textFaint,
            border: "none",
            borderRadius: 7,
            padding: "6px 14px",
            cursor: text.trim() && !processing ? "pointer" : "default",
            fontFamily: C.sans,
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {processing ? (
            <>
              <Spinner color={C.bg} size={12} /> Processing...
            </>
          ) : (
            <>◆ Process</>
          )}
        </button>
      </div>
    </div>
  );
}
