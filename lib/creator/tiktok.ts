/**
 * TikTok API adapter for Creator OS.
 *
 * Uses the TikTok API v2 for profile stats and post metrics.
 * Docs: https://developers.tiktok.com/doc/research-api-get-user-info
 */

import type { PlatformAdapter, PublishResult, PostMetrics, PlatformPost, PlatformProfile } from "./platforms";

const TIKTOK_API = "https://open.tiktokapis.com/v2";

export class TikTokAdapter implements PlatformAdapter {
  platform = "tiktok";

  async getProfile(params: {
    accessToken: string;
    userId: string;
  }): Promise<PlatformProfile> {
    const { accessToken } = params;

    const res = await fetch(`${TIKTOK_API}/user/info/?fields=follower_count,following_count,video_count,display_name,avatar_url`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();

    if (!res.ok || data.error?.code) {
      throw new Error(data.error?.message ?? "Failed to fetch TikTok profile");
    }

    const user = data.data?.user ?? {};

    return {
      followers: user.follower_count ?? 0,
      following: user.following_count ?? 0,
      postsCount: user.video_count ?? 0,
      extras: {
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    };
  }

  async getPostMetrics(params: {
    accessToken: string;
    postId: string;
  }): Promise<PostMetrics> {
    const { accessToken, postId } = params;

    const res = await fetch(`${TIKTOK_API}/video/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filters: { video_ids: [postId] },
        fields: ["view_count", "like_count", "comment_count", "share_count"],
      }),
    });
    const data = await res.json();

    if (!res.ok || data.error?.code) {
      throw new Error(data.error?.message ?? "Failed to fetch TikTok video metrics");
    }

    const video = data.data?.videos?.[0] ?? {};

    return {
      impressions: video.view_count ?? 0,
      likes: video.like_count ?? 0,
      replies: video.comment_count ?? 0,
      reposts: video.share_count ?? 0,
      quotes: 0,
      followsGained: 0,
    };
  }

  async listUserPosts(params: {
    accessToken: string;
    userId: string;
    since?: string;
    limit?: number;
  }): Promise<PlatformPost[]> {
    const { accessToken, limit = 50 } = params;

    const res = await fetch(`${TIKTOK_API}/video/list/?fields=id,title,video_description,create_time,share_url,cover_image_url`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ max_count: Math.min(limit, 20) }),
    });
    const data = await res.json();

    if (!res.ok || data.error?.code) {
      throw new Error(data.error?.message ?? "Failed to list TikTok videos");
    }

    return ((data.data?.videos ?? []) as Array<Record<string, unknown>>).map((item) => ({
      postId: item.id as string,
      body: (item.video_description as string) ?? (item.title as string) ?? "",
      contentType: "reel" as const,
      permalink: item.share_url as string | undefined,
      timestamp: new Date((item.create_time as number) * 1000).toISOString(),
    }));
  }

  async publish(params: {
    accessToken: string;
    userId: string;
    body: string;
    mediaUrls?: string[];
    contentType: "text" | "image" | "carousel" | "reel" | "thread";
  }): Promise<PublishResult> {
    const { accessToken, body, mediaUrls } = params;

    if (!mediaUrls?.length) {
      return { success: false, error: "TikTok requires a video URL to publish" };
    }

    try {
      // Initiate upload
      const initRes = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: {
            title: body.slice(0, 150),
            privacy_level: "PUBLIC_TO_EVERYONE",
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: mediaUrls[0],
          },
        }),
      });
      const initData = await initRes.json();

      if (!initRes.ok || initData.error?.code) {
        return { success: false, error: initData.error?.message ?? "TikTok publish init failed" };
      }

      return {
        success: true,
        postId: initData.data?.publish_id,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  async exchangeCodeForToken(code: string, redirectUri: string) {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) throw new Error("Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET");

    const res = await fetch(`${TIKTOK_API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error_description ?? "TikTok token exchange failed");
    }

    return {
      accessToken: data.access_token,
      tokenType: "bearer",
      expiresIn: data.expires_in,
      userId: data.open_id,
    };
  }

  async refreshLongLivedToken(token: string) {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) throw new Error("Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET");

    const res = await fetch(`${TIKTOK_API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: token,
      }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error_description ?? "TikTok token refresh failed");
    }

    return {
      accessToken: data.access_token,
      tokenType: "bearer",
      expiresIn: data.expires_in,
    };
  }
}
