import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { generateEmbeddings } from "@/lib/embedding/openai";
import { getGoogleOauthCredentials } from "@/lib/google/oauth";
import { runJob } from "@/lib/jobs/executor";
import { logError } from "@/lib/logger";
import { callClaude } from "@/lib/processors/claude";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateWebhookSecret } from "@/lib/webhook/auth";

const TIME_ZONE = "America/New_York";
const GMAIL_QUERY = "newer_than:1d -category:promotions -in:spam -in:trash";
const MAX_GMAIL_MESSAGES = 20;
const MAX_CALENDAR_EVENTS = 20;
const MAX_TASKS = 30;
const TASK_LOOKBACK_MS = 48 * 60 * 60 * 1000;

type SignalSource = "gmail" | "calendar" | "task";

type MessagePayload = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: MessagePayload[] | null;
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
};

type EventAttendee = {
  displayName?: string | null;
  email?: string | null;
};

type GmailSignal = {
  id: string;
  threadId: string | null;
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
  body: string;
};

type CalendarSignal = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
  attendees: string[];
  description: string;
};

type TaskSignal = {
  id: string;
  title: string;
  description: string;
  priority: number | null;
  state: string | null;
  dueDate: string | null;
  goalTitle: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

type BrainSyncSignals = {
  gmail: GmailSignal[];
  calendar: CalendarSignal[];
  tasks: TaskSignal[];
};

type SynthesizedObservation = {
  title: string;
  observation: string;
  whyItMatters: string;
  suggestedFollowUp: string | null;
  signals: SignalSource[];
  tags: string[];
  importance: number;
};

const SYNTHESIS_SYSTEM = `You synthesize Tyler Young's recent operating context into durable memory observations.

Return ONLY a valid JSON array. Do not wrap it in markdown fences.

Each array item must be:
{
  "title": string,
  "observation": string,
  "why_it_matters": string,
  "suggested_follow_up": string | null,
  "signals": ["gmail" | "calendar" | "task"],
  "tags": string[],
  "importance": integer 1-10
}

Rules:
- Produce 3 to 8 observations when enough signal exists. If the signals are sparse, return fewer.
- Prefer cross-signal synthesis when it is supported by the evidence.
- Be concrete: mention people, projects, deadlines, and commitments when present.
- Do not invent facts. If something is uncertain, omit it.
- Ignore low-signal chatter, obvious admin noise, and generic reminders.
- Keep "observation" and "why_it_matters" concise but specific.
- Tags must be short lowercase slugs.`;

export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const dryRun = parseBoolean(body.dry_run);
  const syncDateEt = getDateKey(new Date(), TIME_ZONE);
  const idempotencyKey = `brain-sync:${syncDateEt}:${dryRun}`;

  const result = await runJob(
    "brain-sync",
    async () => {
      const supabase = createAdminClient();
      const userId = await resolveUserId();
      const oauth = getGoogleClient();

      const [gmailSignals, calendarSignals, taskSignals] = await Promise.all([
        fetchGmailSignals(oauth),
        fetchCalendarSignals(oauth),
        fetchTaskSignals(userId),
      ]);

      // Sync [RRH] calendar reminders back to tasks
      await syncCalendarRemindersToTasks(supabase, calendarSignals, userId);

      const signals: BrainSyncSignals = {
        gmail: gmailSignals,
        calendar: calendarSignals,
        tasks: taskSignals,
      };

      const signalCounts = {
        gmail: gmailSignals.length,
        calendar: calendarSignals.length,
        tasks: taskSignals.length,
      };

      if (gmailSignals.length === 0 && calendarSignals.length === 0 && taskSignals.length === 0) {
        return {
          ok: true,
          dryRun,
          signal_counts: signalCounts,
          observation_count: 0,
          inserted: 0,
          observations: [],
        };
      }

      const observations = await synthesizeObservations(signals, syncDateEt);
      const previews = observations.map((item) => ({
        title: item.title,
        importance: item.importance,
        signals: item.signals,
        tags: item.tags,
      }));

      if (dryRun || observations.length === 0) {
        return {
          ok: true,
          dryRun,
          signal_counts: signalCounts,
          observation_count: observations.length,
          inserted: 0,
          observations: previews,
        };
      }

      const memoryTexts = observations.map((item) => formatObservationMemory(item, syncDateEt));
      const embeddings = await generateEmbeddings(memoryTexts);
      const { data, error } = await supabase
        .from("memories")
        .insert(
          observations.map((item, index) => ({
            user_id: userId,
            content: memoryTexts[index],
            summary: truncate(`${item.title}: ${item.whyItMatters}`, 200),
            source: "manual",
            source_id: `${idempotencyKey}:${index + 1}`,
            category: "work",
            importance: clampImportance(item.importance),
            tags: unique([
              "brain-sync",
              ...item.tags,
              ...item.signals.map((signal) => `signal:${signal}`),
            ]),
            embedding: JSON.stringify(embeddings[index]),
          })),
        )
        .select("id");

      if (error) throw new Error(`Failed to insert brain-sync memories: ${error.message}`);

      return {
        ok: true,
        dryRun,
        signal_counts: signalCounts,
        observation_count: observations.length,
        inserted: data?.length ?? 0,
        memory_ids: (data ?? []).map((row: { id: string }) => row.id),
        observations: previews,
      };
    },
    { idempotencyKey },
  );

  return NextResponse.json(result);
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function getGoogleClient() {
  const oauth = getGoogleOauthCredentials();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!oauth || !refreshToken) {
    throw new Error("Missing Google OAuth credentials for brain-sync");
  }

  const client = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

async function resolveUserId(): Promise<string> {
  if (process.env.CREATOR_USER_ID) return process.env.CREATOR_USER_ID;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .limit(1)
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? "No profile found for brain-sync");
  }

  return data.id;
}

async function fetchGmailSignals(auth: ReturnType<typeof getGoogleClient>): Promise<GmailSignal[]> {
  const gmail = google.gmail({ version: "v1", auth });
  const { data } = await gmail.users.messages.list({
    userId: "me",
    q: GMAIL_QUERY,
    includeSpamTrash: false,
    maxResults: MAX_GMAIL_MESSAGES,
  });

  const messages = data.messages ?? [];
  if (messages.length === 0) return [];

  const details = await Promise.allSettled(
    messages
      .map((message: { id?: string | null }) => message.id)
      .filter((id: string | null | undefined): id is string => Boolean(id))
      .map((id: string) => gmail.users.messages.get({ userId: "me", id, format: "full" })),
  );

  const signals: GmailSignal[] = [];

  for (const result of details) {
    if (result.status !== "fulfilled") {
      logError("brain-sync.gmail.message", result.reason);
      continue;
    }

    const message = result.value.data;
    if (!message.id) continue;

    const labelIds = message.labelIds ?? [];
    if (labelIds.includes("SPAM") || labelIds.includes("TRASH") || labelIds.includes("CATEGORY_PROMOTIONS")) {
      continue;
    }

    const payload = message.payload;
    const bodyText = truncate(cleanText(extractMessageText(payload) || message.snippet || ""), 1200);
    const snippet = truncate(cleanText(message.snippet ?? ""), 400);

    signals.push({
      id: message.id,
      threadId: message.threadId ?? null,
      subject: getHeader(payload, "Subject") || "(No subject)",
      from: getHeader(payload, "From") || "Unknown sender",
      receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString(),
      snippet,
      body: bodyText,
    });
  }

  return signals.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

async function fetchCalendarSignals(auth: ReturnType<typeof getGoogleClient>): Promise<CalendarSignal[]> {
  const calendar = google.calendar({ version: "v3", auth });
  const { timeMin, timeMax } = getCalendarWindow();

  const { data } = await calendar.events.list({
    calendarId: "primary",
    maxResults: MAX_CALENDAR_EVENTS,
    singleEvents: true,
    orderBy: "startTime",
    timeMin,
    timeMax,
    timeZone: TIME_ZONE,
  });

  return (data.items ?? [])
    .filter((event: { status?: string | null }) => event.status !== "cancelled")
    .map((event: {
      id?: string | null;
      summary?: string | null;
      start?: { dateTime?: string | null; date?: string | null } | null;
      end?: { dateTime?: string | null; date?: string | null } | null;
      location?: string | null;
      attendees?: EventAttendee[] | null;
      description?: string | null;
    }) => ({
      id: event.id ?? crypto.randomUUID(),
      title: event.summary || "(Untitled event)",
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? "",
      location: event.location ?? "",
      attendees: summarizeAttendees(event.attendees),
      description: truncate(cleanText(event.description ?? ""), 800),
    }));
}

/**
 * Sync Google Tasks completion back to ruhrohhalp tasks.
 * When a Google Task is marked complete in Calendar, find the linked
 * ruhrohhalp task and mark it done too.
 */
async function syncCalendarRemindersToTasks(
  supabase: ReturnType<typeof createAdminClient>,
  _calendarSignals: CalendarSignal[],
  userId: string,
) {
  try {
    const auth = getGoogleClient();
    const tasksApi = google.tasks({ version: "v1", auth });

    // Get all task lists
    const { data: lists } = await tasksApi.tasklists.list({ maxResults: 100 });

    for (const list of lists.items ?? []) {
      if (!list.id) continue;

      // Get completed tasks from the last 7 days
      const { data: completed } = await tasksApi.tasks.list({
        tasklist: list.id,
        showCompleted: true,
        showHidden: true,
        updatedMin: new Date(Date.now() - 7 * 86400000).toISOString(),
      });

      for (const gTask of completed.items ?? []) {
        if (gTask.status !== "completed" || !gTask.id) continue;

        // Find linked ruhrohhalp task via ai_metadata
        const { data: rrhTask } = await supabase
          .from("tasks")
          .select("id, state")
          .eq("user_id", userId)
          .not("state", "in", '("done","cancelled")')
          .contains("ai_metadata", { google_task_id: gTask.id })
          .maybeSingle();

        if (rrhTask) {
          await supabase.from("tasks").update({
            state: "done",
            status: "done",
            updated_at: new Date().toISOString(),
          }).eq("id", rrhTask.id);
        }
      }
    }
  } catch {
    // Google Tasks API may not be available — skip silently
  }
}

async function fetchTaskSignals(userId: string): Promise<TaskSignal[]> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - TASK_LOOKBACK_MS).toISOString();

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, title, description, priority_num, state, due_date, source, goal_id, created_at, updated_at")
    .eq("user_id", userId)
    .or(`created_at.gte.${since},updated_at.gte.${since}`)
    .order("updated_at", { ascending: false })
    .limit(MAX_TASKS);

  if (error) throw new Error(`Failed to fetch recent tasks: ${error.message}`);

  const goalIds = unique(
    (tasks ?? [])
      .map((task) => task.goal_id)
      .filter((goalId): goalId is string => Boolean(goalId)),
  );

  const goalTitleMap = new Map<string, string>();
  if (goalIds.length > 0) {
    const { data: goals, error: goalsError } = await supabase
      .from("goals")
      .select("id, title")
      .in("id", goalIds);

    if (goalsError) throw new Error(`Failed to fetch goal titles: ${goalsError.message}`);
    for (const goal of goals ?? []) {
      goalTitleMap.set(goal.id, goal.title);
    }
  }

  return (tasks ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    description: truncate(cleanText(task.description ?? ""), 600),
    priority: task.priority_num ?? null,
    state: task.state ?? null,
    dueDate: task.due_date ?? null,
    goalTitle: task.goal_id ? goalTitleMap.get(task.goal_id) ?? null : null,
    source: task.source ?? null,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  }));
}

async function synthesizeObservations(signals: BrainSyncSignals, syncDateEt: string): Promise<SynthesizedObservation[]> {
  const userMessage = buildSynthesisPrompt(signals, syncDateEt);
  const raw = await callClaude(SYNTHESIS_SYSTEM, userMessage, 2048);
  return parseObservations(raw);
}

function buildSynthesisPrompt(signals: BrainSyncSignals, syncDateEt: string): string {
  const gmailBlock = signals.gmail.length > 0
    ? signals.gmail.map((signal) => [
        `- [gmail] ${signal.receivedAt}`,
        `  From: ${signal.from}`,
        `  Subject: ${signal.subject}`,
        signal.snippet ? `  Snippet: ${signal.snippet}` : null,
        signal.body ? `  Body excerpt: ${signal.body}` : null,
      ].filter(Boolean).join("\n"))
    : ["- None"];

  const calendarBlock = signals.calendar.length > 0
    ? signals.calendar.map((signal) => [
        `- [calendar] ${signal.start} -> ${signal.end}`,
        `  Title: ${signal.title}`,
        signal.attendees.length > 0 ? `  Attendees: ${signal.attendees.join(", ")}` : null,
        signal.location ? `  Location: ${signal.location}` : null,
        signal.description ? `  Description: ${signal.description}` : null,
      ].filter(Boolean).join("\n"))
    : ["- None"];

  const taskBlock = signals.tasks.length > 0
    ? signals.tasks.map((signal) => [
        `- [task] updated ${signal.updatedAt}`,
        `  Title: ${signal.title}`,
        signal.state ? `  State: ${signal.state}` : null,
        signal.priority !== null ? `  Priority: ${signal.priority}` : null,
        signal.goalTitle ? `  Goal: ${signal.goalTitle}` : null,
        signal.dueDate ? `  Due: ${signal.dueDate}` : null,
        signal.source ? `  Source: ${signal.source}` : null,
        signal.description ? `  Description: ${signal.description}` : null,
      ].filter(Boolean).join("\n"))
    : ["- None"];

  return [
    `Brain sync date (ET): ${syncDateEt}`,
    "Synthesize the most important operating context from these raw signals.",
    "",
    `Gmail signals (last 24h, promos/spam excluded; ${signals.gmail.length} items):`,
    ...gmailBlock,
    "",
    `Calendar signals (today + tomorrow; ${signals.calendar.length} items):`,
    ...calendarBlock,
    "",
    `Task signals (last 48h; ${signals.tasks.length} items):`,
    ...taskBlock,
  ].join("\n");
}

function parseObservations(raw: string): SynthesizedObservation[] {
  const cleaned = stripCodeFence(raw);
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Claude did not return a JSON array for brain-sync");
  }

  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Brain-sync synthesis response was not an array");
  }

  return parsed
    .map((item) => normalizeObservation(item))
    .filter((item): item is SynthesizedObservation => item !== null)
    .slice(0, 8);
}

function normalizeObservation(value: unknown): SynthesizedObservation | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const title = safeText(record.title);
  const observation = safeText(record.observation);
  const whyItMatters = safeText(record.why_it_matters);

  if (!title || !observation || !whyItMatters) return null;

  const suggestedFollowUp = safeText(record.suggested_follow_up) || null;
  const signals = Array.isArray(record.signals)
    ? record.signals.filter(isSignalSource)
    : [];

  return {
    title,
    observation,
    whyItMatters,
    suggestedFollowUp,
    signals: signals.length > 0 ? signals : ["task"],
    tags: normalizeTags(record.tags),
    importance: clampImportance(typeof record.importance === "number" ? record.importance : 5),
  };
}

function formatObservationMemory(observation: SynthesizedObservation, syncDateEt: string): string {
  return [
    `Brain Sync Observation (${syncDateEt})`,
    `Title: ${observation.title}`,
    `Signals: ${observation.signals.join(", ")}`,
    `Importance: ${clampImportance(observation.importance)}/10`,
    observation.tags.length > 0 ? `Tags: ${observation.tags.join(", ")}` : null,
    "",
    observation.observation,
    "",
    `Why it matters: ${observation.whyItMatters}`,
    observation.suggestedFollowUp ? `Suggested follow-up: ${observation.suggestedFollowUp}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function getCalendarWindow() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return {
    timeMin: buildTimeZoneTimestamp(now, "00:00:00"),
    timeMax: buildTimeZoneTimestamp(tomorrow, "23:59:59"),
  };
}

function buildTimeZoneTimestamp(date: Date, clockTime: string): string {
  const dateKey = getDateKey(date, TIME_ZONE);
  const offset = getTimeZoneOffset(date, TIME_ZONE);
  return `${dateKey}T${clockTime}${offset}`;
}

function getDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

function getTimeZoneOffset(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  return offset === "GMT" ? "+00:00" : offset.replace("GMT", "");
}

function getHeader(payload: MessagePayload | undefined, name: string): string {
  const header = payload?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? "";
}

function extractMessageText(payload: MessagePayload | undefined): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  for (const part of payload.parts ?? []) {
    const nested = extractMessageText(part);
    if (nested) return nested;
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripHtml(decodeBase64Url(payload.body.data));
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return "";
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized + "=".repeat(4 - padding);
  return Buffer.from(padded, "base64").toString("utf8");
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"");
}

function cleanText(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function summarizeAttendees(attendees: EventAttendee[] | undefined | null): string[] {
  return (attendees ?? [])
    .map((attendee) => attendee.displayName || attendee.email || "")
    .filter((value) => value.length > 0)
    .slice(0, 8);
}

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return unique(
    value
      .map((item) => safeText(item))
      .map((item) => slugify(item))
      .filter((item) => item.length > 0)
      .slice(0, 8),
  );
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function clampImportance(value: number): number {
  return Math.min(10, Math.max(1, Math.round(value)));
}

function isSignalSource(value: unknown): value is SignalSource {
  return value === "gmail" || value === "calendar" || value === "task";
}
