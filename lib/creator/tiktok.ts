/**
 * TikTok API adapter for Creator OS.
 *
 * Uses the TikTok API for profile/follower data.
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

    const res = await fetch(`${TIKTOK_API}/user/info/?fields=follower_count,following_count,video_count,display_name,bio_description`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = await res.json();

    if (!res.ok || data.error?.code) {
      throw new Error(data.error?.message ?? `TikTok profile fetch failed (${res.status})`);
    }

    const user = data.data?.user ?? {};

    return {
      followers: user.follower_count ?? 0,
      following: user.following_count ?? 0,
      postsCount: user.video_count ?? 0,
      extras: {
        displayName: user.display_name,
        bio: user.bio_description,
      },
    };
  }

  async publish(): Promise<PublishResult> {
    return { success: false, error: "TikTok publishing not yet implemented" };
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

    if (!res.ok || data.error?.code) {
      throw new Error(data.error?.message ?? "Failed to fetch TikTok post metrics");
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
    const { accessToken, limit = 20 } = params;

    const res = await fetch(`${TIKTOK_API}/video/list/?fields=id,title,create_time,share_url`, {
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

    return (data.data?.videos ?? []).map((item: Record<string, unknown>) => ({
      postId: item.id as string,
      body: (item.title as string) ?? "",
      contentType: "reel" as const,
      permalink: item.share_url as string | undefined,
      timestamp: new Date((item.create_time as number) * 1000).toISOString(),
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

    if (!res.ok || data.error) {
      throw new Error(data.error_description ?? "TikTok token exchange failed");
    }

    return {
      accessToken: data.access_token,
      tokenType: "bearer",
      expiresIn: data.expires_in,
      userId: data.open_id,
      username: undefined,
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
