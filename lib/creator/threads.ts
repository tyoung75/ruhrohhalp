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

import type { PlatformAdapter, PublishResult, PostMetrics, PlatformPost } from "./platforms";

const THREADS_API = "https://graph.threads.net/v1.0";
const THREADS_OAUTH = "https://graph.threads.net/oauth";

/** Pause for `ms` milliseconds — used between thread replies. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll a media container until its status is FINISHED (or error/timeout).
 * Threads needs a moment after container creation before publish will work,
 * especially for reply chains where the parent must be fully indexed.
 */
async function waitForContainer(
  containerId: string,
  accessToken: string,
  maxAttempts = 10,
  intervalMs = 2000
): Promise<{ ready: boolean; error?: string }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(
      `${THREADS_API}/${containerId}?fields=status,error_message&access_token=${accessToken}`
    );
    const data = await res.json();

    if (data.status === "FINISHED") return { ready: true };
    if (data.status === "ERROR") {
      return { ready: false, error: data.error_message ?? "Container error" };
    }
    // IN_PROGRESS — keep waiting
    await sleep(intervalMs);
  }
  return { ready: false, error: "Container timed out waiting for FINISHED status" };
}

export class ThreadsAdapter implements PlatformAdapter {
  platform = "threads";

  async publish(params: {
    accessToken: string;
    userId: string;
    body: string;
    mediaUrls?: string[];
    contentType: "text" | "image" | "carousel" | "reel" | "thread";
  }): Promise<PublishResult> {
    const { accessToken, userId, body, mediaUrls, contentType } = params;

    try {
      // Multi-post thread: body is a JSON array of strings, each becomes a chained reply
      if (contentType === "thread") {
        return await this.publishThread(accessToken, userId, body);
      }

      // Single post flow
      return await this.publishSinglePost(accessToken, userId, body, mediaUrls, contentType);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown publish error",
      };
    }
  }

  /**
   * Publish a single post (text, image, carousel, or reel).
   */
  private async publishSinglePost(
    accessToken: string,
    userId: string,
    body: string,
    mediaUrls?: string[],
    contentType?: string
  ): Promise<PublishResult> {
    const containerParams: Record<string, string> = {
      access_token: accessToken,
      text: body,
    };

    if (contentType === "text" || !contentType) {
      containerParams.media_type = "TEXT";
    } else if (contentType === "image" && mediaUrls?.[0]) {
      containerParams.media_type = "IMAGE";
      containerParams.image_url = mediaUrls[0];
    } else if (contentType === "carousel" && mediaUrls?.length) {
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

    // Wait for container to be ready before publishing
    const status = await waitForContainer(containerData.id, accessToken);
    if (!status.ready) {
      return { success: false, error: status.error ?? "Container not ready" };
    }

    const publishRes = await fetch(`${THREADS_API}/${userId}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: accessToken,
        creation_id: containerData.id,
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
      postUrl: `https://www.threads.net/@${userId}/post/${publishData.id}`,
    };
  }

  /**
   * Publish a multi-post thread (reply chain).
   *
   * Body is a JSON array of strings: ["Post 1/3 text", "Post 2/3 text", "Post 3/3 text"]
   * Each post is published as a reply to the previous one, creating the
   * "Add to thread" chain visible in the Threads app.
   */
  private async publishThread(
    accessToken: string,
    userId: string,
    body: string
  ): Promise<PublishResult> {
    let parts: string[];
    try {
      parts = JSON.parse(body);
      if (!Array.isArray(parts) || parts.length === 0) {
        return { success: false, error: "Thread body must be a non-empty JSON array of strings" };
      }
    } catch {
      // Fallback: if body isn't JSON, treat as a single post
      return await this.publishSinglePost(accessToken, userId, body, undefined, "text");
    }

    const publishedIds: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      // Wait between replies so the parent post is fully indexed by Threads.
      // The first post needs no delay; subsequent posts wait 5s for propagation.
      if (i > 0) {
        await sleep(5000);
      }

      const containerParams: Record<string, string> = {
        access_token: accessToken,
        media_type: "TEXT",
        text: parts[i],
      };

      // Chain as reply to the previous post
      if (i > 0 && publishedIds.length > 0) {
        containerParams.reply_to_id = publishedIds[i - 1];
      }

      // Create container
      const containerRes = await fetch(`${THREADS_API}/${userId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(containerParams),
      });
      const containerData = await containerRes.json();

      if (!containerRes.ok || containerData.error) {
        return {
          success: false,
          error: `Thread part ${i + 1}/${parts.length} container failed: ${containerData.error?.message ?? containerRes.status}`,
          // Return the first post ID if we got at least one out
          ...(publishedIds.length > 0 ? { postId: publishedIds[0] } : {}),
        };
      }

      // Wait for container to reach FINISHED status before publishing
      const status = await waitForContainer(containerData.id, accessToken);
      if (!status.ready) {
        return {
          success: false,
          error: `Thread part ${i + 1}/${parts.length} container not ready: ${status.error}`,
          ...(publishedIds.length > 0 ? { postId: publishedIds[0] } : {}),
        };
      }

      // Publish container
      const publishRes = await fetch(`${THREADS_API}/${userId}/threads_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          access_token: accessToken,
          creation_id: containerData.id,
        }),
      });
      const publishData = await publishRes.json();

      if (!publishRes.ok || publishData.error) {
        return {
          success: false,
          error: `Thread part ${i + 1}/${parts.length} publish failed: ${publishData.error?.message ?? publishRes.status}`,
          ...(publishedIds.length > 0 ? { postId: publishedIds[0] } : {}),
        };
      }

      publishedIds.push(publishData.id);
    }

    // Return the first post's ID — that's the thread root
    return {
      success: true,
      postId: publishedIds[0],
      postUrl: `https://www.threads.net/@${userId}/post/${publishedIds[0]}`,
    };
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

  async listUserPosts(params: {
    accessToken: string;
    userId: string;
    since?: string;
    limit?: number;
  }): Promise<PlatformPost[]> {
    const { accessToken, userId, since, limit = 50 } = params;

    const fields = "id,text,media_type,media_url,permalink,timestamp";
    const url = new URL(`${THREADS_API}/${userId}/threads`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("limit", String(Math.min(limit, 100)));
    if (since) {
      url.searchParams.set("since", since);
    }

    const posts: PlatformPost[] = [];
    let nextUrl: string | null = url.toString();

    while (nextUrl && posts.length < limit) {
      const res: Response = await fetch(nextUrl);
      const data: Record<string, unknown> = await res.json();

      const error = data.error as Record<string, unknown> | undefined;
      if (!res.ok || error) {
        throw new Error((error?.message as string) ?? "Failed to list user posts");
      }

      const items = (data.data ?? []) as Array<Record<string, unknown>>;
      for (const item of items) {
        // Map Threads media_type to our content_type
        let contentType: PlatformPost["contentType"] = "text";
        if (item.media_type === "IMAGE") contentType = "image";
        else if (item.media_type === "CAROUSEL_ALBUM") contentType = "carousel";
        else if (item.media_type === "VIDEO") contentType = "reel";

        posts.push({
          postId: item.id as string,
          body: (item.text as string) ?? "",
          mediaUrls: item.media_url ? [item.media_url as string] : undefined,
          contentType,
          permalink: item.permalink as string | undefined,
          timestamp: item.timestamp as string,
        });
      }

      // Pagination
      const paging = data.paging as Record<string, unknown> | undefined;
      nextUrl = (paging?.next as string) ?? null;
    }

    return posts.slice(0, limit);
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
