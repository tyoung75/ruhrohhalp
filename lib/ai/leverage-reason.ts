import { AI_MODELS } from "@/lib/ai-config";

/**
 * Generate a one-sentence leverage reason explaining WHY a task matters.
 * Uses Sonnet via direct Anthropic API call.
 */
export async function generateLeverageReason(task: {
  title: string;
  description?: string;
  priority_score?: number;
  goal_title?: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";

  const prompt = `You are a strategic advisor. Given this task, write ONE sentence (max 20 words) explaining WHY this task has high leverage — what outcome or unlock it creates.

Task: ${task.title}
${task.description ? `Description: ${task.description}` : ""}
${task.goal_title ? `Linked goal: ${task.goal_title}` : ""}
${task.priority_score ? `Priority score: ${task.priority_score}` : ""}

Reply with ONLY the one-sentence reason. No quotes, no prefix.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODELS.LEVERAGE_REASON ?? AI_MODELS.PRIMARY,
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return "";

    const data = await res.json();
    const text = data.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
    return text.trim();
  } catch {
    return "";
  }
}
