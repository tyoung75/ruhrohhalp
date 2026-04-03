/**
 * POST /api/chat — Unified Chief of Staff agent endpoint
 *
 * Routes intelligently across all systems: tasks, brands, content, finance,
 * goals, and general knowledge. Every exchange gets summarized and embedded
 * into the brain so the system compounds.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { queryBrain } from "@/lib/query";
import { callClaude } from "@/lib/processors/claude";
import { embedAndStore } from "@/lib/embedding/pipeline";
import { logError } from "@/lib/logger";
import { AI_MODELS } from "@/lib/ai-config";

export const maxDuration = 60;

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

const COS_SYSTEM_PROMPT = `You are Tyler Young's Chief of Staff — his EA, financial advisor, career coach, content strategist, brand outreach manager, and life OS operator.

You have access to Tyler's full context: tasks, goals, brand pipeline, content queue, financial holdings, training data, and semantic memories. You can take actions and make adjustments across all systems.

PERSONALITY:
- Direct, concise, proactive. Don't ask permission for small things — just do them and report.
- Think like a high-agency chief of staff who anticipates needs.
- Reference specific data (task IDs, brand names, dollar amounts, dates) — never be vague.
- If Tyler gives feedback or a directive, acknowledge it, apply it, and explain what changed.

CAPABILITIES:
- Create/update/complete tasks
- Adjust brand outreach strategy, draft emails, update deal status
- Modify content strategy directives
- Update financial holdings or projections
- Create goals, update progress, add signals
- Answer questions by searching Tyler's brain (semantic memories)
- Store new decisions, directives, or context for future reference

WHEN TYLER GIVES FEEDBACK:
- Apply it immediately to the relevant system
- Store it as a directive in semantic memory so it cascades to all future operations
- Confirm what you changed and what the downstream effects will be

RESPONSE FORMAT:
- Lead with the action or answer, not preamble
- If you took actions, list them clearly
- Keep responses concise — Tyler is busy
- Use markdown for structure when helpful

IMPORTANT: You are talking to Tyler directly. Use "you/your" not "Tyler/his".`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
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
    // 1. Load or create session
    let session: { id: string; messages: ChatMessage[]; title: string; page_context: string };

    if (sessionId) {
      const { data } = await supabase
        .from("chat_sessions")
        .select("id, messages, title, page_context")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .single();

      if (data) {
        session = { ...data, messages: (data.messages as ChatMessage[]) ?? [] };
      } else {
        session = { id: sessionId, messages: [], title: "New conversation", page_context: pageContext };
      }
    } else {
      const { data: newSession } = await supabase
        .from("chat_sessions")
        .insert({ user_id: user.id, page_context: pageContext, messages: [], title: "New conversation" })
        .select("id, messages, title, page_context")
        .single();

      session = newSession
        ? { ...newSession, messages: (newSession.messages as ChatMessage[]) ?? [] }
        : { id: crypto.randomUUID(), messages: [], title: "New conversation", page_context: pageContext };
    }

    // 2. Gather context based on the page and message
    const contextParts: string[] = [];

    // Always include recent tasks and goals
    const [tasksRes, goalsRes, brandsRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("title, state, priority, due_date, identifier")
        .eq("user_id", user.id)
        .not("state", "in", '("done","cancelled")')
        .order("priority_num", { ascending: true })
        .limit(10),
      supabase
        .from("goals")
        .select("title, status, progress_current, progress_target, target_date")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(8),
      supabase
        .from("brand_deals")
        .select("brand_name, status, priority, next_action, contact_email")
        .eq("user_id", user.id)
        .not("status", "in", '("archived","closed_lost")')
        .limit(10),
    ]);

    if (tasksRes.data?.length) {
      contextParts.push("## Open Tasks\n" + tasksRes.data.map((t) =>
        `- ${t.identifier ?? "?"}: ${t.title} (${t.state}, ${t.priority}${t.due_date ? `, due ${t.due_date}` : ""})`
      ).join("\n"));
    }

    if (goalsRes.data?.length) {
      contextParts.push("## Active Goals\n" + goalsRes.data.map((g) =>
        `- ${g.title} (${g.progress_current ?? "?"}/${g.progress_target ?? "?"}${g.target_date ? `, target ${g.target_date}` : ""})`
      ).join("\n"));
    }

    if (brandsRes.data?.length) {
      contextParts.push("## Brand Pipeline\n" + brandsRes.data.map((b) =>
        `- ${b.brand_name}: ${b.status} (${b.priority ?? "?"}) — ${b.next_action ?? "no action set"}`
      ).join("\n"));
    }

    // RAG: search brain for relevant context
    let brainContext = "";
    try {
      const brainResult = await queryBrain(message, { userId: user.id, topK: 6, threshold: 0.55, maxTokens: 1024 });
      if (brainResult.answer) {
        brainContext = brainResult.answer;
      }
    } catch { /* brain search is best-effort */ }

    if (brainContext) {
      contextParts.push("## Relevant Memories\n" + brainContext);
    }

    contextParts.push(`\nCurrent page: ${pageContext}`);
    contextParts.push(`Current date: ${new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })}`);

    // 3. Build conversation with context
    const recentMessages = session.messages.slice(-10);
    const claudeMessages = [
      ...recentMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: message },
    ];

    const systemWithContext = `${COS_SYSTEM_PROMPT}\n\n--- CURRENT CONTEXT ---\n${contextParts.join("\n\n")}`;

    // 4. Call Claude
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODELS.PRIMARY,
        max_tokens: 2048,
        system: systemWithContext,
        messages: claudeMessages,
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? `Claude call failed (${res.status})`);
    }

    const reply = data.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";

    // 5. Update session
    const now = new Date().toISOString();
    const updatedMessages: ChatMessage[] = [
      ...session.messages,
      { role: "user", content: message, ts: now },
      { role: "assistant", content: reply, ts: now },
    ];

    // Auto-title from first message
    const title = session.messages.length === 0
      ? message.slice(0, 60) + (message.length > 60 ? "..." : "")
      : session.title;

    await supabase
      .from("chat_sessions")
      .update({ messages: updatedMessages, title, updated_at: now })
      .eq("id", session.id);

    // 6. Embed the exchange into semantic memory (concise summary)
    try {
      const summaryText = `[CHIEF OF STAFF CONVERSATION]\nTyler: ${message.slice(0, 200)}\nCoS: ${reply.slice(0, 300)}`;
      await embedAndStore(summaryText, {
        userId: user.id,
        source: "conversation",
        sourceId: `chat:${session.id}:${updatedMessages.length}`,
        category: "general",
        importance: message.toLowerCase().includes("directive") || message.toLowerCase().includes("always") || message.toLowerCase().includes("never") ? 8 : 5,
        tags: ["system:feedback", `domain:${pageContext}`, "chief-of-staff"],
      });
    } catch (embedErr) {
      logError("chat.embed", embedErr);
    }

    return NextResponse.json({
      session_id: session.id,
      message: reply,
      title,
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
  const { data } = await supabase
    .from("chat_sessions")
    .select("id, title, page_context, is_active, created_at, updated_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ sessions: data ?? [] });
}
