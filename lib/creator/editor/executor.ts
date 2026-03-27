/**
 * Edit Plan Executor — orchestrates the full edit pipeline.
 *
 * Takes a pending edit_plan, downloads the source media, routes to the
 * appropriate editor (photo or video), uploads the result, and creates
 * an editor_draft entry in content_queue for Tyler's review.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { executePhotoEdit } from "@/lib/creator/editor/photo-editor";
import { executeVideoEdit } from "@/lib/creator/editor/video-editor";
import type { EditPlan } from "@/lib/creator/director";
import { logInfo, logError } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  success: boolean;
  content_queue_id?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function executeEditPlan(
  planId: string,
  userId: string
): Promise<ExecutionResult> {
  const supabase = createAdminClient();

  // Load the plan
  const { data: planRow, error: fetchError } = await supabase
    .from("edit_plans")
    .select("*")
    .eq("id", planId)
    .eq("user_id", userId)
    .single();

  if (fetchError || !planRow) {
    return { success: false, error: "Plan not found" };
  }

  // Mark as processing
  await supabase
    .from("edit_plans")
    .update({ status: "processing" })
    .eq("id", planId);

  const plan = planRow.plan as EditPlan;

  try {
    // Load source media assets
    const { data: assets } = await supabase
      .from("media_assets")
      .select("id, storage_path, mime_type, filename, width, height, duration_seconds")
      .in("id", planRow.media_asset_ids);

    if (!assets?.length) {
      throw new Error("No media assets found for plan");
    }

    let outputStoragePath: string;
    let outputThumbnailPath: string | null = null;
    let outputMimeType: string;

    // Route to appropriate editor
    const isVideo = assets.some((a) => a.mime_type.startsWith("video/")) || plan.video_edits;

    if (isVideo && plan.video_edits) {
      // Video editing
      const assetMap = new Map<string, { buffer: Buffer; mime_type: string; filename: string }>();

      for (const asset of assets) {
        const { data: fileData, error: dlError } = await supabase.storage
          .from("creator-media")
          .download(asset.storage_path);

        if (dlError || !fileData) {
          throw new Error(`Failed to download asset ${asset.id}: ${dlError?.message}`);
        }

        const buffer = Buffer.from(await fileData.arrayBuffer());
        assetMap.set(asset.id, { buffer, mime_type: asset.mime_type, filename: asset.filename });
      }

      const result = await executeVideoEdit({
        assets: assetMap,
        edits: plan.video_edits,
      });

      // Upload result
      const dateStr = new Date().toISOString().split("T")[0];
      outputStoragePath = `media/edited/${dateStr}/${planId}.mp4`;
      outputMimeType = result.mime_type;

      const { error: uploadError } = await supabase.storage
        .from("creator-media")
        .upload(outputStoragePath, result.buffer, {
          contentType: result.mime_type,
          upsert: true,
        });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    } else if (plan.photo_edits) {
      // Photo editing (single image or first in carousel)
      const primaryAsset = assets[0];
      const { data: fileData, error: dlError } = await supabase.storage
        .from("creator-media")
        .download(primaryAsset.storage_path);

      if (dlError || !fileData) {
        throw new Error(`Failed to download asset: ${dlError?.message}`);
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());

      const result = await executePhotoEdit({
        imageBuffer: buffer,
        edits: plan.photo_edits,
        srcWidth: primaryAsset.width ?? 1080,
        srcHeight: primaryAsset.height ?? 1080,
      });

      // Upload result
      const dateStr = new Date().toISOString().split("T")[0];
      outputStoragePath = `media/edited/${dateStr}/${planId}.jpg`;
      outputMimeType = result.mime_type;

      const { error: uploadError } = await supabase.storage
        .from("creator-media")
        .upload(outputStoragePath, result.buffer, {
          contentType: result.mime_type,
          upsert: true,
        });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      // For carousels, process additional images
      if (plan.post_type === "carousel" && plan.carousel_order && assets.length > 1) {
        const carouselPaths: string[] = [outputStoragePath];

        for (let i = 1; i < assets.length; i++) {
          const asset = assets[i];
          const { data: assetData } = await supabase.storage
            .from("creator-media")
            .download(asset.storage_path);

          if (!assetData) continue;

          const assetBuffer = Buffer.from(await assetData.arrayBuffer());
          const assetResult = await executePhotoEdit({
            imageBuffer: assetBuffer,
            edits: plan.photo_edits,
            srcWidth: asset.width ?? 1080,
            srcHeight: asset.height ?? 1080,
          });

          const assetPath = `media/edited/${dateStr}/${planId}_${i}.jpg`;
          await supabase.storage
            .from("creator-media")
            .upload(assetPath, assetResult.buffer, {
              contentType: assetResult.mime_type,
              upsert: true,
            });

          carouselPaths.push(assetPath);
        }

        // outputStoragePath for carousel is a JSON array of paths
        outputStoragePath = JSON.stringify(carouselPaths);
      }

    } else {
      throw new Error("Plan has neither photo_edits nor video_edits");
    }

    // Get public URLs for the edited media
    const mediaUrls = getPublicUrls(supabase, outputStoragePath);

    // Determine content type for content_queue
    const contentType = plan.post_type === "reel" || plan.post_type === "short" ? "reel" :
                        plan.post_type === "carousel" ? "carousel" :
                        plan.post_type === "video" ? "reel" : "image";

    // Create editor_draft in content_queue
    const { data: queueEntry, error: queueError } = await supabase
      .from("content_queue")
      .insert({
        user_id: userId,
        platform: plan.target_platform,
        content_type: contentType,
        body: plan.caption,
        media_urls: mediaUrls,
        hashtags: plan.hashtags ?? [],
        scheduled_for: plan.scheduled_time
          ? getScheduledTimestamp(plan.scheduled_time)
          : new Date(Date.now() + 3600000).toISOString(), // default: 1 hour from now
        status: "editor_draft",
        source: "ai_editor",
        agent_reasoning: plan.reasoning,
        confidence_score: plan.confidence,
        brand_voice_score: plan.brand_voice_score,
        context_snapshot: {
          edit_plan_id: planId,
          original_asset_ids: planRow.media_asset_ids,
          edits_applied: {
            photo_edits: plan.photo_edits ?? null,
            video_edits: plan.video_edits ?? null,
          },
        },
        attempts: 0,
      })
      .select("id")
      .single();

    if (queueError || !queueEntry) {
      throw new Error(`Queue insert failed: ${queueError?.message}`);
    }

    // Update plan as completed
    await supabase
      .from("edit_plans")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        output_storage_path: outputStoragePath,
        content_queue_id: queueEntry.id,
      })
      .eq("id", planId);

    // Update media assets as edited
    await supabase
      .from("media_assets")
      .update({ status: "edited", used_in_post_id: queueEntry.id })
      .in("id", planRow.media_asset_ids);

    logInfo("executor.complete", {
      planId,
      contentQueueId: queueEntry.id,
      platform: plan.target_platform,
      postType: plan.post_type,
    });

    return { success: true, content_queue_id: queueEntry.id };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Execution failed";

    await supabase
      .from("edit_plans")
      .update({ status: "failed", director_reasoning: `FAILED: ${errorMsg}` })
      .eq("id", planId);

    logError("executor.failed", err, { planId });
    return { success: false, error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// Process all pending plans for a user
// ---------------------------------------------------------------------------

export async function processPendingPlans(
  userId: string
): Promise<{ processed: number; failed: number }> {
  const supabase = createAdminClient();

  const { data: plans } = await supabase
    .from("edit_plans")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);

  if (!plans?.length) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;

  for (const plan of plans) {
    const result = await executeEditPlan(plan.id, userId);
    if (result.success) {
      processed++;
    } else {
      failed++;
    }
  }

  return { processed, failed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPublicUrls(
  supabase: ReturnType<typeof createAdminClient>,
  storagePath: string
): string[] {
  // Handle carousel (JSON array of paths)
  let paths: string[];
  try {
    paths = JSON.parse(storagePath);
  } catch {
    paths = [storagePath];
  }

  return paths.map((path) => {
    const { data } = supabase.storage
      .from("creator-media")
      .getPublicUrl(path);
    return data.publicUrl;
  });
}

function getScheduledTimestamp(timeStr: string): string {
  // timeStr is "HH:MM" in ET
  const [hours, minutes] = timeStr.split(":").map(Number);
  const now = new Date();

  // Create a date in ET
  const etDate = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  etDate.setHours(hours, minutes, 0, 0);

  // If the time has already passed today, schedule for tomorrow
  const nowET = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  if (etDate <= nowET) {
    etDate.setDate(etDate.getDate() + 1);
  }

  return etDate.toISOString();
}
