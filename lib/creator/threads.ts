/**
 * Threads API adapter for Creator OS.
 *
 * Threads API flow for publishing:
 * 1. Create a media container (POST /{user-id}/threads)
 * 2. Publish the container (POST /{user-id}/threads_publish)
 *
 * Rate limits: 250 posts per 24 hours.
 * Docs: https://developers.facebook.com/docs/threads
 */

import type { PlatformAdapter, PublishResult, PostMetrics } from "./platforms";

const THREADS_API = "https://graph.threads.net/v1.0";
const THREADS_OAUTH = "https://graph.threads.net/oauth";

export class ThreadsAdapter implements PlatformAdapter {
  platform = "threads";

  async publish(params: {
    accessToken: string;
    userId: string;
    body: string;
    mediaUrls?: string[];
    contentType: "text" | "image" | "carousel" | "reel";
  }): Promise<PublishResult> {
    const { accessToken, userId, body, mediaUrls, contentType } = params;

    try {
      // Step 1: Create media container
      const containerParams: Record<string, string> = {
        access_token: accessToken,
        text: body,
      };

      if (contentType === "text") {
        containerParams.media_type = "TEXT";
      } else if (contentType === "image" && mediaUrls?.[0]) {
        containerParams.media_type = "IMAGE";
        containerParams.image_url = mediaUrls[0];
      } else if (contentType === "carousel" && mediaUrls?.length) {
        // Carousel requires creating child containers first
        const childIds = await this.createCarouselChildren(accessToken, userId, mediaUrls, body);
        containerParams.media_type = "CAROUSEL";
        containerParams.children = childIds.join(",");
      } else if (contentType === "reel" && mediaUrls?.[0]) {
        containerParams.media_type = "VIDEO";
        containerParams.video_url = mediaUrls[0];
      }

      const containerRes = await fetch(`${THREADS_API}/${userId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(containerParams),
      });
      const containerData = await containerRes.json();

      if (!containerRes.ok || containerData.error) {
        return {
          success: false,
          error: containerData.error?.message ?? `Container creation failed (${containerRes.status})`,
        };
      }

      const containerId = containerData.id;

      // Step 2: Publish the container
      const publishRes = await fetch(`${THREADS_API}/${userId}/threads_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          access_token: accessToken,
          creation_id: containerId,
        }),
      });
      const publishData = await publishRes.json();

      if (!publishRes.ok || publishData.error) {
        return {
          success: false,
          error: publishData.error?.message ?? `Publish failed (${publishRes.status})`,
        };
      }

      return {
        success: true,
        postId: publishData.id,
        postUrl: `https://www.threads.net/@${params.userId}/post/${publishData.id}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown publish error",
      };
    }
  }

  private async createCarouselChildren(
    accessToken: string,
    userId: string,
    mediaUrls: string[],
    text: string
  ): Promise<string[]> {
    const childIds: string[] = [];

    for (let i = 0; i < mediaUrls.length; i++) {
      const isImage = !mediaUrls[i].match(/\.(mp4|mov|avi)$/i);
      const childParams: Record<string, string> = {
        access_token: accessToken,
        media_type: isImage ? "IMAGE" : "VIDEO",
        is_carousel_item: "true",
      };

      if (isImage) {
        childParams.image_url = mediaUrls[i];
      } else {
        childParams.video_url = mediaUrls[i];
      }

      // Only first item gets the caption
      if (i === 0) {
        childParams.text = text;
      }

      const res = await fetch(`${THREADS_API}/${userId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(childParams),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(`Carousel child ${i} failed: ${data.error?.message}`);
      }

      childIds.push(data.id);
    }

    return childIds;
  }

  async getPostMetrics(params: {
    accessToken: string;
    postId: string;
  }): Promise<PostMetrics> {
    const { accessToken, postId } = params;

    const fields = "views,likes,replies,reposts,quotes";
    const res = await fetch(
      `${THREADS_API}/${postId}/insights?metric=${fields}&access_token=${accessToken}`
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Failed to fetch post metrics");
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
        case "views":
          metrics.impressions = val;
          break;
        case "likes":
          metrics.likes = val;
          break;
        case "replies":
          metrics.replies = val;
          break;
        case "reposts":
          metrics.reposts = val;
          break;
        case "quotes":
          metrics.quotes = val;
          break;
      }
    }

    return metrics;
  }

  async exchangeCodeForToken(code: string, redirectUri: string) {
    const appId = process.env.THREADS_APP_ID;
    const appSecret = process.env.THREADS_APP_SECRET;
    if (!appId || !appSecret) throw new Error("Missing THREADS_APP_ID or THREADS_APP_SECRET");

    // Step 1: Exchange code for short-lived token
    const shortRes = await fetch(`${THREADS_OAUTH}/access_token`, {
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

    if (!shortRes.ok || shortData.error) {
      throw new Error(shortData.error_message ?? "Short-lived token exchange failed");
    }

    // Step 2: Exchange short-lived for long-lived token (~60 days)
    const longRes = await fetch(
      `${THREADS_OAUTH}/access_token?grant_type=th_exchange_token&client_secret=${appSecret}&access_token=${shortData.access_token}`
    );
    const longData = await longRes.json();

    if (!longRes.ok || longData.error) {
      throw new Error(longData.error_message ?? "Long-lived token exchange failed");
    }

    // Step 3: Get user profile
    const profileRes = await fetch(
      `${THREADS_API}/me?fields=id,username&access_token=${longData.access_token}`
    );
    const profile = await profileRes.json();

    return {
      accessToken: longData.access_token,
      tokenType: longData.token_type ?? "bearer",
      expiresIn: longData.expires_in,
      userId: profile.id ?? shortData.user_id,
      username: profile.username,
    };
  }

  async refreshLongLivedToken(token: string) {
    const res = await fetch(
      `${THREADS_OAUTH}/access_token?grant_type=th_refresh_token&access_token=${token}`
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error_message ?? "Token refresh failed");
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type ?? "bearer",
      expiresIn: data.expires_in,
    };
  }
}
