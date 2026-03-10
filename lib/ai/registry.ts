import type { AIProvider } from "@/lib/types/domain";

export type ModelDef = {
  id: string;
  provider: AIProvider;
  label: string;
  tier: "flagship" | "balanced" | "fast";
  newest: boolean;
  priceIn: number;
  priceOut: number;
  badge: string;
  blurb: string;
};

export const MODELS: Record<string, ModelDef> = {
  "claude-opus-4-5": {
    id: "claude-opus-4-5",
    provider: "claude",
    label: "Claude Opus 4.5",
    tier: "flagship",
    newest: true,
    priceIn: 5,
    priceOut: 25,
    badge: "★ Best",
    blurb: "Highest reasoning, best for complex strategy & analysis",
  },
  "claude-sonnet-4-5": {
    id: "claude-sonnet-4-5",
    provider: "claude",
    label: "Claude Sonnet 4.5",
    tier: "balanced",
    newest: false,
    priceIn: 3,
    priceOut: 15,
    badge: "Balanced",
    blurb: "Best quality-to-speed ratio for most tasks",
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    provider: "claude",
    label: "Claude Haiku 4.5",
    tier: "fast",
    newest: false,
    priceIn: 0.8,
    priceOut: 4,
    badge: "Fast",
    blurb: "Instant responses, great for quick to-dos",
  },
  "gpt-4o": {
    id: "gpt-4o",
    provider: "chatgpt",
    label: "GPT-4o",
    tier: "flagship",
    newest: true,
    priceIn: 5,
    priceOut: 20,
    badge: "★ Best",
    blurb: "Top OpenAI model - coding, research, data",
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "chatgpt",
    label: "GPT-4o Mini",
    tier: "fast",
    newest: false,
    priceIn: 0.15,
    priceOut: 0.6,
    badge: "Fast",
    blurb: "Lean & cheap - great for audits and quick research",
  },
  "gemini-1.5-pro": {
    id: "gemini-1.5-pro",
    provider: "gemini",
    label: "Gemini 1.5 Pro",
    tier: "flagship",
    newest: true,
    priceIn: 1.25,
    priceOut: 5,
    badge: "★ Best",
    blurb: "Best Gemini - Google Workspace, long context",
  },
  "gemini-1.5-flash": {
    id: "gemini-1.5-flash",
    provider: "gemini",
    label: "Gemini 1.5 Flash",
    tier: "fast",
    newest: false,
    priceIn: 0.075,
    priceOut: 0.3,
    badge: "Fast",
    blurb: "Fastest Gemini - calendar and quick search",
  },
};

export const PROVIDER_DEFAULT_MODEL: Record<AIProvider, string> = {
  claude: "claude-sonnet-4-5",
  chatgpt: "gpt-4o",
  gemini: "gemini-1.5-pro",
};

export const PROVIDERS: Record<AIProvider, { id: AIProvider; name: string; icon: string; color: string }> = {
  claude: { id: "claude", name: "Claude", icon: "◆", color: "#e07d4a" },
  chatgpt: { id: "chatgpt", name: "ChatGPT", icon: "◇", color: "#41c998" },
  gemini: { id: "gemini", name: "Gemini", icon: "✦", color: "#5d9ef8" },
};
