import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type CommandIntent =
  | "update_task"
  | "cancel_task"
  | "add_task"
  | "note"
  | "dispatch"
  | "feedback"
  | "question";

interface CommandResponse {
  intent: CommandIntent;
  result: string;
  executed: boolean;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * POST /api/command
 *
 * Accepts free-text input and classifies intent, executing where possible
 *
 * Body:
 * {
 *   input: string (required)
 * }
 *
 * Intent classification:
 * - "done TYOS-XXX" or "complete TYOS-XXX" → update_task (mark done)
 * - "cancel TYOS-XXX" → cancel_task
 * - Starts with "add task:" or "new task:" → add_task
 * - Starts with "note:" → note
 * - Contains "draft", "send", "deploy" → dispatch
 * - Contains "more", "less", "remove", "fix" + section name → feedback
 * - Default → question
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const { input } = body;

  if (!input || typeof input !== "string") {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const lowerInput = input.toLowerCase().trim();

  // Classify intent
  let intent: CommandIntent = "question";
  let result = "";
  let executed = false;
  const metadata: Record<string, unknown> = {};
  let taskId: string | undefined;

  // Pattern: "done TYOS-XXX" or "complete TYOS-XXX"
  const doneMatch = input.match(/(?:done|complete)\s+(TYOS-\d+)/i);
  if (doneMatch) {
    intent = "update_task";
    const identifier = doneMatch[1];
    const { data: task } = await supabase
      .from("tasks")
      .select("id")
      .eq("user_id", user.id)
      .eq("identifier", identifier)
      .maybeSingle();

    if (task) {
      taskId = task.id;
      const { error } = await supabase
        .from("tasks")
        .update({ state: "done", status: "done", updated_at: new Date().toISOString() })
        .eq("id", task.id)
        .eq("user_id", user.id);

      if (!error) {
        executed = true;
        result = `Marked ${identifier} as done`;
      } else {
        result = `Failed to mark task as done: ${error.message}`;
      }
    } else {
      result = `Task ${identifier} not found`;
    }
  }
  // Pattern: "cancel TYOS-XXX"
  else if (lowerInput.match(/cancel\s+(TYOS-\d+)/i)) {
    intent = "cancel_task";
    const match = input.match(/cancel\s+(TYOS-\d+)/i);
    if (match) {
      const identifier = match[1];
      const { data: task } = await supabase
        .from("tasks")
        .select("id")
        .eq("user_id", user.id)
        .eq("identifier", identifier)
        .maybeSingle();

      if (task) {
        taskId = task.id;
        const { error } = await supabase
          .from("tasks")
          .update({ state: "cancelled", status: "done", updated_at: new Date().toISOString() })
          .eq("id", task.id)
          .eq("user_id", user.id);

        if (!error) {
          executed = true;
          result = `Cancelled ${identifier}`;
        } else {
          result = `Failed to cancel task: ${error.message}`;
        }
      } else {
        result = `Task ${identifier} not found`;
      }
    }
  }
  // Pattern: starts with "add task:" or "new task:"
  else if (lowerInput.startsWith("add task:") || lowerInput.startsWith("new task:")) {
    intent = "add_task";
    const title = input.replace(/^(?:add|new)\s+task:\s*/i, "").trim();
    if (title.length > 0) {
      const { data: newTask, error } = await supabase
        .from("tasks")
        .insert({
          user_id: user.id,
          title,
          description: "",
          priority: "medium",
          priority_num: 3,
          state: "unstarted",
          status: "open",
          type: "task",
          recommended_ai: "claude",
          recommended_model: "claude-3-5-sonnet",
          ai_reason: "",
          how_to: "",
          audit_notes: "",
          memory_key: "",
          source_text: title,
          source: "command",
          is_open_loop: false,
        })
        .select()
        .single();

      if (!error && newTask) {
        executed = true;
        taskId = newTask.id;
        result = `Created task: ${title}`;
        metadata.taskId = newTask.id;
        metadata.identifier = newTask.identifier;
      } else {
        result = `Failed to create task: ${error?.message ?? "Unknown error"}`;
      }
    } else {
      result = "Task title cannot be empty";
    }
  }
  // Pattern: starts with "note:"
  else if (lowerInput.startsWith("note:")) {
    intent = "note";
    const noteContent = input.replace(/^note:\s*/i, "").trim();
    if (noteContent.length > 0) {
      try {
        const { error } = await supabase.from("memories").insert({
          user_id: user.id,
          content: noteContent,
          summary: noteContent.substring(0, 100),
          category: "general",
          source: "command",
          importance: 5,
          tags: ["command"],
        });

        if (!error) {
          executed = true;
          result = `Saved note: ${noteContent.substring(0, 50)}...`;
        } else {
          result = `Failed to save note: ${error.message}`;
        }
      } catch {
        result = "Failed to save note";
      }
    } else {
      result = "Note content cannot be empty";
    }
  }
  // Pattern: contains "draft", "send", or "deploy"
  else if (lowerInput.match(/draft|send|deploy/i)) {
    intent = "dispatch";
    result = `Dispatch action detected. Suggested action: ${input}`;
    executed = false;
    metadata.suggestedAction = input;
  }
  // Pattern: contains "more", "less", "remove", "fix" + section name
  else if (lowerInput.match(/(?:more|less|remove|fix)\s+/i)) {
    intent = "feedback";
    const sectionMatch = input.match(/(?:more|less|remove|fix)\s+(\w+)/i);
    result = `Feedback on section: ${sectionMatch?.[1] ?? "unknown"}`;
    executed = false;
    metadata.section = sectionMatch?.[1];
    metadata.action = input.match(/(?:more|less|remove|fix)/i)?.[0];
  }
  // Default: treat as question
  else {
    intent = "question";
    result = input;
    executed = false;
  }

  // Save command to database (if table exists)
  try {
    await supabase.from("commands").insert({
      user_id: user.id,
      input,
      intent,
      result,
      executed,
      task_id: taskId ?? null,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    // Command logging is non-critical
    console.error("Failed to log command:", e);
  }

  const response_data: CommandResponse = {
    intent,
    result,
    executed,
  };

  if (taskId) response_data.taskId = taskId;
  if (Object.keys(metadata).length > 0) response_data.metadata = metadata;

  return NextResponse.json(response_data);
}
