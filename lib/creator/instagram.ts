/**
 * Instagram Graph API adapter for Creator OS.
 *
 * Uses the Instagram Graph API (via Facebook) for profile stats and post metrics.
 * Docs: https://developers.facebook.com/docs/instagram-api
 */

import type { PlatformAdapter, PublishResult, PostMetrics, PlatformPost, PlatformProfile } from "./platforms";

const IG_GRAPH_API = "https://graph.facebook.com/v19.0";

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
      throw new Error(data.error?.message ?? "Failed to fetch Instagram profile");
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
        case "saved":
          metrics.quotes = val; // map saves to quotes slot
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
    const { accessToken, userId, since, limit = 50 } = params;

    const url = new URL(`${IG_GRAPH_API}/${userId}/media`);
    url.searchParams.set("fields", "id,caption,media_type,media_url,permalink,timestamp");
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("limit", String(Math.min(limit, 100)));
    if (since) {
      url.searchParams.set("since", since);
    }

    const res = await fetch(url.toString());
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Failed to list Instagram posts");
    }

    return ((data.data ?? []) as Array<Record<string, unknown>>).slice(0, limit).map((item) => {
      let contentType: PlatformPost["contentType"] = "image";
      if (item.media_type === "VIDEO") contentType = "reel";
      else if (item.media_type === "CAROUSEL_ALBUM") contentType = "carousel";

      return {
        postId: item.id as string,
        body: (item.caption as string) ?? "",
        mediaUrls: item.media_url ? [item.media_url as string] : undefined,
        contentType,
        permalink: item.permalink as string | undefined,
        timestamp: item.timestamp as string,
      };
    });
  }

  async publish(params: {
    accessToken: string;
    userId: string;
    body: string;
    mediaUrls?: string[];
    contentType: "text" | "image" | "carousel" | "reel" | "thread";
  }): Promise<PublishResult> {
    // Instagram requires media — text-only posts are not supported
    const { accessToken, userId, body, mediaUrls, contentType } = params;

    if (!mediaUrls?.length) {
      return { success: false, error: "Instagram requires at least one media URL" };
    }

    try {
      if (contentType === "carousel" && mediaUrls.length > 1) {
        return await this.publishCarousel(accessToken, userId, body, mediaUrls);
      }

      // Single image or reel
      const containerParams: Record<string, string> = {
        access_token: accessToken,
        caption: body,
      };

      if (contentType === "reel") {
        containerParams.media_type = "REELS";
        containerParams.video_url = mediaUrls[0];
      } else {
        containerParams.image_url = mediaUrls[0];
      }

      const containerRes = await fetch(`${IG_GRAPH_API}/${userId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(containerParams),
      });
      const containerData = await containerRes.json();

      if (!containerRes.ok || containerData.error) {
        return { success: false, error: containerData.error?.message ?? "Container creation failed" };
      }

      const publishRes = await fetch(`${IG_GRAPH_API}/${userId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          access_token: accessToken,
          creation_id: containerData.id,
        }),
      });
      const publishData = await publishRes.json();

      if (!publishRes.ok || publishData.error) {
        return { success: false, error: publishData.error?.message ?? "Publish failed" };
      }

      return {
        success: true,
        postId: publishData.id,
        postUrl: `https://www.instagram.com/p/${publishData.id}`,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  private async publishCarousel(
    accessToken: string,
    userId: string,
    caption: string,
    mediaUrls: string[]
  ): Promise<PublishResult> {
    const childIds: string[] = [];

    for (const url of mediaUrls) {
      const isVideo = /\.(mp4|mov|avi)$/i.test(url);
      const params: Record<string, string> = {
        access_token: accessToken,
        is_carousel_item: "true",
      };
      if (isVideo) {
        params.media_type = "VIDEO";
        params.video_url = url;
      } else {
        params.image_url = url;
      }

      const res = await fetch(`${IG_GRAPH_API}/${userId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(`Carousel child failed: ${data.error?.message}`);
      }
      childIds.push(data.id);
    }

    const containerRes = await fetch(`${IG_GRAPH_API}/${userId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: accessToken,
        media_type: "CAROUSEL",
        caption,
        children: childIds.join(","),
      }),
    });
    const containerData = await containerRes.json();

    if (!containerRes.ok || containerData.error) {
      return { success: false, error: containerData.error?.message ?? "Carousel container failed" };
    }

    const publishRes = await fetch(`${IG_GRAPH_API}/${userId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: accessToken,
        creation_id: containerData.id,
      }),
    });
    const publishData = await publishRes.json();

    if (!publishRes.ok || publishData.error) {
      return { success: false, error: publishData.error?.message ?? "Carousel publish failed" };
    }

    return {
      success: true,
      postId: publishData.id,
      postUrl: `https://www.instagram.com/p/${publishData.id}`,
    };
  }

  async exchangeCodeForToken(code: string, redirectUri: string) {
    const appId = process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.INSTAGRAM_APP_SECRET;
    if (!appId || !appSecret) throw new Error("Missing INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET");

    // Short-lived token
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
      throw new Error(shortData.error_message ?? "Token exchange failed");
    }

    // Long-lived token
    const longRes = await fetch(
      `${IG_GRAPH_API}/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${shortData.access_token}`
    );
    const longData = await longRes.json();

    return {
      accessToken: longData.access_token ?? shortData.access_token,
      tokenType: "bearer",
      expiresIn: longData.expires_in,
      userId: String(shortData.user_id),
      username: shortData.user?.username,
    };
  }

  async refreshLongLivedToken(token: string) {
    const res = await fetch(
      `${IG_GRAPH_API}/access_token?grant_type=ig_refresh_token&access_token=${token}`
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Token refresh failed");
    }

    return {
      accessToken: data.access_token,
      tokenType: "bearer",
      expiresIn: data.expires_in,
    };
  }
}
