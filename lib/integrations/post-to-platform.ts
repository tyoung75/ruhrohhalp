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

  if (!token.platform_user_id && (item.platform === "threads" || item.platform === "instagram")) {
    return { success: false, error: `${item.platform} platform_user_id not set. Re-authenticate.` };
  }

  // Platform posting stubs — throw with clear credential requirements.
  // Actual implementations live in lib/creator/{platform}.ts
  const stubs: Record<string, string> = {
    threads: "Threads posting requires THREADS_APP_ID and THREADS_APP_SECRET. Use lib/creator/threads.ts publishThread().",
    instagram: "Instagram posting requires Instagram Graph API credentials. Use lib/creator/instagram.ts.",
    tiktok: "TikTok posting requires TIKTOK_CLIENT_KEY and approved app. Use lib/creator/tiktok.ts.",
    youtube: "YouTube posting requires Google OAuth + YouTube Data API. Use lib/creator/youtube.ts.",
  };

  const stubMessage = stubs[item.platform];
  if (stubMessage) {
    throw new Error(stubMessage);
  }

  return { success: false, error: `Unsupported platform: ${item.platform}` };
}
