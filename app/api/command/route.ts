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
  | "delete_task"
  | "snooze_task"
  | "reprioritize_task"
  | "update_goal"
  | "question";

interface CommandResponse {
  intent: CommandIntent;
  result: string;
  executed: boolean;
  taskId?: string;
  goalId?: string;
  metadata?: Record<string, unknown>;
}

interface Task {
  id: string;
  identifier: string;
  title: string;
  state: string;
  priority_num: number;
  due_date: string | null;
}

interface Goal {
  id: string;
  title: string;
}

/**
 * Fuzzy match a query against task titles
 * Returns the best matching task or null
 */
async function findTaskByKeywords(
  supabase: any,
  userId: string,
  keywords: string
): Promise<Task | null> {
  if (!keywords || keywords.trim().length === 0) return null;

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, identifier, title, state, priority_num, due_date")
    .eq("user_id", userId)
    .neq("state", "done")
    .limit(50);

  if (!tasks || tasks.length === 0) return null;

  const queryWords = keywords.toLowerCase().split(/\s+/).filter(w => w.length > 0);

  // Score each task based on keyword matches in title
  const scored = tasks.map((task: Task) => {
    const titleLower = task.title.toLowerCase();
    let score = 0;

    for (const word of queryWords) {
      if (titleLower.includes(word)) {
        score += word.length; // Longer matches score higher
      }
    }

    // Bonus for contiguous phrase match
    if (titleLower.includes(keywords.toLowerCase())) {
      score += 100;
    }

    return { task, score };
  });

  const best = scored.sort((a, b) => b.score - a.score)[0];
  return best && best.score > 0 ? best.task : null;
}

/**
 * Parse a date string like "Friday", "tomorrow", "next Monday", "March 25"
 * Returns ISO date string or null if unable to parse
 */
function parseRelativeDate(dateStr: string): string | null {
  if (!dateStr) return null;

  const now = new Date();
  const lowerDate = dateStr.toLowerCase().trim();

  // Map day names to days ahead
  const dayNames: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 7,
  };

  // Handle "tomorrow"
  if (lowerDate === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  }

  // Handle day names (next occurrence)
  for (const [day, offset] of Object.entries(dayNames)) {
    if (lowerDate === day || lowerDate === `next ${day}`) {
      const target = new Date(now);
      const dayOfWeek = target.getDay();
      const daysAhead = (offset - dayOfWeek + 7) % 7 || 7;
      target.setDate(target.getDate() + daysAhead);
      return target.toISOString().split("T")[0];
    }
  }

  // Handle "today"
  if (lowerDate === "today") {
    return now.toISOString().split("T")[0];
  }

  // Try to parse as direct date (YYYY-MM-DD or similar)
  try {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
  } catch (e) {}

  return null;
}

/**
 * Extract priority level from string (P1, P2, P3, P4, urgent, high, etc.)
 */
function extractPriority(input: string): number | null {
  const lowerInput = input.toLowerCase();

  // Explicit P-level
  const pMatch = input.match(/\b(p[1-4])\b/i);
  if (pMatch) {
    const level = parseInt(pMatch[1].substring(1));
    return level;
  }

  // Priority keywords
  if (lowerInput.includes("urgent") || lowerInput.includes("asap")) return 1;
  if (lowerInput.includes("high")) return 2;
  if (lowerInput.includes("medium")) return 3;
  if (lowerInput.includes("low")) return 4;

  return null;
}

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

  let intent: CommandIntent = "question";
  let result = "";
  let executed = false;
  const metadata: Record<string, unknown> = {};
  let taskId: string | undefined;
  let goalId: string | undefined;

  // ============================================================================
  // EXISTING PATTERNS
  // ============================================================================

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
        .update({
          state: "done",
          status: "done",
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("user_id", user.id);

      if (!error) {
        executed = true;
        result = `Marked ${identifier} as done`;
      } else {
        result = `Failed: ${error.message}`;
      }
    } else {
      result = `Task ${identifier} not found`;
    }
  }
  // Pattern: "cancel TYOS-XXX"
  else if (lowerInput.match(/cancel\s+(TYOS-\d+)/)) {
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
          .update({
            state: "cancelled",
            status: "cancelled",
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id)
          .eq("user_id", user.id);

        if (!error) {
          executed = true;
          result = `Cancelled ${identifier}`;
        } else {
          result = `Failed: ${error.message}`;
        }
      } else {
        result = `Task ${identifier} not found`;
      }
    }
  }
  // Pattern: "add task:" or "add:"
  else if (lowerInput.match(/^add\s+(?:task)?:?\s+(.+)/i)) {
    intent = "add_task";
    const match = input.match(/^add\s+(?:task)?:?\s+(.+)/i);
    if (match) {
      const title = match[1].trim();
      const { data: newTask, error } = await supabase
        .from("tasks")
        .insert({
          user_id: user.id,
          title,
          state: "inbox",
          status: "open",
          source: "command",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();

      if (!error && newTask) {
        executed = true;
        taskId = newTask.id;
        result = `Added task: "${title}"`;
      } else {
        result = `Failed to add task: ${error?.message || "Unknown error"}`;
      }
    }
  }
  // Pattern: "note:" or "note TYOS-XXX:"
  else if (lowerInput.includes("note:")) {
    intent = "note";
    result = "Note recorded";
    executed = true;
  }
  // Pattern: "dispatch"
  else if (lowerInput.includes("dispatch")) {
    intent = "dispatch";
    result = "Dispatch initiated";
    executed = true;
  }
  // Pattern: "feedback:"
  else if (lowerInput.includes("feedback:")) {
    intent = "feedback";
    result = "Feedback recorded";
    executed = true;
  }

  // ============================================================================
  // NEW PATTERNS: DELETE/REMOVE
  // ============================================================================
  else if (
    lowerInput.match(/^(?:delete|remove|trash)\s+(?:the\s+)?(.+?)(?:\s+(?:task|permanently))?$/i)
  ) {
    const match = input.match(
      /^(?:delete|remove|trash)\s+(?:the\s+)?(.+?)(?:\s+(?:task|permanently))?$/i
    );
    if (match) {
      const keywords = match[1].trim();

      // First try to match TYOS identifier
      let task: Task | null = null;
      const idMatch = keywords.match(/TYOS-\d+/);
      if (idMatch) {
        const { data: found } = await supabase
          .from("tasks")
          .select("id, identifier, title, state, priority_num, due_date")
          .eq("user_id", user.id)
          .eq("identifier", idMatch[0])
          .maybeSingle();
        task = found || null;
      } else {
        task = await findTaskByKeywords(supabase, user.id, keywords);
      }

      if (task) {
        intent = "delete_task";
        taskId = task.id;
        const { error } = await supabase
          .from("tasks")
          .delete()
          .eq("id", task.id)
          .eq("user_id", user.id);

        if (!error) {
          executed = true;
          result = `Deleted task: "${task.title}"`;
          metadata.deleted_task = task.identifier;
        } else {
          result = `Failed to delete: ${error.message}`;
        }
      } else {
        result = `Could not find task matching: "${keywords}"`;
      }
    }
  }

  // ============================================================================
  // NEW PATTERNS: SNOOZE
  // ============================================================================
  else if (
    lowerInput.match(/^(?:snooze|defer|postpone)\s+(.+?)(?:\s+until\s+(.+?))?$/i)
  ) {
    const match = input.match(
      /^(?:snooze|defer|postpone)\s+(.+?)(?:\s+until\s+(.+?))?$/i
    );
    if (match) {
      const taskKeywords = match[1].trim();
      const dateStr = match[2]?.trim();

      // Find the task
      let task: Task | null = null;
      const idMatch = taskKeywords.match(/TYOS-\d+/);
      if (idMatch) {
        const { data: found } = await supabase
          .from("tasks")
          .select("id, identifier, title, state, priority_num, due_date")
          .eq("user_id", user.id)
          .eq("identifier", idMatch[0])
          .maybeSingle();
        task = found || null;
      } else {
        task = await findTaskByKeywords(supabase, user.id, taskKeywords);
      }

      if (task) {
        const newDueDate = parseRelativeDate(dateStr || "tomorrow");
        if (newDueDate) {
          intent = "snooze_task";
          taskId = task.id;
          const { error } = await supabase
            .from("tasks")
            .update({
              due_date: newDueDate,
              updated_at: new Date().toISOString(),
            })
            .eq("id", task.id)
            .eq("user_id", user.id);

          if (!error) {
            executed = true;
            result = `Snoozed "${task.title}" until ${newDueDate}`;
            metadata.new_due_date = newDueDate;
          } else {
            result = `Failed to snooze: ${error.message}`;
          }
        } else {
          result = `Could not parse date: "${dateStr}"`;
        }
      } else {
        result = `Could not find task matching: "${taskKeywords}"`;
      }
    }
  }

  // ============================================================================
  // NEW PATTERNS: REPRIORITIZE
  // ============================================================================
  else if (
    lowerInput.match(/^(?:reprioritize|priority|prioritize|make\s+.+\s+(?:urgent|p[1-4]|high|medium|low))/i)
  ) {
    // More flexible matching: "make X urgent", "reprioritize X to P1", "priority X = high", etc.
    const match = input.match(
      /(?:reprioritize|priority|prioritize|make)\s+(?:the\s+)?(.+?)(?:\s+(?:to|=)\s+)?(?:p[1-4]|urgent|asap|high|medium|low)?(?:\s+(.+))?$/i
    );

    if (match) {
      const taskPart = match[1].trim();
      const priorityPart = input;

      const newPriority = extractPriority(priorityPart);
      if (newPriority === null) {
        result = "Could not extract priority level (try P1-P4 or urgent/high/medium/low)";
      } else {
        // Find the task
        let task: Task | null = null;
        const idMatch = taskPart.match(/TYOS-\d+/);
        if (idMatch) {
          const { data: found } = await supabase
            .from("tasks")
            .select("id, identifier, title, state, priority_num, due_date")
            .eq("user_id", user.id)
            .eq("identifier", idMatch[0])
            .maybeSingle();
          task = found || null;
        } else {
          task = await findTaskByKeywords(supabase, user.id, taskPart);
        }

        if (task) {
          intent = "reprioritize_task";
          taskId = task.id;
          const { error } = await supabase
            .from("tasks")
            .update({
              priority_num: newPriority,
              updated_at: new Date().toISOString(),
            })
            .eq("id", task.id)
            .eq("user_id", user.id);

          if (!error) {
            executed = true;
            const priorityLabel = ["", "P1 (Critical)", "P2 (High)", "P3 (Medium)", "P4 (Low)"][
              newPriority
            ];
            result = `Set "${task.title}" to ${priorityLabel}`;
            metadata.new_priority = newPriority;
          } else {
            result = `Failed to update priority: ${error.message}`;
          }
        } else {
          result = `Could not find task matching: "${taskPart}"`;
        }
      }
    }
  }

  // ============================================================================
  // NEW PATTERNS: UPDATE GOAL
  // ============================================================================
  else if (
    lowerInput.match(/(?:update|change|set)\s+(?:my\s+)?(.+?)\s+goal\s+to\s+(.+)/i) ||
    lowerInput.match(/(?:goal|target)\s+(.+?)\s+(?:to|=|:)\s+(.+)/i)
  ) {
    let goalMatch = input.match(
      /(?:update|change|set)\s+(?:my\s+)?(.+?)\s+goal\s+to\s+(.+)/i
    );
    if (!goalMatch) {
      goalMatch = input.match(/(?:goal|target)\s+(.+?)\s+(?:to|=|:)\s+(.+)/i);
    }

    if (goalMatch) {
      const goalKeywords = goalMatch[1].trim();
      const newValue = goalMatch[2].trim();

      // Find the goal
      const { data: goals } = await supabase
        .from("goals")
        .select("id, title")
        .eq("user_id", user.id)
        .limit(20);

      let goal: Goal | null = null;
      if (goals && goals.length > 0) {
        // Simple keyword matching for goal
        const scored = goals.map((g: Goal) => {
          const titleLower = g.title.toLowerCase();
          const queryLower = goalKeywords.toLowerCase();
          const score = titleLower.includes(queryLower) ? 100 : 0;
          return { goal: g, score };
        });

        const best = scored.sort((a, b) => b.score - a.score)[0];
        goal = best && best.score > 0 ? best.goal : goals[0]; // Default to first if no match
      }

      if (goal) {
        intent = "update_goal";
        goalId = goal.id;

        // Determine which field to update (progress_target, progress_current, etc.)
        // For simplicity, update progress_target by default
        const { error } = await supabase
          .from("goals")
          .update({
            progress_target: newValue,
            updated_at: new Date().toISOString(),
          })
          .eq("id", goal.id)
          .eq("user_id", user.id);

        if (!error) {
          executed = true;
          result = `Updated goal "${goal.title}" target to "${newValue}"`;
          metadata.updated_field = "progress_target";
          metadata.new_value = newValue;
        } else {
          result = `Failed to update goal: ${error.message}`;
        }
      } else {
        result = `No goals found to update`;
      }
    }
  }

  // ============================================================================
  // DEFAULT: QUESTION
  // ============================================================================
  else {
    intent = "question";
    result = input;
    executed = false;
  }

  // ============================================================================
  // LOG COMMAND
  // ============================================================================
  try {
    await supabase.from("commands").insert({
      user_id: user.id,
      input,
      intent,
      result,
      executed,
      task_id: taskId ?? null,
      goal_id: goalId ?? null,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to log command:", e);
  }

  const response_data: CommandResponse = { intent, result, executed };
  if (taskId) response_data.taskId = taskId;
  if (goalId) response_data.goalId = goalId;
  if (Object.keys(metadata).length > 0) response_data.metadata = metadata;

  return NextResponse.json(response_data);
}
