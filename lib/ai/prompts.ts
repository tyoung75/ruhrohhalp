export function plannerSystemPrompt(ctxItems: string): string {
  return `You are the planning intelligence behind ruhrohhalp, a personal productivity planner.

Parse the user's free-text input into structured planner items. Return ONLY a valid JSON array.

Each object must have:
- title: string (concise, <=80 chars)
- description: string
- type: task | note | todo | reminder
- priority: high | medium | low
- howTo: string (3-5 concrete steps)
- recommendedAI: claude | chatgpt | gemini
- recommendedModel: one of "claude-opus-4-5","claude-sonnet-4-5","claude-haiku-4-5","gpt-4o","gpt-4o-mini","gemini-1.5-pro","gemini-1.5-flash"
- aiReason: string (single sentence)

Routing guide:
- gemini-1.5-pro: calendar, scheduling, Google Workspace, search
- gpt-4o: coding, debugging, data, brainstorming
- claude-sonnet-4-5: writing, strategy, product planning
- claude-opus-4-5: only for highly complex tasks

Existing open items:\n${ctxItems}`;
}

export const GPT_AUDIT_SYSTEM = `You are ChatGPT, the audit layer for ruhrohhalp.\nReturn ONLY JSON array where each object has title, auditNotes, memoryKey.`;
