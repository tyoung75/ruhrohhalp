/**
 * Editor API — POST /api/creator/editor
 *
 * Actions:
 * - { action: "execute" }           — Process all pending edit plans
 * - { action: "execute", planId }   — Process a specific plan
 * - { action: "approve", planId }   — Approve an editor_draft → queued
 * - { action: "delete", planId }    — Delete an editor_draft
 * - { action: "re_edit", planId, prompt } — Re-edit with feedback
 * - { action: "feedback", planId, note }  — Free-text feedback
 *
 * GET — List editor drafts and pending plans
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeEditPlan, processPendingPlans } from "@/lib/creator/editor/executor";
import { reEditPlan } from "@/lib/creator/director";
import { embedAndStore } from "@/lib/embedding/pipeline";
import { logInfo, logError } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST — execute plans, approve/delete/re-edit drafts
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, planId, prompt, note, contentQueueId } = body as {
    action: string;
    planId?: string;
    prompt?: string;
    note?: string;
    contentQueueId?: string;
  };

  const supabase = createAdminClient();

  try {
    switch (action) {
      // ----- Execute pending edit plans -----
      case "execute": {
        if (planId) {
          const result = await executeEditPlan(planId, user.id);
          return NextResponse.json(result);
        }
        const result = await processPendingPlans(user.id);
        return NextResponse.json({ success: true, ...result });
      }

      // ----- Approve: editor_draft → queued -----
      case "approve": {
        if (!contentQueueId) {
          return NextResponse.json({ error: "contentQueueId required" }, { status: 400 });
        }

        const { error: updateError } = await supabase
          .from("content_queue")
          .update({
            status: "queued",
            updated_at: new Date().toISOString(),
          })
          .eq("id", contentQueueId)
          .eq("user_id", user.id)
          .eq("status", "editor_draft");

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // Record feedback
        const editPlanId = await getEditPlanIdFromQueue(supabase, contentQueueId);
        if (editPlanId) {
          await supabase.from("editor_feedback").insert({
            user_id: user.id,
            edit_plan_id: editPlanId,
            content_queue_id: contentQueueId,
            action: "approved",
            note: note ?? null,
          });
        }

        logInfo("editor-api.approved", { contentQueueId });
        return NextResponse.json({ success: true, status: "queued" });
      }

      // ----- Delete: editor_draft → rejected -----
      case "delete": {
        if (!contentQueueId) {
          return NextResponse.json({ error: "contentQueueId required" }, { status: 400 });
        }

        const { data: post } = await supabase
          .from("content_queue")
          .select("body, context_snapshot")
          .eq("id", contentQueueId)
          .eq("user_id", user.id)
          .single();

        await supabase
          .from("content_queue")
          .update({
            status: "rejected",
            updated_at: new Date().toISOString(),
          })
          .eq("id", contentQueueId)
          .eq("user_id", user.id);

        // Record strong negative feedback
        const editPlanId2 = await getEditPlanIdFromQueue(supabase, contentQueueId);
        if (editPlanId2) {
          await supabase.from("editor_feedback").insert({
            user_id: user.id,
            edit_plan_id: editPlanId2,
            content_queue_id: contentQueueId,
            action: "deleted",
            note: note ?? null,
          });
        }

        // Embed deletion as high-importance negative signal
        if (post?.body) {
          try {
            await embedAndStore(
              `[DELETED EDITOR DRAFT] Tyler deleted this AI-edited post.\n${note ? `Reason: ${note}\n` : ""}Caption: ${(post.body as string).slice(0, 300)}`,
              {
                userId: user.id,
                source: "manual",
                sourceId: `editor-delete:${contentQueueId}`,
                category: "general",
                importance: 8,
                tags: ["content:editor-deleted", "creator-os", "ai-editor"],
              }
            );
          } catch (embedErr) {
            logError("editor-api.embed-delete", embedErr, { contentQueueId });
          }
        }

        logInfo("editor-api.deleted", { contentQueueId, note });
        return NextResponse.json({ success: true, status: "rejected" });
      }

      // ----- Re-edit: send back through Director + Executor -----
      case "re_edit": {
        if (!planId || !prompt) {
          return NextResponse.json(
            { error: "planId and prompt required for re-edit" },
            { status: 400 }
          );
        }

        // Record re-edit feedback
        await supabase.from("editor_feedback").insert({
          user_id: user.id,
          edit_plan_id: planId,
          content_queue_id: contentQueueId ?? null,
          action: "re_edit",
          note: prompt,
        });

        // Generate revised plan
        const reEditResult = await reEditPlan(user.id, planId, prompt);

        if (!reEditResult.plan_id) {
          return NextResponse.json(
            { error: reEditResult.error ?? "Re-edit failed" },
            { status: 500 }
          );
        }

        // Execute the revised plan immediately
        const execResult = await executeEditPlan(reEditResult.plan_id, user.id);

        // If old draft exists, mark it as superseded
        if (contentQueueId) {
          await supabase
            .from("content_queue")
            .update({ status: "rejected", last_error: "Superseded by re-edit" })
            .eq("id", contentQueueId)
            .eq("user_id", user.id);
        }

        logInfo("editor-api.re-edit", { originalPlanId: planId, newPlanId: reEditResult.plan_id });
        return NextResponse.json({
          success: execResult.success,
          new_plan_id: reEditResult.plan_id,
          content_queue_id: execResult.content_queue_id,
          error: execResult.error,
        });
      }

      // ----- Free-text feedback -----
      case "feedback": {
        if (!note) {
          return NextResponse.json({ error: "note required" }, { status: 400 });
        }

        await supabase.from("editor_feedback").insert({
          user_id: user.id,
          edit_plan_id: planId ?? null,
          content_queue_id: contentQueueId ?? null,
          action: "note",
          note,
        });

        // Embed as editor learning
        try {
          await embedAndStore(
            `[EDITOR FEEDBACK] ${note}`,
            {
              userId: user.id,
              source: "manual",
              sourceId: `editor-note:${Date.now()}`,
              category: "general",
              importance: 7,
              tags: ["content:editor-feedback", "creator-os", "ai-editor"],
            }
          );
        } catch (embedErr) {
          logError("editor-api.embed-feedback", embedErr);
        }

        logInfo("editor-api.feedback", { note: note.slice(0, 100) });
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Valid: execute, approve, delete, re_edit, feedback` },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Editor action failed" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET — list editor drafts and pending plans
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const supabase = createAdminClient();
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "editor_draft";
  const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);

  // Get editor drafts from content_queue
  const { data: drafts, error: draftsError } = await supabase
    .from("content_queue")
    .select("id, platform, content_type, body, media_urls, scheduled_for, status, agent_reasoning, confidence_score, brand_voice_score, context_snapshot, created_at")
    .eq("user_id", user.id)
    .eq("status", status)
    .eq("source", "ai_editor")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (draftsError) {
    return NextResponse.json({ error: draftsError.message }, { status: 500 });
  }

  // Get pending/processing edit plans
  const { data: plans } = await supabase
    .from("edit_plans")
    .select("id, plan, status, created_at, director_reasoning, confidence, brand_voice_score, media_asset_ids")
    .eq("user_id", user.id)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(10);

  // Get recent editor feedback
  const { data: recentFeedback } = await supabase
    .from("editor_feedback")
    .select("id, action, note, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    drafts: drafts ?? [],
    pending_plans: plans ?? [],
    recent_feedback: recentFeedback ?? [],
    counts: {
      drafts: drafts?.length ?? 0,
      pending_plans: plans?.length ?? 0,
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getEditPlanIdFromQueue(
  supabase: ReturnType<typeof createAdminClient>,
  contentQueueId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("content_queue")
    .select("context_snapshot")
    .eq("id", contentQueueId)
    .single();

  const snapshot = data?.context_snapshot as Record<string, unknown> | null;
  return (snapshot?.edit_plan_id as string) ?? null;
}
