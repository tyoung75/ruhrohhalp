export type TaskType = "task" | "note" | "todo" | "reminder";
export type Priority = "high" | "medium" | "low";
export type PlanTier = "free" | "starter" | "pro" | "byok";
export type AIProvider = "claude" | "chatgpt" | "gemini";

export type PlannerItem = {
  id: string;
  userId: string;
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  howTo: string;
  recommendedAI: AIProvider;
  recommendedModel: string;
  aiReason: string;
  selectedModel: string | null;
  auditNotes: string;
  memoryKey: string;
  status: "open" | "done";
  sourceText: string;
  createdAt: string;
  updatedAt: string;
};

export type ProcessInputRequest = { input: string };
export type ProcessInputResponse = {
  items: PlannerItem[];
  auditApplied: boolean;
  usageCount: number;
  usageLimit: number | null;
};

export type AgentChatRequest = {
  taskId: string;
  modelId: string;
  messages: { role: "user" | "assistant"; content: string }[];
};

export type AgentChatResponse = {
  message: string;
  modelId: string;
  provider: AIProvider;
};
