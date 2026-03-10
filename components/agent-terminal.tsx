"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlannerItem } from "@/lib/types/domain";
import { C } from "@/lib/ui";
import { MODELS, PROVIDERS } from "@/lib/ai/registry";
import { ModelPicker } from "@/components/model-picker";
import { TypeBadge, ThinkDots, Spinner } from "@/components/primitives";
import { api } from "@/lib/client-api";

type Msg = { role: "user" | "assistant"; content: string; ts: string };

export function AgentTerminal({
  item,
  allItems,
  allowedModels,
  onClose,
  onModelChange,
}: {
  item: PlannerItem;
  allItems: PlannerItem[];
  allowedModels: string[];
  onClose: () => void;
  onModelChange: (id: string, modelId: string) => Promise<void>;
}) {
  const [selectedModel, setSelectedModel] = useState(item.selectedModel ?? item.recommendedModel);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [inited, setInited] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);

  const model = MODELS[selectedModel] ?? MODELS["claude-sonnet-4-5"];
  const provider = PROVIDERS[model.provider];

  const systemContext = useMemo(() => {
    const others = allItems
      .filter((t) => t.id !== item.id && t.status === "open")
      .slice(0, 6)
      .map((t) => `- [${t.type}] ${t.title}`)
      .join("\n");
    return others || "None";
  }, [allItems, item.id]);

  useEffect(() => {
    if (inited) return;
    setInited(true);
    setMessages([
      {
        role: "assistant",
        content: `Ready to execute: ${item.title}\n\nContext: ${systemContext}`,
        ts: new Date().toISOString(),
      },
    ]);
  }, [inited, item.title, systemContext]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: Msg = { role: "user", content: text, ts: new Date().toISOString() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const data = await api<{ message: string }>("/api/agent/chat", {
        method: "POST",
        body: JSON.stringify({
          taskId: item.id,
          modelId: selectedModel,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      setMessages((prev) => [...prev, { role: "assistant", content: data.message, ts: new Date().toISOString() }]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : "Chat failed"}`,
          ts: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function switchModel(modelId: string) {
    setSelectedModel(modelId);
    await onModelChange(item.id, modelId);
  }

  return (
    <div className="slideIn" style={{ display: "flex", flexDirection: "column", height: "100%", background: C.surface, borderLeft: `1px solid ${C.border}` }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 10, alignItems: "center", background: C.bg }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${provider.color}2a`, display: "grid", placeItems: "center", color: provider.color }}>
          {provider.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: C.mono, fontSize: 9, color: provider.color, letterSpacing: 1.2 }}>{provider.name.toUpperCase()} AGENT</div>
          <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
        </div>
        <ModelPicker value={selectedModel} onChange={(id) => void switchModel(id)} allowedModels={allowedModels} />
        <TypeBadge type={item.type} />
        <button onClick={onClose} style={{ background: "none", border: `1px solid ${C.border}`, color: C.textDim, width: 26, height: 26, borderRadius: 6 }}>×</button>
      </div>

      <div style={{ padding: "5px 16px", background: `${provider.color}07`, borderBottom: `1px solid ${provider.color}18` }}>
        <span style={{ fontSize: 10, fontFamily: C.mono, color: provider.color, opacity: 0.75 }}>{item.aiReason}</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((msg, idx) => (
          <div key={`${msg.ts}-${idx}`} style={{ display: "flex", gap: 8, flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
            {msg.role === "assistant" ? (
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: `${provider.color}2a`, display: "grid", placeItems: "center", color: provider.color, fontSize: 10 }}>
                {provider.icon}
              </div>
            ) : null}
            <div
              style={{
                maxWidth: "83%",
                padding: "9px 12px",
                borderRadius: 9,
                background: msg.role === "user" ? `${provider.color}14` : C.card,
                border: `1px solid ${msg.role === "user" ? `${provider.color}30` : C.border}`,
                fontSize: 12,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.content}
              <div style={{ fontSize: 9, color: C.textFaint, marginTop: 4 }}>{new Date(msg.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
            </div>
          </div>
        ))}

        {loading ? (
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: `${provider.color}2a`, display: "grid", placeItems: "center", color: provider.color, fontSize: 10 }}>
              {provider.icon}
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9 }}>
              <ThinkDots color={provider.color} />
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, background: C.bg }}>
        <div style={{ display: "flex", gap: 7, alignItems: "flex-end", background: C.card, border: `1px solid ${C.borderMid}`, borderRadius: 9, padding: "7px 9px 7px 13px" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={`Message ${provider.name} (${model.label})...`}
            rows={1}
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.text, fontFamily: C.sans, fontSize: 12, lineHeight: 1.5, resize: "none" }}
          />
          <button
            onClick={() => void send()}
            disabled={!input.trim() || loading}
            style={{
              background: input.trim() && !loading ? provider.color : C.border,
              border: "none",
              borderRadius: 7,
              width: 30,
              height: 30,
              color: C.bg,
              display: "grid",
              placeItems: "center",
            }}
          >
            {loading ? <Spinner color={C.bg} size={12} /> : "↑"}
          </button>
        </div>
      </div>
    </div>
  );
}
