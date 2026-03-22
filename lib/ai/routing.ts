import type { AIProvider, Priority, TaskType } from "@/lib/types/domain";
import { AI_MODELS } from "@/lib/ai-config";

type RouteResult = { ai: AIProvider; model: string; reason: string };

type Rule = { test: (text: string) => boolean; ai: AIProvider; model: string; reason: string };

const ROUTES: Rule[] = [
  {
    test: (t) => /calendar|schedule|meeting|appointment|event|remind at|set a reminder|block time/i.test(t),
    ai: "gemini",
    model: "gemini-1.5-pro",
    reason: "Calendar/scheduling -> Gemini has native Google Calendar access",
  },
  {
    test: (t) => /google doc|gmail|email draft|drive|sheets|workspace|gdoc/i.test(t),
    ai: "gemini",
    model: "gemini-1.5-pro",
    reason: "Google Workspace -> Gemini integrates natively",
  },
  {
    test: (t) => /search|research|look up|what is|who is|find out|latest news|current/i.test(t),
    ai: "gemini",
    model: "gemini-1.5-pro",
    reason: "Search and current information -> Gemini handles live web context",
  },
  {
    test: (t) => /code|debug|bug|implement|script|function|deploy|error|api integration/i.test(t),
    ai: "chatgpt",
    model: "gpt-4o",
    reason: "Code/debugging -> GPT-4o is strongest for implementation",
  },
  {
    test: (t) => /data|analyze data|metrics|csv|statistics|analytics|numbers|chart/i.test(t),
    ai: "chatgpt",
    model: "gpt-4o",
    reason: "Data analysis -> GPT-4o handles structured data best",
  },
  {
    test: (t) => /brainstorm|ideas|variations|alternatives|options|explore/i.test(t),
    ai: "chatgpt",
    model: "gpt-4o",
    reason: "Ideation -> GPT-4o generates broad options",
  },
  {
    test: (t) => /write|draft|strategy|plan|analyze|review|assess|product|evaluate|content/i.test(t),
    ai: "claude",
    model: AI_MODELS.PRIMARY,
    reason: "Writing and strategy -> Claude Sonnet provides structured reasoning",
  },
];

export function routeItem(text: string): RouteResult {
  const normalized = text.toLowerCase();
  for (const rule of ROUTES) {
    if (rule.test(normalized)) return { ai: rule.ai, model: rule.model, reason: rule.reason };
  }
  return {
    ai: "claude",
    model: AI_MODELS.PRIMARY,
    reason: "General planning -> Claude Sonnet for organized reasoning",
  };
}

export function detectType(text: string): TaskType {
  const t = text.toLowerCase();
  if (/remind|reminder|don't forget|remember to|alert me/i.test(t)) return "reminder";
  if (/todo|to-do|to do|need to|finish|check off|complete/i.test(t)) return "todo";
  if (/note|thought|idea|noticed|fyi|observation/i.test(t)) return "note";
  return "task";
}

export function detectPriority(text: string): Priority {
  if (/urgent|asap|critical|today|immediately/i.test(text)) return "high";
  if (/later|eventually|someday|backlog/i.test(text)) return "low";
  return "medium";
}
