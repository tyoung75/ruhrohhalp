/**
 * POST /api/chat — Unified Chief of Staff agent endpoint
 *
 * Uses Claude tool_use for autonomous actions across all ruhrohhalp systems.
 * Page-aware context loading. Feature suggestion detection.
 * Every exchange embedded into semantic memory.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { queryBrain } from "@/lib/query";
import { embedAndStore } from "@/lib/embedding/pipeline";
import { logError } from "@/lib/logger";
import { AI_MODELS } from "@/lib/ai-config";
import { getClaudeTools, executeAction } from "@/lib/cos/actions";

export const maxDuration = 60;

const COS_SYSTEM_PROMPT = `You are Tyler Young's Chief of Staff — his EA, financial advisor, career coach, content strategist, brand outreach manager, and life OS operator.

You have TOOLS to take real actions in Tyler's OS. Use them proactively — don't just describe what you'd do, actually do it.

PERSONALITY:
- Direct, concise, high-agency. Take action first, explain after.
- Reference specific data (task IDs, brand names, dollar amounts, dates).
- If Tyler asks you to do something and you have a tool for it, use the tool immediately.

WHEN TO USE TOOLS:
- "Delete that task" → use delete_task
- "Scout new brands" → use scout_brands
- "Mark TYOS-450 as done" → use update_task with state="done"
- "Add a directive to focus on race content" → use add_content_directive
- "Update my marathon goal to 3:15" → use update_goal_progress
- "Archive the ASRV deal" → use update_brand_deal with status="archived"
- "Remind me to X" → use set_reminder with a title and date. Creates BOTH a task AND a Google Calendar event with notifications. ALWAYS do this — never just suggest it.
- "Remember that X" → use store_decision to persist it in memory
- Any request that implies creating, updating, or doing something → USE THE TOOL. Don't ask "want me to?" — just do it.

CRITICAL: When Tyler asks for a reminder, task, or action — ALWAYS use the tool. Never respond with "Want me to create a task?" — just create it and confirm.
- "Remember that I decided to..." → use store_decision

WHEN YOU DON'T HAVE A TOOL:
If Tyler asks for something the system can't do yet, suggest it as a feature:
1. Explain what the feature would do
2. End your message with exactly this format on its own line:
[FEATURE_SUGGESTION]{"title":"short title","description":"what it does and why","prompt":"detailed prompt to build it"}[/FEATURE_SUGGESTION]

RESPONSE FORMAT:
- Lead with action results or the answer
- List tool calls you made if any
- Keep it concise
- Use markdown for structure

You are talking to Tyler directly. Use "you/your".`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
  actions?: string[];
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json().catch(() => null);
  if (!body?.message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const message = (body.message as string).trim();
  const sessionId = body.session_id as string | undefined;
  const pageContext = (body.page_context as string) ?? "general";

  const supabase = createAdminClient();

  try {
    // 1. Load or create session (gracefully handle missing table)
    let session: { id: string; messages: ChatMessage[]; title: string };
    const fallbackSession = () => ({ id: crypto.randomUUID(), messages: [] as ChatMessage[], title: "New conversation" });

    try {
      if (sessionId) {
        const { data } = await supabase.from("chat_sessions").select("id, messages, title").eq("id", sessionId).eq("user_id", user.id).single();
        session = data ? { ...data, messages: (data.messages as ChatMessage[]) ?? [] } : { id: sessionId, messages: [], title: "New conversation" };
      } else {
        const { data: ns } = await supabase.from("chat_sessions").insert({ user_id: user.id, page_context: pageContext, messages: [], title: "New conversation" }).select("id, messages, title").single();
        session = ns ? { ...ns, messages: (ns.messages as ChatMessage[]) ?? [] } : fallbackSession();
      }
    } catch {
      // chat_sessions table may not exist yet — operate without persistence
      session = fallbackSession();
    }

    // 2. Gather page-specific context
    const contextParts: string[] = [];

    // Base context — always loaded (catch errors for tables that may not exist yet)
    const safeQuery = async <T>(fn: () => Promise<{ data: T | null }>) => { try { return (await fn()).data; } catch { return null; } };
    const [tasks, goals, brands] = await Promise.all([
      safeQuery(() => supabase.from("tasks").select("id, title, state, priority, due_date, identifier").eq("user_id", user.id).not("state", "in", '("done","cancelled")').order("priority_num", { ascending: true }).limit(12)),
      safeQuery(() => supabase.from("goals").select("title, status, progress_current, progress_target, target_date").eq("user_id", user.id).eq("status", "active").limit(8)),
      safeQuery(() => supabase.from("brand_deals").select("brand_name, status, priority, next_action, contact_email, scout_reason").eq("user_id", user.id).not("status", "in", '("archived","closed_lost")').limit(12)),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tasksRes = { data: tasks as any[] | null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const goalsRes = { data: goals as any[] | null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brandsRes = { data: brands as any[] | null };

    if (tasksRes.data?.length) {
      contextParts.push("## Open Tasks\n" + tasksRes.data.map((t) =>
        `- ${t.identifier ?? t.id}: ${t.title} (${t.state}, ${t.priority}${t.due_date ? `, due ${t.due_date}` : ""})`
      ).join("\n"));
    }
    if (goalsRes.data?.length) {
      contextParts.push("## Active Goals\n" + goalsRes.data.map((g) =>
        `- ${g.title} (${g.progress_current ?? "?"}/${g.progress_target ?? "?"}${g.target_date ? `, target ${g.target_date}` : ""})`
      ).join("\n"));
    }
    if (brandsRes.data?.length) {
      contextParts.push("## Brand Pipeline\n" + brandsRes.data.map((b) =>
        `- ${b.brand_name}: ${b.status} (${b.priority ?? "?"}) — ${b.next_action ?? b.scout_reason ?? "no action"}`
      ).join("\n"));
    }

    // Page-specific deep context (safe — won't crash if tables missing)
    try {
      if (pageContext === "finance") {
        const accts = await safeQuery(() => supabase.from("financial_accounts").select("name, account_type, balance").eq("owner", "tyler").limit(8));
        if (accts?.length) contextParts.push("## Financial Accounts\n" + (accts as Array<{ name: string; account_type: string; balance: number }>).map((a) => `- ${a.name} (${a.account_type}): $${a.balance?.toLocaleString()}`).join("\n"));
      }
      if (pageContext === "creator") {
        const queue = await safeQuery(() => supabase.from("content_queue").select("body, platform, status, content_type").eq("user_id", user.id).in("status", ["draft", "queued", "approved"]).order("created_at", { ascending: false }).limit(5));
        if (queue?.length) contextParts.push("## Content Queue\n" + (queue as Array<{ platform: string; status: string; body: string }>).map((q) => `- [${q.platform}/${q.status}] ${(q.body as string)?.slice(0, 80)}`).join("\n"));
        const dirs = await safeQuery(() => supabase.from("content_directives").select("directive").eq("user_id", user.id).eq("active", true).limit(5));
        if (dirs?.length) contextParts.push("## Active Directives\n" + (dirs as Array<{ directive: string }>).map((d) => `- ${d.directive}`).join("\n"));
      }
    } catch { /* page-specific context is best-effort */ }

    // RAG brain search — always query for relevant memories; truncate long messages for embedding lookup
    try {
      const queryText = message.length > 300 ? message.slice(0, 300) : message;
      const brain = await queryBrain(queryText, { userId: user.id, topK: 6, threshold: 0.55, maxTokens: 800 });
      if (brain.answer) contextParts.push("## Relevant Memories\n" + brain.answer);
    } catch { /* best-effort */ }

    contextParts.push(`\nCurrent page: ${pageContext}`);
    contextParts.push(`Current date: ${new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })}`);

    // 3. Build Claude messages — include full conversation for continuity
    const allMessages = session.messages;
    const MAX_RECENT = 20;
    let conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;

    if (allMessages.length <= MAX_RECENT) {
      // Short conversation — include everything
      conversationHistory = allMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    } else {
      // Long conversation — summarize older messages, keep recent ones
      const older = allMessages.slice(0, -MAX_RECENT);
      const recent = allMessages.slice(-MAX_RECENT);
      const olderSummary = older.map((m) =>
        `[${m.role === "user" ? "Tyler" : "CoS"}]: ${m.content.slice(0, 120)}${m.content.length > 120 ? "..." : ""}`
      ).join("\n");
      conversationHistory = [
        { role: "user" as const, content: `[CONVERSATION SUMMARY — earlier in this session]\n${olderSummary}\n[END SUMMARY]` },
        { role: "assistant" as const, content: "Understood, I have the context from earlier in our conversation." },
        ...recent.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];
    }

    const claudeMessages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...conversationHistory,
      { role: "user" as const, content: message },
    ];

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    // Detect if this is an action request or a thinking/strategy question
    const actionWords = /\b(create|delete|remove|mark|done|complete|archive|add|update|set|remind|schedule|scout|approve|reject|edit|generate|log|cancel)\b/i;
    const needsTools = actionWords.test(message) && message.length < 300;
    const tools = needsTools ? getClaudeTools() : [];

    // 4. Call Claude (tool loop only if action detected)
    let finalReply = "";
    const actionsTaken: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentMessages: any[] = [...claudeMessages];
    const systemPrompt = `${COS_SYSTEM_PROMPT}\n\n--- CURRENT CONTEXT ---\n${contextParts.join("\n\n")}`;

    for (let i = 0; i < (needsTools ? 2 : 1); i++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: AI_MODELS.PRIMARY,
          max_tokens: 4096,
          system: systemPrompt,
          messages: currentMessages,
          ...(tools.length > 0 ? { tools } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error?.message ?? `Claude call failed (${res.status})`);

      const content: ClaudeContentBlock[] = data.content ?? [];
      const textBlocks = content.filter((c) => c.type === "text").map((c) => c.text ?? "");
      const toolUses = content.filter((c) => c.type === "tool_use");

      if (toolUses.length === 0 || data.stop_reason === "end_turn") {
        // No tool calls — final response
        finalReply = textBlocks.join("\n");
        break;
      }

      // Execute tool calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResults: any[] = [];
      for (const tu of toolUses) {
        const result = await executeAction(user.id, tu.name!, tu.input ?? {});
        actionsTaken.push(result.ok ? result.message : `Failed: ${result.error}`);
        toolResults.push({ type: "tool_result", tool_use_id: tu.id!, content: JSON.stringify(result) });
      }

      // Continue conversation: append assistant response (raw content blocks) + user tool_result
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content },
        { role: "user", content: toolResults },
      ];

      // Capture any text from this turn too
      if (textBlocks.length > 0) finalReply = textBlocks.join("\n");

      // If this was the last iteration, we'll use whatever text we have
      if (i === 1) finalReply = textBlocks.join("\n") || "Actions completed.";
    }

    // 5. Update session
    const now = new Date().toISOString();
    const updatedMessages: ChatMessage[] = [
      ...session.messages,
      { role: "user", content: message, ts: now },
      { role: "assistant", content: finalReply, ts: now, actions: actionsTaken.length > 0 ? actionsTaken : undefined },
    ];

    const title = session.messages.length === 0 ? message.slice(0, 60) + (message.length > 60 ? "..." : "") : session.title;

    try { await supabase.from("chat_sessions").update({ messages: updatedMessages, title, updated_at: now }).eq("id", session.id); } catch { /* table may not exist */ }

    // 6. Embed into brain
    try {
      const importance = message.toLowerCase().includes("directive") || message.toLowerCase().includes("always") || message.toLowerCase().includes("never") ? 8 : actionsTaken.length > 0 ? 6 : 5;
      await embedAndStore(
        `[CHIEF OF STAFF]\nTyler: ${message.slice(0, 200)}\nCoS: ${finalReply.slice(0, 300)}${actionsTaken.length ? `\nActions: ${actionsTaken.join("; ")}` : ""}`,
        { userId: user.id, source: "conversation", sourceId: `chat:${session.id}:${updatedMessages.length}`, category: "general", importance, tags: ["system:feedback", `domain:${pageContext}`, "chief-of-staff"] },
      );
    } catch (e) { logError("chat.embed", e); }

    return NextResponse.json({
      session_id: session.id,
      message: finalReply,
      title,
      actions: actionsTaken.length > 0 ? actionsTaken : undefined,
    });
  } catch (error) {
    logError("chat", error);
    return NextResponse.json({ error: "Chat failed", detail: String(error) }, { status: 500 });
  }
}

/** GET /api/chat — List recent sessions */
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const supabase = createAdminClient();
  const { data } = await supabase.from("chat_sessions").select("id, title, page_context, is_active, created_at, updated_at").eq("user_id", user.id).eq("is_active", true).order("updated_at", { ascending: false }).limit(20);

  return NextResponse.json({ sessions: data ?? [] });
}
