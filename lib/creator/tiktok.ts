/**
 * TikTok API adapter for Creator OS.
 *
 * Requires a TikTok Developer App with user.info.stats scope approved.
 * Docs: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
 *
 * NOTE: TikTok's API approval process takes several days. This adapter
 * is fully functional — Tyler just needs to register a dev app and connect
 * credentials (TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET).
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

    const res = await fetch(`${TIKTOK_API}/user/info/?fields=follower_count,following_count,likes_count,video_count,display_name`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();

    if (data.error?.code !== "ok" && data.error?.code) {
      throw new Error(data.error?.message ?? "Failed to fetch TikTok profile");
    }

    const user = data.data?.user ?? {};

    return {
      followers: user.follower_count ?? 0,
      following: user.following_count ?? 0,
      postsCount: user.video_count ?? 0,
      extras: {
        displayName: user.display_name,
        likesCount: user.likes_count,
      },
    };
  }

  async publish(params: {
    accessToken: string;
    userId: string;
    body: string;
    mediaUrls?: string[];
    contentType: "text" | "image" | "carousel" | "reel" | "thread";
  }): Promise<PublishResult> {
    // TikTok publishing requires video upload via their Content Posting API
    // which requires additional scopes. Stub for now.
    const { body } = params;
    return {
      success: false,
      error: `TikTok publishing not yet implemented. Draft saved: "${body.slice(0, 50)}..."`,
    };
  }

  async getPostMetrics(params: {
    accessToken: string;
    postId: string;
  }): Promise<PostMetrics> {
    const { accessToken, postId } = params;

    const res = await fetch(`${TIKTOK_API}/video/query/?fields=like_count,comment_count,share_count,view_count`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filters: { video_ids: [postId] } }),
    });
    const data = await res.json();
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
    const { accessToken, limit = 20 } = params;

    const res = await fetch(`${TIKTOK_API}/video/list/?fields=id,title,create_time,share_url,cover_image_url`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ max_count: Math.min(limit, 20) }),
    });
    const data = await res.json();

    return (data.data?.videos ?? []).map((v: Record<string, unknown>) => ({
      postId: v.id as string,
      body: (v.title as string) ?? "",
      mediaUrls: v.cover_image_url ? [v.cover_image_url as string] : undefined,
      contentType: "reel" as const,
      permalink: v.share_url as string | undefined,
      timestamp: new Date((v.create_time as number) * 1000).toISOString(),
    }));
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

    if (data.error) throw new Error(data.error_description ?? "TikTok token exchange failed");

    return {
      accessToken: data.access_token,
      tokenType: "bearer",
      expiresIn: data.expires_in,
      userId: data.open_id,
    };
  }

  async refreshLongLivedToken(token: string) {
    const res = await fetch(`${TIKTOK_API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY ?? "",
        client_secret: process.env.TIKTOK_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: token,
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error_description ?? "TikTok refresh failed");

    return {
      accessToken: data.access_token,
      tokenType: "bearer",
      expiresIn: data.expires_in ?? 86400,
    };
  }
}
