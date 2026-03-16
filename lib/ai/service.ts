import type { PlannerItem } from "@/lib/types/domain";
import { callProvider } from "@/lib/ai/providers";
import { parseJSONArray } from "@/lib/ai/parse";
import { routeItem, detectType, detectPriority } from "@/lib/ai/routing";
import { plannerSystemPrompt, GPT_AUDIT_SYSTEM } from "@/lib/ai/prompts";
import { getUserProviderKey } from "@/lib/ai/credentials";
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
  const chatgptKey = await getUserProviderKey(userId, tier, "chatgpt");

  let claudeItems: Array<
    Omit<PlannerItem, "id" | "userId" | "status" | "selectedModel" | "createdAt" | "updatedAt" | "auditNotes" | "memoryKey" | "sourceText">
  > = [];

  if (claudeKey) {
    try {
      const raw = await callProvider({
        provider: "claude",
        modelId: "claude-sonnet-4-5",
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
        },
      ];
    }
  }

  let audits: Array<{ title: string; auditNotes: string; memoryKey: string }> = [];
  let auditApplied = false;

  if (chatgptKey && claudeItems.length > 0) {
    try {
      const summary = claudeItems
        .map((i) => `Title: ${i.title}\nType: ${i.type}\nHowTo: ${i.howTo}`)
        .join("\n\n");
      const raw = await callProvider({
        provider: "chatgpt",
        modelId: "gpt-4o-mini",
        apiKey: chatgptKey,
        system: GPT_AUDIT_SYSTEM,
        messages: [{ role: "user", content: `Audit this plan:\n\n${summary}\n\nOriginal input: ${input}` }],
      });
      audits = parseJSONArray<{ title: string; auditNotes: string; memoryKey: string }>(raw);
      auditApplied = audits.length > 0;
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
    };
  });

  return { items, auditApplied };
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
