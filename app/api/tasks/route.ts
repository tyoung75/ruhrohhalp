import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { createClient } from "@/lib/supabase/server";
import { dbTaskToPlannerItem } from "@/lib/tasks";

/**
 * GET /api/tasks
 * Fetches tasks with optional filtering and pagination
 *
 * Query params:
 * - state=started,unstarted,backlog (comma-separated)
 * - priority=1,2 (priority_num filter, comma-separated)
 * - project=motus (project slug)
 * - due_before=2026-03-25 (ISO date)
 * - updated_after=2026-03-19T00:00:00Z (ISO timestamp)
 * - limit=50 (default 50)
 * - offset=0 (default 0)
 */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 250);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");
  const stateParam = url.searchParams.get("state");
  const priorityParam = url.searchParams.get("priority");
  const projectParam = url.searchParams.get("project");
  const dueBeforeParam = url.searchParams.get("due_before");
  const updatedAfterParam = url.searchParams.get("updated_after");

  const supabase = await createClient();
  let query = supabase
    .from("tasks")
    .select("*", { count: "exact" })
    .eq("user_id", user.id);

  // Apply filters
  if (stateParam) {
    const states = stateParam.split(",");
    query = query.in("state", states);
  }

  if (priorityParam) {
    const priorities = priorityParam.split(",").map(p => parseInt(p));
    query = query.in("priority_num", priorities);
  }

  if (dueBeforeParam) {
    query = query.lte("due_date", dueBeforeParam);
  }

  if (updatedAfterParam) {
    query = query.gte("updated_at", updatedAfterParam);
  }

  // Apply ordering and pagination
  query = query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If project filter is needed, fetch projects and filter in memory
  // (Supabase RLS would handle this in a real scenario)
  let items = (data ?? []).map(dbTaskToPlannerItem);

  if (projectParam) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id")
      .eq("user_id", user.id)
      .eq("slug", projectParam);

    const projectIds = (projects ?? []).map(p => p.id);
    items = items.filter(item => item.projectId && projectIds.includes(item.projectId));
  }

  return NextResponse.json({
    items,
    pagination: {
      limit,
      offset,
      total: count ?? 0,
    },
  });
}

/**
 * POST /api/tasks
 * Creates a new task
 *
 * Body:
 * {
 *   title: string (required)
 *   description?: string
 *   priority_num?: 1-4 (maps to priority text: 1,2='high', 3='medium', 4='low')
 *   state?: 'started' | 'unstarted' | 'backlog'
 *   project_slug?: string
 *   due_date?: ISO date
 *   source?: string
 *   github_pr_url?: string
 * }
 *
 * Supports x-webhook-secret header for external callers
 */
export async function POST(request: NextRequest) {
  // Check for webhook auth OR user auth
  const webhookSecret = request.headers.get("x-webhook-secret");
  let user: { id: string } | null = null;

  if (webhookSecret) {
    const webhookError = validateWebhookSecret(webhookSecret);
    if (webhookError) return webhookError;
    // For webhook calls, extract user_id from body
    const body = await request.json();
    if (!body.user_id) {
      return NextResponse.json({ error: "user_id required for webhook calls" }, { status: 400 });
    }
    user = { id: body.user_id };
    request = new NextRequest(request, {
      body: JSON.stringify(body),
    });
  } else {
    const authResponse = await requireUser();
    if (authResponse.response || !authResponse.user) return authResponse.response;
    user = authResponse.user;
  }

  const body = await request.json();
  const {
    title,
    description,
    priority_num,
    state,
    project_slug,
    due_date,
    source,
    github_pr_url,
  } = body;

  if (!title || typeof title !== "string" || title.length === 0) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Map priority_num to priority text
  let priorityText = "medium";
  if (priority_num === 1 || priority_num === 2) {
    priorityText = "high";
  } else if (priority_num === 3) {
    priorityText = "medium";
  } else if (priority_num === 4) {
    priorityText = "low";
  }

  // Find project_id by slug if provided
  let projectId = null;
  if (project_slug) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id")
      .eq("user_id", user.id)
      .eq("slug", project_slug)
      .single();

    if (projects) {
      projectId = projects.id;
    }
  }

  // Create the task (identifier auto-generated by DB trigger)
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      title,
      description: description ?? "",
      priority: priorityText,
      priority_num: priority_num ?? 3,
      state: state ?? "unstarted",
      project_id: projectId,
      due_date: due_date ?? null,
      source: source ?? "api",
      github_pr_url: github_pr_url ?? null,
      status: "open",
      type: "task",
      recommended_ai: "claude",
      recommended_model: "claude-3-5-sonnet",
      ai_reason: "",
      how_to: "",
      audit_notes: "",
      memory_key: "",
      source_text: title,
      is_open_loop: false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { task: dbTaskToPlannerItem(data), identifier: data.identifier },
    { status: 201 }
  );
}
