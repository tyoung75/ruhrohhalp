/**
 * Instagram adapter for Creator OS.
 *
 * Uses Facebook Login for Business OAuth (facebook.com/dialog/oauth) to obtain
 * tokens, then the Instagram Graph API for publishing, insights, and analytics.
 *
 * Token exchange goes through graph.facebook.com. After getting the token,
 * we look up the user's Instagram Business Account ID via their connected
 * Facebook Page.
 *
 * Docs: https://developers.facebook.com/docs/instagram-platform
 */

import type { PlatformAdapter, PublishResult, PostMetrics, PlatformPost, PlatformProfile } from "./platforms";

const IG_GRAPH = "https://graph.instagram.com/v21.0";
const FB_GRAPH = "https://graph.facebook.com/v21.0";

export class InstagramAdapter implements PlatformAdapter {
  platform = "instagram";

  async getProfile(params: {
    accessToken: string;
    userId: string;
  }): Promise<PlatformProfile> {
    const { accessToken, userId } = params;

    const res = await fetch(
      `${IG_GRAPH}/${userId}?fields=followers_count,follows_count,media_count,username,name&access_token=${accessToken}`
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
        name: data.name,
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
    const { accessToken, userId, body, mediaUrls, contentType } = params;

    try {
      if (contentType === "carousel" && mediaUrls && mediaUrls.length > 1) {
        return await this.publishCarousel(accessToken, userId, body, mediaUrls);
      }

      if ((contentType === "reel" || contentType === "image") && mediaUrls?.[0]) {
        return await this.publishMedia(accessToken, userId, body, mediaUrls[0], contentType);
      }

      // Instagram doesn't support text-only posts
      return { success: false, error: "Instagram requires media (image, carousel, or reel) for publishing" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown publish error",
      };
    }
  }

  private async publishMedia(
    accessToken: string,
    userId: string,
    caption: string,
    mediaUrl: string,
    type: string
  ): Promise<PublishResult> {
    const params: Record<string, string> = {
      access_token: accessToken,
      caption,
    };

    if (type === "reel") {
      params.media_type = "REELS";
      params.video_url = mediaUrl;
    } else {
      params.image_url = mediaUrl;
    }

    // Step 1: Create media container
    const containerRes = await fetch(`${IG_GRAPH}/${userId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const containerData = await containerRes.json();

    if (!containerRes.ok || containerData.error) {
      return { success: false, error: containerData.error?.message ?? "Container creation failed" };
    }

    // Step 2: Publish container
    const publishRes = await fetch(`${IG_GRAPH}/${userId}/media_publish`, {
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
  }

  private async publishCarousel(
    accessToken: string,
    userId: string,
    caption: string,
    mediaUrls: string[]
  ): Promise<PublishResult> {
    // Create child containers
    const childIds: string[] = [];
    for (const url of mediaUrls) {
      const isVideo = /\.(mp4|mov|avi)$/i.test(url);
      const params: Record<string, string> = {
        access_token: accessToken,
        is_carousel_item: "true",
        ...(isVideo ? { media_type: "VIDEO", video_url: url } : { image_url: url }),
      };

      const res = await fetch(`${IG_GRAPH}/${userId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(`Carousel child failed: ${data.error?.message}`);
      childIds.push(data.id);
    }

    // Create carousel container
    const containerRes = await fetch(`${IG_GRAPH}/${userId}/media`, {
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

    // Publish
    const publishRes = await fetch(`${IG_GRAPH}/${userId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: accessToken,
        creation_id: containerData.id,
      }),
    });
    const publishData = await publishRes.json();

    return publishData.error
      ? { success: false, error: publishData.error.message }
      : { success: true, postId: publishData.id };
  }

  async getPostMetrics(params: {
    accessToken: string;
    postId: string;
  }): Promise<PostMetrics> {
    const { accessToken, postId } = params;

    const res = await fetch(
      `${IG_GRAPH}/${postId}/insights?metric=impressions,reach,likes,comments,shares,saved&access_token=${accessToken}`
    );
    const data = await res.json();

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
        case "impressions": metrics.impressions = val; break;
        case "likes": metrics.likes = val; break;
        case "comments": metrics.replies = val; break;
        case "shares": metrics.reposts = val; break;
        case "saved": metrics.quotes = val; break; // reuse quotes field for saves
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
    const { accessToken, userId, limit = 25 } = params;

    const res = await fetch(
      `${IG_GRAPH}/${userId}/media?fields=id,caption,media_type,media_url,permalink,timestamp&limit=${limit}&access_token=${accessToken}`
    );
    const data = await res.json();

    return (data.data ?? []).map((item: Record<string, unknown>) => {
      let contentType: PlatformPost["contentType"] = "image";
      if (item.media_type === "CAROUSEL_ALBUM") contentType = "carousel";
      else if (item.media_type === "VIDEO") contentType = "reel";

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

  async exchangeCodeForToken(code: string, redirectUri: string) {
    const appId = process.env.META_APP_ID ?? process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.META_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET;
    if (!appId || !appSecret) throw new Error("Missing META_APP_ID/INSTAGRAM_APP_ID or META_APP_SECRET/INSTAGRAM_APP_SECRET");

    // Step 1: Exchange code for short-lived token via Facebook Graph API
    const shortRes = await fetch(`${FB_GRAPH}/oauth/access_token`, {
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
    if (shortData.error) throw new Error(shortData.error.message);

    // Step 2: Exchange for long-lived token (~60 days)
    const longRes = await fetch(
      `${FB_GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortData.access_token}`
    );
    const longData = await longRes.json();
    if (longData.error) throw new Error(longData.error.message);

        // Step 3: Get IG Business Account ID via connected Facebook Page
    const pagesRes = await fetch(
      `${FB_GRAPH}/me/accounts?fields=id,name,instagram_business_account&access_token=${longData.access_token}`
    );
    const pagesData = await pagesRes.json();
    console.log("[instagram-oauth] Pages response:", JSON.stringify(pagesData));

    // Search all pages for one with an instagram_business_account
    let igId: string | undefined;
    for (const page of pagesData.data ?? []) {
      if (page.instagram_business_account?.id) {
        igId = page.instagram_business_account.id;
        console.log(`[instagram-oauth] Found IG Business Account ${igId} on page "${page.name}" (${page.id})`);
        break;
      }
    }

    if (!igId) {
      console.error("[instagram-oauth] No Instagram Business Account found on any connected Facebook Page");
      throw new Error(
        "No Instagram Business Account found. Make sure your Instagram account is connected to a Facebook Page and set as a Business or Creator account."
      );
    }

    // Step 4: Fetch the Instagram username
    const profileRes = await fetch(
      `${IG_GRAPH}/${igId}?fields=username,name&access_token=${longData.access_token}`
    );
    const profileData = await profileRes.json();
    const username = profileData.username ?? undefined;
    console.log(`[instagram-oauth] IG profile: @${username} (ID: ${igId})`);

    return {
      accessToken: longData.access_token,
      tokenType: "bearer",
      expiresIn: longData.expires_in,
      userId: igId,
      username,
    };
  }

  async refreshLongLivedToken(token: string) {
    const appId = process.env.META_APP_ID ?? process.env.INSTAGRAM_APP_ID;
    const appSecret = process.env.META_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET;
    const res = await fetch(
      `${FB_GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${token}`
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    return {
      accessToken: data.access_token,
      tokenType: "bearer",
      expiresIn: data.expires_in ?? 5184000,
    };
  }
}
