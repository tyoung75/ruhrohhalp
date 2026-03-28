import { AI_MODELS } from "@/lib/ai-config";

/**
 * Generate a concrete unblock hint for a blocked task.
 * Uses Sonnet to suggest how to unblock.
 */
export async function generateUnblockHint(task: {
  title: string;
  description?: string;
  goal_title?: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";

  const prompt = `You are a productivity coach. This task is BLOCKED. Write ONE concrete, actionable sentence (max 25 words) suggesting how to unblock it. Focus on the smallest next step.

Task: ${task.title}
${task.description ? `Description: ${task.description}` : ""}
${task.goal_title ? `Goal: ${task.goal_title}` : ""}

Reply with ONLY the unblock suggestion. No quotes, no prefix.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODELS.UNBLOCK_HINT,
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return "";

    const data = await res.json();
    return data.content?.find((c: { type: string }) => c.type === "text")?.text?.trim() ?? "";
  } catch {
    return "";
  }
}
