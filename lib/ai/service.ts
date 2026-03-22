import type { PlannerItem } from "@/lib/types/domain";
import { callProvider } from "@/lib/ai/providers";
import { parseJSONArray } from "@/lib/ai/parse";
import { routeItem, detectType, detectPriority } from "@/lib/ai/routing";
import { plannerSystemPrompt } from "@/lib/ai/prompts";
import { getUserProviderKey } from "@/lib/ai/credentials";
import { AI_MODELS } from "@/lib/ai-config";
import type { PlanTier } from "@/lib/types/domain";
import { logError } from "@/lib/logger";

export async function processInputWithDualAI(params: {
  userId: string;
  tier: PlanTier;
  input: string;
  existingItems: Pick<PlannerItem, "type" | "title">[];
}): Promise<{ items: Omit<PlannerItem, "id" | "createdAt" | "updatedAt">[]; auditApplied: boolean }> {
  const { userId, tier, input, existingItems } = params;
  const ctxItems = existingItems.slice(0, 8).map((i) => `- [${i.type}] ${i.title}`).join("\n") || "none";

  const claudeKey = await getUserProviderKey(userId, tier, "claude");

  let claudeItems: Array<
    Omit<PlannerItem, "id" | "userId" | "status" | "selectedModel" | "createdAt" | "updatedAt" | "auditNotes" | "memoryKey" | "sourceText">
  > = [];

  if (claudeKey) {
    try {
      const raw = await callProvider({
        provider: "claude",
        modelId: AI_MODELS.PRIMARY,
        apiKey: claudeKey,
        system: plannerSystemPrompt(ctxItems),
        messages: [{ role: "user", content: input }],
      });
      claudeItems = parseJSONArray<typeof claudeItems[number]>(raw);
    } catch (error) {
      logError("planner.claude_failed", error, { userId });
    }
  }

  if (claudeItems.length === 0) {
    claudeItems = input
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const r = routeItem(line);
        return {
          title: line.slice(0, 80),
          description: "",
          type: detectType(line),
          priority: detectPriority(line),
          howTo: "Add your Anthropic key to generate tailored how-to steps.",
          recommendedAI: r.ai,
          recommendedModel: r.model,
          aiReason: r.reason,
          projectId: null,
          delegatedTo: null,
          isOpenLoop: false,
          threadRef: null,
          linearIssueId: null,
          linearUrl: null,
          linearSyncedAt: null,
        };
      });

    if (claudeItems.length === 0) {
      const r = routeItem(input);
      claudeItems = [
        {
          title: input.slice(0, 80),
          description: input.slice(80),
          type: detectType(input),
          priority: detectPriority(input),
          howTo: "",
          recommendedAI: r.ai,
          recommendedModel: r.model,
          aiReason: r.reason,
          projectId: null,
          delegatedTo: null,
          isOpenLoop: false,
          threadRef: null,
          linearIssueId: null,
          linearUrl: null,
          linearSyncedAt: null,
        },
      ];
    }
  }

  let audits: Array<{ title: string; auditNotes: string; memoryKey: string }> = [];
  let auditApplied = false;

  if (claudeItems.length > 0 && process.env.GROQ_API_KEY) {
    try {
      const summary = claudeItems
        .map((i) => `Title: ${i.title}\nType: ${i.type}\nHowTo: ${i.howTo}`)
        .join("\n\n");
      const auditResult = await auditTaskWithLlama(summary, input);
      if (auditResult.valid !== undefined) {
        // Convert Llama audit result to the per-item format
        audits = claudeItems.map((i) => ({
          title: i.title,
          auditNotes: auditResult.issues?.join("; ") ?? "",
          memoryKey: "",
        }));
        auditApplied = true;
      }
    } catch (error) {
      logError("planner.audit_failed", error, { userId });
    }
  }

  const items = claudeItems.map((item) => {
    const fallback = routeItem(`${item.title} ${item.description}`);
    const audit = audits.find((a) => a.title?.toLowerCase() === item.title?.toLowerCase());
    return {
      userId,
      title: item.title,
      description: item.description ?? "",
      type: item.type ?? detectType(item.title),
      priority: item.priority ?? "medium",
      howTo: item.howTo ?? "",
      recommendedAI: item.recommendedAI ?? fallback.ai,
      recommendedModel: item.recommendedModel ?? fallback.model,
      aiReason: item.aiReason ?? fallback.reason,
      selectedModel: null,
      auditNotes: audit?.auditNotes ?? "",
      memoryKey: audit?.memoryKey ?? "",
      status: "open" as const,
      sourceText: input,
      projectId: item.projectId ?? null,
      delegatedTo: item.delegatedTo ?? null,
      isOpenLoop: item.isOpenLoop ?? false,
      threadRef: item.threadRef ?? null,
      linearIssueId: item.linearIssueId ?? null,
      linearUrl: item.linearUrl ?? null,
      linearSyncedAt: item.linearSyncedAt ?? null,
    };
  });

  return { items, auditApplied };
}

// ---------------------------------------------------------------------------
// Llama 4 Scout audit via Groq (replaces GPT audit)
// ---------------------------------------------------------------------------

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

async function auditTaskWithLlama(claudeOutput: string, taskContext: string) {
  // Replaced GPT audit with Llama 4 Scout via Groq (Llama Guard safety enabled)
  const res = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODELS.AUDIT,
      messages: [
        {
          role: "system",
          content:
            "You are an audit model. Review the following AI-generated task " +
            "plan and validate: (1) priority assignment accuracy, (2) action " +
            "type correctness, (3) missing subtasks or risks. Return JSON: " +
            "{ valid: boolean, confidence: number, issues: string[], " +
            "suggestions: string[] }",
        },
        {
          role: "user",
          content: `Task context:\n${taskContext}\n\nClaude output:\n${claudeOutput}`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Groq audit call failed (${res.status})`);
  }
  return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
}

export async function chatWithTaskAgent(params: {
  userId: string;
  tier: PlanTier;
  provider: "claude" | "chatgpt" | "gemini";
  modelId: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
}): Promise<string> {
  const key = await getUserProviderKey(params.userId, params.tier, params.provider);
  if (!key) {
    throw new Error(`Missing ${params.provider} API key for current plan.`);
  }

  return callProvider({
    provider: params.provider,
    modelId: params.modelId,
    apiKey: key,
    system: params.system,
    messages: params.messages,
  });
}
