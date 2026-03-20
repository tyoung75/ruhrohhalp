import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/dispatch
 *
 * Creates an agent_run record for external execution
 *
 * Body:
 * {
 *   agent_type: string (required, e.g. "email_draft", "deploy", "research")
 *   context: string (required, description of what the agent should do)
 *   task_id?: string (optional, associated task)
 *   metadata?: object (optional, additional context)
 * }
 *
 * Returns:
 * {
 *   agent_run_id: string
 *   status: "queued"
 * }
 *
 * The actual agent execution happens externally (Cowork picks it up)
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

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agent_runs")
    .insert({
      user_id: user.id,
      agent_type,
      context,
      task_id: task_id ?? null,
      metadata: metadata ?? {},
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

  return NextResponse.json(
    {
      agent_run_id: data.id,
      status: "queued",
    },
    { status: 201 }
  );
}
