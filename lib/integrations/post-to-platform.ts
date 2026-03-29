import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdapter } from "@/lib/creator/platforms";

type PostResult = {
  success: boolean;
  external_id?: string;
  post_url?: string;
  error?: string;
};

type QueueItem = {
  id: string;
  user_id: string;
  platform: string;
  body: string;
  caption?: string;
  title?: string;
  hashtags?: string[];
  media_urls?: string[];
  platform_spec?: Record<string, unknown>;
};

/**
 * Route a content queue item to the appropriate platform posting function.
 */
export async function postToPlatform(item: QueueItem): Promise<PostResult> {
  const supabase = createAdminClient();

  // Load platform token
  const { data: token } = await supabase
    .from("platform_tokens")
    .select("access_token, platform_user_id, expires_at")
    .eq("user_id", item.user_id)
    .eq("platform", item.platform)
    .single();

  if (!token) {
    return { success: false, error: `No ${item.platform} token found. Connect the platform first.` };
  }

  // Check token expiry
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    return { success: false, error: `${item.platform} token expired. Re-authenticate.` };
  }

  if (!token.platform_user_id && (item.platform === "threads" || item.platform === "instagram")) {
    return { success: false, error: `${item.platform} platform_user_id not set. Re-authenticate.` };
  }

  const adapter = getPlatformAdapter(item.platform);

  // Determine content type from platform_spec or default to "text"
  const contentType = (item.platform_spec?.content_type as string) ?? (item.media_urls?.length ? "image" : "text");

  const result = await adapter.publish({
    accessToken: token.access_token,
    userId: token.platform_user_id,
    body: item.body,
    mediaUrls: item.media_urls,
    contentType: contentType as "text" | "image" | "carousel" | "reel" | "thread",
  });

  return {
    success: result.success,
    external_id: result.postId,
    post_url: result.postUrl,
    error: result.error,
  };
}
