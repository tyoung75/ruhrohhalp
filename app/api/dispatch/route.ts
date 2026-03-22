import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/dispatch
 *
 * Enhanced dispatch endpoint for the one-tap action system.
 *
 * Creates an agent_run record that external systems (Cowork, cron, webhooks)
 * pick up and execute. Each agent_type maps to a specific execution pathway:
 *
 *   email_draft  → Cowork picks up, uses Gmail MCP to draft + open
 *   code         → Cowork picks up, sends to Claude Code session
 *   admin        → Cowork picks up, opens as admin task
 *   deploy       → Cowork picks up, runs deploy skill
 *   research     → Cowork picks up, runs research with RAG
 *   content      → Cowork picks up, runs content-autodraft skill
 *   calendar     → Cowork picks up, uses Google Calendar MCP
 *   custom       → Generic handler, metadata.agent_type specifies behavior
 *
 * Body:
 * {
 *   agent_type: string (required)
 *   context: string (required — what the agent should do)
 *   task_id?: string (optional — associated task)
 *   metadata?: {
 *     one_tap?: boolean      — originated from one-tap UI
 *     initiated_at?: string  — ISO timestamp of user click
 *     pillar_id?: string     — associated life pillar
 *     goal_id?: string       — associated goal
 *     source_signal_id?: string — signal that prompted this action
 *     ...any extra context
 *   }
 * }
 *
 * Returns:
 * {
 *   agent_run_id: string
 *   status: "queued"
 *   execution_hint: string  — tells the UI what will happen
 * }
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { agent_type, context, task_id, metadata } = body;

  if (!agent_type || typeof agent_type !== "string") {
    return NextResponse.json({ error: "agent_type is required" }, { status: 400 });
  }

  if (!context || typeof context !== "string") {
    return NextResponse.json({ error: "context is required" }, { status: 400 });
  }

  // Validate known agent types
  const KNOWN_TYPES = new Set([
    "email_draft",
    "code",
    "admin",
    "deploy",
    "research",
    "content",
    "calendar",
    "custom",
  ]);

  const resolvedType = KNOWN_TYPES.has(agent_type) ? agent_type : "custom";

  // Build enriched metadata
  const enrichedMetadata = {
    ...(metadata ?? {}),
    original_agent_type: agent_type,
    execution_pathway: EXECUTION_HINTS[resolvedType] ?? "queued for processing",
  };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agent_runs")
    .insert({
      user_id: user.id,
      agent_type: resolvedType,
      context,
      task_id: task_id ?? null,
      metadata: enrichedMetadata,
      status: "queued",
      result: null,
      error: null,
      started_at: null,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log to activity
  await supabase.from("activity_log").insert({
    user_id: user.id,
    type: "dispatch",
    description: `Dispatched ${resolvedType}: ${context.slice(0, 100)}`,
    metadata: {
      agent_run_id: data.id,
      agent_type: resolvedType,
      one_tap: metadata?.one_tap ?? false,
    },
    created_at: new Date().toISOString(),
  }).then(() => {});  // Fire-and-forget

  return NextResponse.json(
    {
      agent_run_id: data.id,
      status: "queued",
      execution_hint: EXECUTION_HINTS[resolvedType] ?? "Queued for processing",
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// Execution hints — tells the UI what will happen
// ---------------------------------------------------------------------------

const EXECUTION_HINTS: Record<string, string> = {
  email_draft: "Drafting email in Gmail — you'll see it in your drafts",
  code:        "Sending to Claude Code for implementation",
  admin:       "Opening in Cowork as an admin task",
  deploy:      "Starting deploy pipeline — running checks",
  research:    "Running async research with RAG brain",
  content:     "Generating content draft in your brand voice",
  calendar:    "Creating calendar event",
  custom:      "Queued for processing",
};
