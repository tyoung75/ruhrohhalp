/**
 * Instagram Graph API adapter for Creator OS.
 *
 * Uses the Instagram Graph API (via Facebook) for profile/follower data.
 * Docs: https://developers.facebook.com/docs/instagram-api
 */

import type { PlatformAdapter, PublishResult, PostMetrics, PlatformPost, PlatformProfile } from "./platforms";

const IG_GRAPH_API = "https://graph.facebook.com/v21.0";

export class InstagramAdapter implements PlatformAdapter {
  platform = "instagram";

  async getProfile(params: {
    accessToken: string;
    userId: string;
  }): Promise<PlatformProfile> {
    const { accessToken, userId } = params;

    const res = await fetch(
      `${IG_GRAPH_API}/${userId}?fields=followers_count,follows_count,media_count,username,biography&access_token=${accessToken}`
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? `Instagram profile fetch failed (${res.status})`);
    }

    return {
      followers: data.followers_count ?? 0,
      following: data.follows_count ?? 0,
      postsCount: data.media_count ?? 0,
      extras: {
        username: data.username,
        biography: data.biography,
      },
    };
  }

  async publish(): Promise<PublishResult> {
    return { success: false, error: "Instagram publishing not yet implemented" };
  }

  async getPostMetrics(params: {
    accessToken: string;
    postId: string;
  }): Promise<PostMetrics> {
    const { accessToken, postId } = params;

    const res = await fetch(
      `${IG_GRAPH_API}/${postId}/insights?metric=impressions,reach,likes,comments,shares,saved&access_token=${accessToken}`
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Failed to fetch Instagram post metrics");
    }

    const metrics: PostMetrics = {
      impressions: 0,
      likes: 0,
      replies: 0,
      reposts: 0,
      quotes: 0,
      followsGained: 0,
    };

    for (const metric of data.data ?? []) {
      const val = metric.values?.[0]?.value ?? 0;
      switch (metric.name) {
        case "impressions":
          metrics.impressions = val;
          break;
        case "likes":
          metrics.likes = val;
          break;
        case "comments":
          metrics.replies = val;
          break;
        case "shares":
          metrics.reposts = val;
          break;
      }
    }

    return metrics;
  }

  async listUserPosts(params: {
    accessToken: string;
    userId: string;
    since?: string;
    limit?: number;
  }): Promise<PlatformPost[]> {
    const { accessToken, userId, limit = 50 } = params;

    const res = await fetch(
      `${IG_GRAPH_API}/${userId}/media?fields=id,caption,media_type,permalink,timestamp&limit=${Math.min(limit, 100)}&access_token=${accessToken}`
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Failed to list Instagram posts");
    }

    return (data.data ?? []).map((item: Record<string, unknown>) => {
      let contentType: PlatformPost["contentType"] = "image";
      if (item.media_type === "VIDEO") contentType = "reel";
      else if (item.media_type === "CAROUSEL_ALBUM") contentType = "carousel";

      return {
        postId: item.id as string,
        body: (item.caption as string) ?? "",
        contentType,
        permalink: item.permalink as string | undefined,
        timestamp: item.timestamp as string,
      };
    });
  }

  async exchangeCodeForToken(code: string, redirectUri: string) {
    const appId = process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET;
    if (!appId || !appSecret) throw new Error("Missing INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET");

    // Exchange code for short-lived token
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    const shortData = await shortRes.json();

    if (!shortRes.ok || shortData.error_message) {
      throw new Error(shortData.error_message ?? "Instagram token exchange failed");
    }

    // Exchange for long-lived token
    const longRes = await fetch(
      `${IG_GRAPH_API}/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${shortData.access_token}`
    );
    const longData = await longRes.json();

    return {
      accessToken: longData.access_token ?? shortData.access_token,
      tokenType: "bearer",
      expiresIn: longData.expires_in,
      userId: String(shortData.user_id),
      username: shortData.username,
    };
  }

  async refreshLongLivedToken(token: string) {
    const res = await fetch(
      `${IG_GRAPH_API}/access_token?grant_type=ig_refresh_token&access_token=${token}`
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Instagram token refresh failed");
    }

    return {
      accessToken: data.access_token,
      tokenType: "bearer",
      expiresIn: data.expires_in,
    };
  }
}
