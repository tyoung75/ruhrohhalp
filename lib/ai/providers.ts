import { PROVIDER_DEFAULT_MODEL } from "@/lib/ai/registry";
import type { AIProvider } from "@/lib/types/domain";
import { createAdminClient } from "@/lib/supabase/admin";

type Message = { role: "user" | "assistant"; content: string };

export async function callProvider(params: {
  provider: AIProvider;
  modelId?: string;
  apiKey: string;
  system: string;
  messages: Message[];
  userId?: string;
  route?: string;
}): Promise<string> {
  const { provider, modelId, apiKey, system, messages, userId, route = "unknown" } = params;

  if (provider === "claude") {
    const model = modelId || PROVIDER_DEFAULT_MODEL.claude;
    const start = Date.now();
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
    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;
    void logProviderCall({
      userId,
      route,
      provider,
      model,
      latencyMs: Date.now() - start,
      inputTokens,
      outputTokens,
      error: null,
    });
    return data.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
  }

  if (provider === "chatgpt") {
    const model = modelId || PROVIDER_DEFAULT_MODEL.chatgpt;
    const start = Date.now();
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
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    void logProviderCall({
      userId,
      route,
      provider,
      model,
      latencyMs: Date.now() - start,
      inputTokens,
      outputTokens,
      error: null,
    });
    return data.choices?.[0]?.message?.content ?? "";
  }

  const model = modelId || PROVIDER_DEFAULT_MODEL.gemini;
  const start = Date.now();
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
  const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  void logProviderCall({
    userId,
    route,
    provider,
    model,
    latencyMs: Date.now() - start,
    inputTokens,
    outputTokens,
    error: null,
  });
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/**
 * Unified AI call wrapper with timeout, retry, fallback, and activity logging.
 *
 * Usage:
 *   const result = await callAI({
 *     model: AI_MODELS.BRIEFING,
 *     system: "You are a strategic advisor.",
 *     messages: [{ role: "user", content: "Generate a briefing." }],
 *     route: "briefing",
 *   });
 */
export async function callAI(params: {
  model: string;
  system: string;
  messages: Message[];
  route?: string;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fallbackModel?: string;
}): Promise<string> {
  const {
    model,
    system,
    messages,
    route = "unknown",
    maxTokens = 1400,
    timeoutMs = 30000,
    maxRetries = 2,
    fallbackModel,
  } = params;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const attempt = async (modelId: string): Promise<{ text: string; latencyMs: number; tokensUsed: number }> => {
    const start = Date.now();

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: modelId, max_tokens: maxTokens, system, messages }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const data = await res.json();
    const latencyMs = Date.now() - start;

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? `Claude call failed (${res.status})`);
    }

    const text = data.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
    const tokensUsed = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

    return { text, latencyMs, tokensUsed };
  };

  let lastError: Error | null = null;

  // Try primary model with retries
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const result = await attempt(model);

      // Log to activity_log (fire-and-forget)
      logAICall(route, model, result.latencyMs, result.tokensUsed, null).catch(() => {});

      return result.text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, i) * 500));
      }
    }
  }

  // Try fallback model if provided
  if (fallbackModel && fallbackModel !== model) {
    try {
      const result = await attempt(fallbackModel);
      logAICall(route, fallbackModel, result.latencyMs, result.tokensUsed, null).catch(() => {});
      return result.text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Log failure
  logAICall(route, model, 0, 0, lastError?.message ?? "Unknown error").catch(() => {});
  throw lastError ?? new Error("All AI call attempts failed");
}

async function logProviderCall(params: {
  userId?: string;
  route: string;
  provider: AIProvider;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
}): Promise<void> {
  if (!params.userId) return;
  try {
    const supabase = createAdminClient();
    await supabase.from("activity_log").insert({
      user_id: params.userId,
      type: "ai_call",
      payload: {
        route: params.route,
        provider: params.provider,
        model: params.model,
        latency_ms: params.latencyMs,
        input_tokens: params.inputTokens,
        output_tokens: params.outputTokens,
        tokens_used: params.inputTokens + params.outputTokens,
        error: params.error,
      },
    });
  } catch {
    // Logging failure should not propagate
  }
}

async function logAICall(
  route: string,
  model: string,
  latencyMs: number,
  tokensUsed: number,
  error: string | null,
): Promise<void> {
  try {
    const supabase = createAdminClient();

    // Get user (single-user system)
    const { data: profile } = await supabase.from("profiles").select("id").limit(1).single();
    if (!profile) return;

    await supabase.from("activity_log").insert({
      user_id: profile.id,
      type: "ai_call",
      payload: { route, model, latency_ms: latencyMs, tokens_used: tokensUsed, error },
    });
  } catch {
    // Logging failure should not propagate
  }
}
