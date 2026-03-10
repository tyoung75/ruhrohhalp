import { PROVIDER_DEFAULT_MODEL } from "@/lib/ai/registry";
import type { AIProvider } from "@/lib/types/domain";

type Message = { role: "user" | "assistant"; content: string };

export async function callProvider(params: {
  provider: AIProvider;
  modelId?: string;
  apiKey: string;
  system: string;
  messages: Message[];
}): Promise<string> {
  const { provider, modelId, apiKey, system, messages } = params;

  if (provider === "claude") {
    const model = modelId || PROVIDER_DEFAULT_MODEL.claude;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: 1400, system, messages }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message ?? "Claude call failed");
    return data.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
  }

  if (provider === "chatgpt") {
    const model = modelId || PROVIDER_DEFAULT_MODEL.chatgpt;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message ?? "OpenAI call failed");
    return data.choices?.[0]?.message?.content ?? "";
  }

  const model = modelId || PROVIDER_DEFAULT_MODEL.gemini;
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
      }),
    },
  );
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message ?? "Gemini call failed");
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
