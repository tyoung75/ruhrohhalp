import { createAdminClient } from "@/lib/supabase/admin";

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

  switch (item.platform) {
    case "threads":
      return postToThreads(item, token.access_token, token.platform_user_id);
    case "instagram":
      return postToInstagram(item, token.access_token, token.platform_user_id);
    case "tiktok":
      return postToTikTok(item, token.access_token);
    case "youtube":
      return postToYouTube(item, token.access_token);
    default:
      return { success: false, error: `Unsupported platform: ${item.platform}` };
  }
}

async function postToThreads(
  item: QueueItem,
  accessToken: string,
  platformUserId: string | null,
): Promise<PostResult> {
  if (!platformUserId) {
    return { success: false, error: "Threads platform_user_id not set. Re-authenticate." };
  }

  // Threads API: create media container then publish
  // This is a stub — actual implementation uses lib/creator/threads.ts
  throw new Error(
    "Threads posting requires THREADS_APP_ID and THREADS_APP_SECRET. " +
    "Use lib/creator/threads.ts publishThread() for full implementation.",
  );
}

async function postToInstagram(
  item: QueueItem,
  accessToken: string,
  platformUserId: string | null,
): Promise<PostResult> {
  if (!platformUserId) {
    return { success: false, error: "Instagram platform_user_id not set. Re-authenticate." };
  }

  throw new Error(
    "Instagram posting requires Instagram Graph API credentials. " +
    "Use lib/creator/instagram.ts for full implementation.",
  );
}

async function postToTikTok(
  _item: QueueItem,
  _accessToken: string,
): Promise<PostResult> {
  throw new Error(
    "TikTok posting requires TIKTOK_CLIENT_KEY and approved app. " +
    "Use lib/creator/tiktok.ts for full implementation.",
  );
}

async function postToYouTube(
  _item: QueueItem,
  _accessToken: string,
): Promise<PostResult> {
  throw new Error(
    "YouTube posting requires Google OAuth + YouTube Data API. " +
    "Use lib/creator/youtube.ts for full implementation.",
  );
}
