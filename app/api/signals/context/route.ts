import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

/**
 * GET /api/signals/context
 *
 * Returns the full feedback context for briefing and content generation.
 * This is the master context endpoint — it aggregates:
 *   - Signal dismissals (suppress similar topics)
 *   - Signal replies (specific + broad directives)
 *   - Content strategy directives (broad steering for content agents)
 *   - Task replies (feedback on specific tasks)
 *
 * The AI reads the `summary` field as a pre-formatted instruction block.
 *
 * Supports both user auth and webhook secret auth.
 */
export async function GET(request: NextRequest) {
  // Check for webhook auth OR user auth
  const webhookSecret = request.headers.get("x-webhook-secret");
  let userId: string | null = null;

  if (webhookSecret) {
    const webhookError = validateWebhookSecret(webhookSecret);
    if (webhookError) return webhookError;
    const url = new URL(request.url);
    userId = url.searchParams.get("user_id");
    if (!userId) {
      return NextResponse.json({ error: "user_id required for webhook calls" }, { status: 400 });
    }
  } else {
    const { user, response } = await requireUser();
    if (response || !user) return response;
    userId = user.id;
  }

  const supabase = await createClient();
  const now = new Date().toISOString();

  // Fetch all feedback sources in parallel
  const [dismissalsRes, signalRepliesRes, contentDirectivesRes, taskRepliesRes] = await Promise.all([
    // Signal dismissals
    supabase
      .from("signal_dismissals")
      .select("fingerprint, original_text, category, source")
      .eq("user_id", userId)
      .eq("active", true)
      .order("created_at", { ascending: false }),

    // Signal replies (unapplied)
    supabase
      .from("signal_replies")
      .select("id, signal_fingerprint, signal_text, signal_category, reply, scope, created_at")
      .eq("user_id", userId)
      .eq("applied", false)
      .order("created_at", { ascending: false })
      .limit(50),

    // Content strategy directives (active + not expired)
    supabase
      .from("content_directives")
      .select("id, directive, platforms, active, expires_at, created_at")
      .eq("user_id", userId)
      .eq("active", true)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("created_at", { ascending: false }),

    // Task replies (unapplied)
    supabase
      .from("task_replies")
      .select("id, task_id, reply, created_at")
      .eq("user_id", userId)
      .eq("applied", false)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const dismissals = dismissalsRes.data ?? [];
  const signalReplies = signalRepliesRes.data ?? [];
  const contentDirectives = contentDirectivesRes.data ?? [];
  const taskReplies = taskRepliesRes.data ?? [];

  // Separate broad from specific signal replies
  const broadSignalDirectives = signalReplies.filter((r) => r.scope === "broad");
  const specificSignalReplies = signalReplies.filter((r) => r.scope === "specific");

  // Build a human-readable summary for the AI
  const summaryParts: string[] = [];

  if (dismissals.length > 0) {
    const dismissed = dismissals.slice(0, 10).map((d) => d.original_text.slice(0, 80));
    summaryParts.push(
      `DISMISSED SIGNALS (${dismissals.length} total — suppress similar topics):\n` +
      dismissed.map((t) => `  - "${t}"`).join("\n")
    );
  }

  if (contentDirectives.length > 0) {
    summaryParts.push(
      `CONTENT STRATEGY DIRECTIVES (${contentDirectives.length} active — apply to ALL content generation):\n` +
      contentDirectives.map((d) => {
        const platformNote = d.platforms ? ` [${d.platforms.join(", ")}]` : "";
        const expiryNote = d.expires_at ? ` (expires ${new Date(d.expires_at).toLocaleDateString()})` : "";
        return `  - "${d.directive}"${platformNote}${expiryNote}`;
      }).join("\n")
    );
  }

  if (broadSignalDirectives.length > 0) {
    summaryParts.push(
      `BROAD BRIEFING DIRECTIVES (apply across entire briefing):\n` +
      broadSignalDirectives.map((d) => `  - "${d.reply}"`).join("\n")
    );
  }

  if (specificSignalReplies.length > 0) {
    summaryParts.push(
      `SPECIFIC SIGNAL FEEDBACK (${specificSignalReplies.length} replies to incorporate):\n` +
      specificSignalReplies.slice(0, 10).map((r) =>
        `  - On "${r.signal_text.slice(0, 60)}…": "${r.reply}"`
      ).join("\n")
    );
  }

  if (taskReplies.length > 0) {
    summaryParts.push(
      `TASK FEEDBACK (${taskReplies.length} replies on tasks):\n` +
      taskReplies.slice(0, 10).map((r) =>
        `  - Task ${r.task_id}: "${r.reply}"`
      ).join("\n")
    );
  }

  const summary = summaryParts.length > 0
    ? summaryParts.join("\n\n")
    : "No feedback to apply.";

  return NextResponse.json({
    // Signal-level feedback
    dismissals,
    signal_replies: signalReplies,
    broad_signal_directives: broadSignalDirectives,
    specific_signal_replies: specificSignalReplies,

    // Content strategy directives
    content_directives: contentDirectives,

    // Task feedback
    task_replies: taskReplies,

    // IDs to mark as applied after incorporating
    signal_reply_ids_to_mark_applied: signalReplies.map((r) => r.id),
    task_reply_ids_to_mark_applied: taskReplies.map((r) => r.id),
    content_directive_ids_to_mark_applied: contentDirectives.filter((d) => !d.expires_at).map((d) => d.id),

    // Pre-formatted summary for AI consumption
    summary,
  });
}
