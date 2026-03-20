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
  projectId: string | null;
  delegatedTo: string | null;
  isOpenLoop: boolean;
  threadRef: string | null;
  linearIssueId: string | null;
  linearUrl: string | null;
  linearSyncedAt: string | null;
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

// TYOS-277: Knowledge layer types
export type MemoryCategory = "general" | "personal" | "work" | "technical" | "financial" | "health";
export type MemorySource = "manual" | "conversation" | "meeting" | "document" | "task";
export type DecisionStatus = "pending" | "made" | "revisiting" | "reversed";
export type DecisionCategory = "general" | "career" | "technical" | "financial" | "personal" | "business";
export type ProjectStatus = "active" | "paused" | "completed" | "archived";
export type Relationship = "colleague" | "client" | "friend" | "family" | "mentor" | "mentee" | "other";
export type IdeaSourceType = "typed" | "voice_memo" | "note" | "import";
export type IdeaStatus = "captured" | "exploring" | "validated" | "parked" | "discarded" | "promoted";
export type IdeaCategory = "general" | "product" | "business" | "creative" | "technical" | "personal";
export type DocType = "note" | "article" | "template" | "reference" | "spec" | "journal";
export type DocStatus = "draft" | "published" | "archived";
