/**
 * Shared Claude API helper for processors that need LLM enrichment.
 */

import { AI_MODELS } from "@/lib/ai-config";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = AI_MODELS.PRIMARY;

export async function callClaude(system: string, userMessage: string, maxTokens = 1024): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY for processor enrichment");

  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Claude call failed (${res.status})`);
  }

  return data.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
}
