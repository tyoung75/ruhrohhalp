/**
 * Media ingestion pipeline — Google Drive → Supabase Storage.
 *
 * Syncs new photos/videos from a watched Google Drive folder into
 * the media_assets table. Runs as a cron job every 2 hours.
 *
 * Flow:
 * 1. List new files in the watched Drive folder since last sync
 * 2. For each file: download → detect screenshot → upload to Supabase Storage
 * 3. Extract metadata (dimensions, duration for video)
 * 4. Insert into media_assets table
 * 5. Update sync state (page token, timestamp)
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { detectScreenshot } from "@/lib/creator/screenshot-filter";
import { logInfo, logError } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  createdTime: string;
  imageMediaMetadata?: {
    width?: number;
    height?: number;
    cameraMake?: string;
    cameraModel?: string;
    location?: { latitude: number; longitude: number; altitude?: number };
  };
  videoMediaMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: string;
  };
}

interface DriveListResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface MediaIngestResult {
  ingested: number;
  screenshots_filtered: number;
  errors: number;
  skipped_duplicates: number;
}

// ---------------------------------------------------------------------------
// Google Drive API helpers
// ---------------------------------------------------------------------------

const DRIVE_API = "https://www.googleapis.com/drive/v3";

/** Supported media types for ingestion. */
const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
]);

async function listDriveFiles(
  accessToken: string,
  folderId: string,
  pageToken?: string | null,
  modifiedAfter?: string | null
): Promise<DriveListResponse> {
  const queryParts = [`'${folderId}' in parents`, "trashed = false"];

  if (modifiedAfter) {
    queryParts.push(`modifiedTime > '${modifiedAfter}'`);
  }

  const params = new URLSearchParams({
    q: queryParts.join(" and "),
    fields: "files(id,name,mimeType,size,createdTime,imageMediaMetadata,videoMediaMetadata),nextPageToken",
    pageSize: "100",
    orderBy: "createdTime desc",
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  const res = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Drive API error: ${res.status} — ${JSON.stringify(error)}`);
  }

  return res.json();
}

async function downloadDriveFile(
  accessToken: string,
  fileId: string
): Promise<ArrayBuffer> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Drive download error: ${res.status}`);
  }

  return res.arrayBuffer();
}

// ---------------------------------------------------------------------------
// Main ingestion function
// ---------------------------------------------------------------------------

export async function syncMediaFromDrive(
  userId: string
): Promise<MediaIngestResult> {
  const supabase = createAdminClient();
  const result: MediaIngestResult = {
    ingested: 0,
    screenshots_filtered: 0,
    errors: 0,
    skipped_duplicates: 0,
  };

  // Get Google Drive access token from platform_tokens
  const { data: tokenRow } = await supabase
    .from("platform_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .eq("platform", "google_drive")
    .single();

  if (!tokenRow) {
    logInfo("media-ingest.no-token", { userId });
    return result;
  }

  let accessToken = tokenRow.access_token;

  // Auto-refresh if expired (or expiring within 5 minutes)
  const isExpired =
    tokenRow.expires_at &&
    new Date(tokenRow.expires_at).getTime() - Date.now() < 5 * 60 * 1000;

  if (isExpired && tokenRow.refresh_token) {
    const clientId = process.env.GOOGLE_CLIENT_ID ?? process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? process.env.YOUTUBE_CLIENT_SECRET;

    if (clientId && clientSecret) {
      try {
        const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: tokenRow.refresh_token,
            grant_type: "refresh_token",
          }),
        });

        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          accessToken = refreshData.access_token;
          const newExpiresAt = refreshData.expires_in
            ? new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
            : null;

          // Update stored token
          await supabase
            .from("platform_tokens")
            .update({
              access_token: accessToken,
              expires_at: newExpiresAt,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("platform", "google_drive");

          logInfo("media-ingest.token-refreshed", { userId });
        } else {
          logError("media-ingest.refresh-failed", new Error(`Refresh failed: ${refreshRes.status}`), { userId });
          return result;
        }
      } catch (refreshErr) {
        logError("media-ingest.refresh-error", refreshErr instanceof Error ? refreshErr : new Error(String(refreshErr)), { userId });
        return result;
      }
    } else {
      logError("media-ingest.token-expired", new Error("Token expired and no client credentials for refresh"), { userId });
      return result;
    }
  } else if (isExpired && !tokenRow.refresh_token) {
    logError("media-ingest.token-expired", new Error("Google Drive token expired, no refresh token"), { userId });
    return result;
  }

  // Replace token reference for downstream usage
  const token = { access_token: accessToken, expires_at: tokenRow.expires_at };

  // Get sync state
  const { data: syncState } = await supabase
    .from("media_sync_state")
    .select("*")
    .eq("user_id", userId)
    .eq("source", "google_drive")
    .single();

  const folderId = syncState?.folder_id ?? process.env.GOOGLE_DRIVE_MEDIA_FOLDER_ID;
  if (!folderId) {
    logError("media-ingest.no-folder", new Error("No Google Drive folder ID configured"), { userId });
    return result;
  }

  const lastSyncAt = syncState?.last_sync_at ?? null;

  try {
    let pageToken: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const listing = await listDriveFiles(
        token.access_token,
        folderId,
        pageToken,
        lastSyncAt
      );

      for (const file of listing.files) {
        try {
          await processFile(supabase, userId, token.access_token, file, result);
        } catch (err) {
          result.errors++;
          logError("media-ingest.process-file", err, { fileId: file.id, filename: file.name });
        }
      }

      pageToken = listing.nextPageToken ?? null;
      hasMore = !!pageToken;
    }

    // Update sync state
    await supabase
      .from("media_sync_state")
      .upsert({
        user_id: userId,
        source: "google_drive",
        last_sync_at: new Date().toISOString(),
        folder_id: folderId,
      }, { onConflict: "user_id,source" });

    logInfo("media-ingest.complete", result);
  } catch (err) {
    logError("media-ingest.sync", err, { userId });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Process a single file
// ---------------------------------------------------------------------------

async function processFile(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  accessToken: string,
  file: DriveFile,
  result: MediaIngestResult
): Promise<void> {
  // Skip unsupported types
  if (!SUPPORTED_MIME_TYPES.has(file.mimeType)) {
    return;
  }

  // Skip duplicates
  const { data: existing } = await supabase
    .from("media_assets")
    .select("id")
    .eq("drive_file_id", file.id)
    .single();

  if (existing) {
    result.skipped_duplicates++;
    return;
  }

  // Extract dimensions
  const width = file.imageMediaMetadata?.width ?? file.videoMediaMetadata?.width ?? null;
  const height = file.imageMediaMetadata?.height ?? file.videoMediaMetadata?.height ?? null;
  const durationSeconds = file.videoMediaMetadata?.durationMillis
    ? parseInt(file.videoMediaMetadata.durationMillis) / 1000
    : null;

  // Screenshot detection
  const screenshotCheck = detectScreenshot({
    filename: file.name,
    width,
    height,
    mime_type: file.mimeType,
    camera_make: file.imageMediaMetadata?.cameraMake ?? null,
    camera_model: file.imageMediaMetadata?.cameraModel ?? null,
  });

  if (screenshotCheck.is_screenshot) {
    // Still record it (for audit trail) but mark as screenshot
    await supabase.from("media_assets").insert({
      user_id: userId,
      drive_file_id: file.id,
      filename: file.name,
      mime_type: file.mimeType,
      storage_path: "",   // not downloaded
      file_size_bytes: parseInt(file.size || "0"),
      created_at: file.createdTime,
      width,
      height,
      duration_seconds: durationSeconds,
      is_screenshot: true,
      status: "screenshot",
      feedback: `Auto-filtered: ${screenshotCheck.reasons.join("; ")} (confidence: ${screenshotCheck.confidence.toFixed(2)})`,
    });
    result.screenshots_filtered++;
    logInfo("media-ingest.screenshot-filtered", {
      filename: file.name,
      confidence: screenshotCheck.confidence,
      reasons: screenshotCheck.reasons,
    });
    return;
  }

  // Download file from Drive
  const fileBuffer = await downloadDriveFile(accessToken, file.id);

  // Upload to Supabase Storage
  const datePrefix = new Date(file.createdTime).toISOString().split("T")[0];
  const storagePath = `media/inbox/${datePrefix}/${file.id}_${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from("creator-media")
    .upload(storagePath, fileBuffer, {
      contentType: file.mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  // Generate thumbnail path (for future thumbnail generation)
  const thumbnailPath = `media/thumbnails/${datePrefix}/${file.id}_thumb.jpg`;

  // Build location data
  const location = file.imageMediaMetadata?.location
    ? {
        lat: file.imageMediaMetadata.location.latitude,
        lng: file.imageMediaMetadata.location.longitude,
      }
    : null;

  // Insert into media_assets
  await supabase.from("media_assets").insert({
    user_id: userId,
    drive_file_id: file.id,
    filename: file.name,
    mime_type: file.mimeType,
    storage_path: storagePath,
    thumbnail_path: thumbnailPath,
    file_size_bytes: parseInt(file.size || "0"),
    created_at: file.createdTime,
    location,
    duration_seconds: durationSeconds,
    width,
    height,
    is_screenshot: false,
    status: "new",
  });

  result.ingested++;
}
