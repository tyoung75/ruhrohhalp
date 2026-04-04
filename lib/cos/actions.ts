/**
 * Chief of Staff Actions
 *
 * Executable actions the CoS agent can invoke autonomously during conversation.
 * Each action maps to an existing ruhrohhalp API or database operation.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { google } from "googleapis";
import { getGoogleOauthCredentials } from "@/lib/google/oauth";

type ActionResult = { ok: true; message: string; data?: unknown } | { ok: false; error: string };

const supabase = () => createAdminClient();

// ── Task Actions ──

async function createTask(userId: string, args: { title: string; description?: string; priority?: string; due_date?: string; goal_id?: string }): Promise<ActionResult> {
  const { data, error } = await supabase()
    .from("tasks")
    .insert({
      user_id: userId,
      title: args.title,
      description: args.description ?? "",
      priority: args.priority ?? "medium",
      due_date: args.due_date ?? null,
      goal_id: args.goal_id ?? null,
      status: "open",
      state: "unstarted",
      type: "task",
      source_text: `Chief of Staff: ${args.title}`,
    })
    .select("id, identifier, title")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Created task: ${data.title} (${data.identifier ?? data.id})`, data };
}

async function updateTask(userId: string, args: { task_id: string; state?: string; priority?: string; due_date?: string; title?: string }): Promise<ActionResult> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.state) { updates.state = args.state; updates.status = args.state === "done" || args.state === "cancelled" ? "done" : "open"; }
  if (args.priority) updates.priority = args.priority;
  if (args.due_date) updates.due_date = args.due_date;
  if (args.title) updates.title = args.title;

  const { error } = await supabase().from("tasks").update(updates).eq("id", args.task_id).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Updated task ${args.task_id}: ${Object.keys(updates).filter(k => k !== "updated_at").join(", ")}` };
}

async function deleteTask(userId: string, args: { task_id: string }): Promise<ActionResult> {
  const { error } = await supabase().from("tasks").update({ state: "cancelled", status: "done", updated_at: new Date().toISOString() }).eq("id", args.task_id).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Cancelled task ${args.task_id}` };
}

async function searchTasks(userId: string, args: { query: string }): Promise<ActionResult> {
  const { data } = await supabase().from("tasks").select("id, identifier, title, state, priority, due_date").eq("user_id", userId).not("state", "in", '("done","cancelled")').ilike("title", `%${args.query}%`).limit(5);
  return { ok: true, message: `Found ${data?.length ?? 0} tasks`, data };
}

// ── Brand Actions ──

async function scoutBrands(userId: string): Promise<ActionResult> {
  try {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ruhrohhalp.com"}/api/brands/scout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": `sb-user-id=${userId}` },
      body: JSON.stringify({}),
    });
    // Fallback: do it directly
    const { callClaude } = await import("@/lib/processors/claude");
    const { TYLER_STATS, formatStatsBlock } = await import("@/lib/brands/voice");
    const { data: existing } = await supabase().from("brand_deals").select("brand_name").eq("user_id", userId);
    const existingNames = (existing ?? []).map(d => d.brand_name).join(", ");

    const raw = await callClaude(
      "You find brand partnership prospects for Tyler Young. Return a JSON array of {brand_name, why, angle, priority, estimated_value_low, estimated_value_high}.",
      `Find 3 brands. Tyler stats: ${formatStatsBlock(TYLER_STATS)}. Already in pipeline: ${existingNames}. Return ONLY JSON array.`,
      1024,
    );
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const recs = JSON.parse(cleaned);
    const now = new Date().toISOString();
    for (const rec of recs) {
      if ((existing ?? []).some(e => e.brand_name.toLowerCase() === rec.brand_name?.toLowerCase())) continue;
      await supabase().from("brand_deals").insert({
        user_id: userId, brand_name: rec.brand_name, status: "scouted", priority: rec.priority ?? "P1",
        angle: rec.angle, scout_reason: rec.why, estimated_value_low: rec.estimated_value_low, estimated_value_high: rec.estimated_value_high,
        created_at: now, updated_at: now,
      });
    }
    return { ok: true, message: `Scouted ${recs.length} new brand prospects`, data: recs };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function updateBrandDeal(userId: string, args: { brand_name: string; status?: string; next_action?: string; archive_reason?: string }): Promise<ActionResult> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.status) updates.status = args.status;
  if (args.next_action) updates.next_action = args.next_action;
  if (args.status === "archived") { updates.archived_at = new Date().toISOString(); updates.archive_reason = args.archive_reason ?? "Archived by Chief of Staff"; }

  const { error } = await supabase().from("brand_deals").update(updates).eq("user_id", userId).ilike("brand_name", args.brand_name);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Updated ${args.brand_name}: ${Object.keys(updates).filter(k => k !== "updated_at").join(", ")}` };
}

// ── Content Actions ──

async function addContentDirective(userId: string, args: { directive: string; platforms?: string[] }): Promise<ActionResult> {
  const { error } = await supabase().from("content_directives").insert({
    user_id: userId, directive: args.directive, platforms: args.platforms ?? null, active: true, applied: false, created_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Added content directive: "${args.directive}"` };
}

// ── Goal Actions ──

async function updateGoalProgress(userId: string, args: { goal_title: string; progress_current: string }): Promise<ActionResult> {
  const { data: goal } = await supabase().from("goals").select("id, title").eq("user_id", userId).ilike("title", `%${args.goal_title}%`).limit(1).single();
  if (!goal) return { ok: false, error: `Goal "${args.goal_title}" not found` };
  const { error } = await supabase().from("goals").update({ progress_current: args.progress_current, updated_at: new Date().toISOString() }).eq("id", goal.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Updated "${goal.title}" progress to ${args.progress_current}` };
}

// ── Memory Actions ──

async function storeDecision(userId: string, args: { decision: string; reasoning: string; context?: string }): Promise<ActionResult> {
  const { embedAndStore } = await import("@/lib/embedding/pipeline");
  await embedAndStore(
    `[DECISION] ${args.decision}\nReasoning: ${args.reasoning}${args.context ? `\nContext: ${args.context}` : ""}`,
    { userId, source: "manual", sourceId: `decision:${Date.now()}`, category: "general", importance: 8, tags: ["system:feedback", "decision"] },
  );
  return { ok: true, message: `Stored decision: "${args.decision}"` };
}

// ── Content Actions ──

async function approveContent(userId: string, args: { content_id: string }): Promise<ActionResult> {
  const { error } = await supabase().from("content_queue").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", args.content_id).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Approved content ${args.content_id} — ready for publishing` };
}

async function rejectContent(userId: string, args: { content_id: string; reason?: string }): Promise<ActionResult> {
  const { error } = await supabase().from("content_queue").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", args.content_id).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  if (args.reason) {
    const { embedAndStore } = await import("@/lib/embedding/pipeline");
    await embedAndStore(`[CONTENT REJECTED] Reason: ${args.reason}`, { userId, source: "manual", sourceId: `content-reject:${args.content_id}`, category: "general", importance: 7, tags: ["feedback:disliked", "domain:content", "system:feedback"] });
  }
  return { ok: true, message: `Rejected content${args.reason ? `: ${args.reason}` : ""}` };
}

async function editContent(userId: string, args: { content_id: string; instructions: string }): Promise<ActionResult> {
  const { data: post } = await supabase().from("content_queue").select("body, platform, content_type").eq("id", args.content_id).eq("user_id", userId).single();
  if (!post) return { ok: false, error: "Content not found" };
  const { callClaude } = await import("@/lib/processors/claude");
  const revised = await callClaude(
    "You edit social media posts for Tyler Young. Apply the edit instructions precisely. Return ONLY the revised post text, nothing else.",
    `Original post (${post.platform}/${post.content_type}):\n${post.body}\n\nEdit instructions: ${args.instructions}`,
    512,
  );
  const { error } = await supabase().from("content_queue").update({ body: revised.trim(), status: "draft", updated_at: new Date().toISOString() }).eq("id", args.content_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Edited content: "${revised.trim().slice(0, 80)}..."`, data: { revised: revised.trim() } };
}

async function generateContent(userId: string, args: { topic: string; platform?: string }): Promise<ActionResult> {
  const { callClaude } = await import("@/lib/processors/claude");
  const post = await callClaude(
    "You write social media posts for Tyler Young. Style: lowercase except I, direct, specific numbers, authentic texture, no clichés. Return ONLY the post text.",
    `Write a ${args.platform ?? "Threads"} post about: ${args.topic}`,
    512,
  );
  const { data, error } = await supabase().from("content_queue").insert({
    user_id: userId, platform: args.platform ?? "threads", content_type: "text", body: post.trim(), status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Generated ${args.platform ?? "Threads"} post: "${post.trim().slice(0, 80)}..."`, data: { id: data.id, body: post.trim() } };
}

// ── Habit Actions ──

async function logHabit(userId: string, args: { habit_name: string; value?: number; note?: string }): Promise<ActionResult> {
  const { data: habit } = await supabase().from("habits").select("id, name").eq("user_id", userId).ilike("name", `%${args.habit_name}%`).eq("active", true).limit(1).single();
  if (!habit) return { ok: false, error: `Habit "${args.habit_name}" not found` };
  const { error } = await supabase().from("habit_logs").insert({ habit_id: habit.id, user_id: userId, logged_at: new Date().toISOString(), value: args.value ?? 1, note: args.note ?? null, source: "manual" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Logged "${habit.name}"${args.note ? `: ${args.note}` : ""}` };
}

async function listHabits(userId: string): Promise<ActionResult> {
  const { data } = await supabase().from("habits").select("id, name, frequency, target_count, icon").eq("user_id", userId).eq("active", true);
  return { ok: true, message: `${data?.length ?? 0} active habits`, data };
}

// ── Reminder Actions ──

function getGoogleAuth() {
  const oauth = getGoogleOauthCredentials();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!oauth || !refreshToken) return null;
  const client = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * Find or create a Google Tasks list by name.
 * Returns the task list ID.
 */
async function findOrCreateTaskList(tasksApi: ReturnType<typeof google.tasks>, listName: string): Promise<string> {
  // Check existing lists
  const { data: lists } = await tasksApi.tasklists.list({ maxResults: 100 });
  const existing = (lists.items ?? []).find((l) => l.title?.toLowerCase() === listName.toLowerCase());
  if (existing?.id) return existing.id;

  // Create new list
  const { data: created } = await tasksApi.tasklists.insert({ requestBody: { title: listName } });
  return created.id!;
}

async function setReminder(userId: string, args: { title: string; date: string; note?: string; list?: string }): Promise<ActionResult> {
  const results: string[] = [];
  let googleTaskId: string | null = null;
  let taskListName = args.list ?? "General To-Do";

  // 1. Create Google Task (shows in Calendar with checkbox)
  // Requires https://www.googleapis.com/auth/tasks scope on the OAuth token.
  // Re-authorize at /api/auth/gmail if tasks aren't appearing.
  try {
    const auth = getGoogleAuth();
    if (auth) {
      const tasksApi = google.tasks({ version: "v1", auth });

      // Find or create the appropriate list
      const listId = await findOrCreateTaskList(tasksApi, taskListName);

      const { data: gTask } = await tasksApi.tasks.insert({
        tasklist: listId,
        requestBody: {
          title: args.title,
          notes: args.note ?? `Set by Chief of Staff`,
          due: `${args.date}T00:00:00.000Z`,
        },
      });
      googleTaskId = gTask.id ?? null;
      results.push(`Google Task created in "${taskListName}" list for ${args.date}`);
    }
  } catch (e) {
    logError("cos.set_reminder.tasks", e);
    results.push("Google Task creation failed");
  }

  // 2. Create ruhrohhalp task linked to the Google Task
  const { data: task, error } = await supabase()
    .from("tasks")
    .insert({
      user_id: userId,
      title: args.title,
      description: args.note ?? `Reminder: ${args.title}`,
      priority: "high",
      due_date: args.date,
      status: "open",
      state: "unstarted",
      type: "reminder",
      source_text: `Chief of Staff reminder: ${args.title}`,
      ai_metadata: googleTaskId ? { google_task_id: googleTaskId, google_task_list: taskListName } : null,
    })
    .select("id, identifier, title")
    .single();

  if (error) return { ok: false, error: error.message };
  results.push(`Task ${task.identifier ?? task.id}: ${task.title} (due ${args.date})`);

  return { ok: true, message: results.join(". "), data: { task_id: task.id, google_task_id: googleTaskId } };
}

// ── People Actions ──

async function addPerson(userId: string, args: { name: string; email?: string; company?: string; relationship?: string; notes?: string }): Promise<ActionResult> {
  const { data, error } = await supabase().from("people").insert({
    user_id: userId, name: args.name, email: args.email ?? null, company: args.company ?? null, relationship: args.relationship ?? "other", notes: args.notes ?? "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).select("id, name").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: `Added ${data.name} to contacts`, data };
}

// ── Registry ──

export const COS_ACTIONS: Record<string, {
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>;
  execute: (userId: string, args: Record<string, unknown>) => Promise<ActionResult>;
}> = {
  create_task: {
    description: "Create a new task in ruhrohhalp",
    parameters: {
      title: { type: "string", description: "Task title", required: true },
      description: { type: "string", description: "Task description" },
      priority: { type: "string", description: "Priority level", enum: ["high", "medium", "low"] },
      due_date: { type: "string", description: "Due date (YYYY-MM-DD format)" },
    },
    execute: (uid, args) => createTask(uid, args as Parameters<typeof createTask>[1]),
  },
  update_task: {
    description: "Update an existing task (change state, priority, due date, or title)",
    parameters: {
      task_id: { type: "string", description: "Task ID or identifier", required: true },
      state: { type: "string", description: "New state", enum: ["unstarted", "started", "in_review", "done", "cancelled"] },
      priority: { type: "string", description: "New priority", enum: ["high", "medium", "low"] },
      due_date: { type: "string", description: "New due date (YYYY-MM-DD)" },
      title: { type: "string", description: "New title" },
    },
    execute: (uid, args) => updateTask(uid, args as Parameters<typeof updateTask>[1]),
  },
  delete_task: {
    description: "Cancel/delete a task",
    parameters: { task_id: { type: "string", description: "Task ID to cancel", required: true } },
    execute: (uid, args) => deleteTask(uid, args as Parameters<typeof deleteTask>[1]),
  },
  search_tasks: {
    description: "Search for tasks by keyword",
    parameters: { query: { type: "string", description: "Search query", required: true } },
    execute: (uid, args) => searchTasks(uid, args as Parameters<typeof searchTasks>[1]),
  },
  scout_brands: {
    description: "Run the brand scout to find new partnership prospects using AI",
    parameters: {},
    execute: (uid) => scoutBrands(uid),
  },
  update_brand_deal: {
    description: "Update a brand deal status, next action, or archive it",
    parameters: {
      brand_name: { type: "string", description: "Brand name to update", required: true },
      status: { type: "string", description: "New status", enum: ["scouted", "prospect", "draft_ready", "sent", "replied", "negotiating", "closed_won", "archived", "delayed"] },
      next_action: { type: "string", description: "Next action text" },
      archive_reason: { type: "string", description: "Reason for archiving (if status=archived)" },
    },
    execute: (uid, args) => updateBrandDeal(uid, args as Parameters<typeof updateBrandDeal>[1]),
  },
  add_content_directive: {
    description: "Add a standing content strategy directive that shapes all future content generation",
    parameters: {
      directive: { type: "string", description: "The directive text", required: true },
    },
    execute: (uid, args) => addContentDirective(uid, args as Parameters<typeof addContentDirective>[1]),
  },
  update_goal_progress: {
    description: "Update progress on an active goal",
    parameters: {
      goal_title: { type: "string", description: "Goal title (partial match)", required: true },
      progress_current: { type: "string", description: "New current progress value", required: true },
    },
    execute: (uid, args) => updateGoalProgress(uid, args as Parameters<typeof updateGoalProgress>[1]),
  },
  store_decision: {
    description: "Store an important decision in memory so the system remembers it",
    parameters: {
      decision: { type: "string", description: "The decision made", required: true },
      reasoning: { type: "string", description: "Why this decision was made", required: true },
      context: { type: "string", description: "Additional context" },
    },
    execute: (uid, args) => storeDecision(uid, args as Parameters<typeof storeDecision>[1]),
  },
  approve_content: {
    description: "Approve a content queue item for publishing",
    parameters: { content_id: { type: "string", description: "Content queue item ID", required: true } },
    execute: (uid, args) => approveContent(uid, args as Parameters<typeof approveContent>[1]),
  },
  reject_content: {
    description: "Reject a content queue item with optional reason",
    parameters: { content_id: { type: "string", description: "Content queue item ID", required: true }, reason: { type: "string", description: "Why it was rejected" } },
    execute: (uid, args) => rejectContent(uid, args as Parameters<typeof rejectContent>[1]),
  },
  edit_content: {
    description: "Edit a content queue post with natural language instructions",
    parameters: { content_id: { type: "string", description: "Content queue item ID", required: true }, instructions: { type: "string", description: "Edit instructions (e.g. 'make it shorter', 'add Berlin angle')", required: true } },
    execute: (uid, args) => editContent(uid, args as Parameters<typeof editContent>[1]),
  },
  generate_content: {
    description: "Generate a new social media post on a topic",
    parameters: { topic: { type: "string", description: "What to post about", required: true }, platform: { type: "string", description: "Platform", enum: ["threads", "instagram", "tiktok"] } },
    execute: (uid, args) => generateContent(uid, args as Parameters<typeof generateContent>[1]),
  },
  log_habit: {
    description: "Log a habit completion (e.g. ran today, hydrated, stretched)",
    parameters: { habit_name: { type: "string", description: "Habit name (partial match)", required: true }, value: { type: "number", description: "Value (default 1)" }, note: { type: "string", description: "Optional note" } },
    execute: (uid, args) => logHabit(uid, args as Parameters<typeof logHabit>[1]),
  },
  list_habits: {
    description: "List all active habits with their details",
    parameters: {},
    execute: (uid) => listHabits(uid),
  },
  set_reminder: {
    description: "Set a reminder — creates a ruhrohhalp task AND a Google Task (shows in Calendar with a checkbox to mark complete). Assign to the most appropriate task list category.",
    parameters: {
      title: { type: "string", description: "What to be reminded about", required: true },
      date: { type: "string", description: "Date in YYYY-MM-DD format", required: true },
      note: { type: "string", description: "Optional extra context" },
      list: { type: "string", description: "Google Tasks list name (e.g. 'General To-Do', 'Work', 'Travel', 'Subscriptions', 'Health'). Pick the best fit or create a new one if none fits." },
    },
    execute: (uid, args) => setReminder(uid, args as Parameters<typeof setReminder>[1]),
  },
  add_person: {
    description: "Add a person/contact to the relationship manager",
    parameters: { name: { type: "string", description: "Person's name", required: true }, email: { type: "string", description: "Email address" }, company: { type: "string", description: "Company" }, relationship: { type: "string", description: "Relationship type", enum: ["colleague", "client", "friend", "family", "mentor", "mentee", "other"] }, notes: { type: "string", description: "Notes about this person" } },
    execute: (uid, args) => addPerson(uid, args as Parameters<typeof addPerson>[1]),
  },
};

/** Convert COS_ACTIONS to Claude tool_use format */
export function getClaudeTools() {
  return Object.entries(COS_ACTIONS).map(([name, action]) => ({
    name,
    description: action.description,
    input_schema: {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(action.parameters).map(([key, param]) => [key, {
          type: param.type,
          description: param.description,
          ...(param.enum ? { enum: param.enum } : {}),
        }]),
      ),
      required: Object.entries(action.parameters).filter(([, p]) => p.required).map(([k]) => k),
    },
  }));
}

/** Execute an action by name */
export async function executeAction(userId: string, actionName: string, args: Record<string, unknown>): Promise<ActionResult> {
  const action = COS_ACTIONS[actionName];
  if (!action) return { ok: false, error: `Unknown action: ${actionName}` };
  try {
    return await action.execute(userId, args);
  } catch (e) {
    logError(`cos.action.${actionName}`, e);
    return { ok: false, error: String(e) };
  }
}
