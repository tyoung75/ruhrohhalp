/**
 * YouTube Data API adapter for Creator OS.
 *
 * Uses the YouTube Data API v3 for channel stats and video metrics.
 * Docs: https://developers.google.com/youtube/v3
 */

import type { PlatformAdapter, PublishResult, PostMetrics, PlatformPost, PlatformProfile } from "./platforms";

const YT_API = "https://www.googleapis.com/youtube/v3";

export class YouTubeAdapter implements PlatformAdapter {
  platform = "youtube";

  async getProfile(params: {
    accessToken: string;
    userId: string;
  }): Promise<PlatformProfile> {
    const { accessToken, userId } = params;

    // Try channel ID first, fall back to "mine"
    const idParam = userId ? `&id=${userId}` : "&mine=true";
    const res = await fetch(
      `${YT_API}/channels?part=statistics,snippet${idParam}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Failed to fetch YouTube channel");
    }

    const channel = data.items?.[0];
    if (!channel) {
      throw new Error("YouTube channel not found");
    }

    const stats = channel.statistics ?? {};

    return {
      followers: Number(stats.subscriberCount ?? 0),
      following: 0, // YouTube doesn't expose subscriptions count via this endpoint
      postsCount: Number(stats.videoCount ?? 0),
      extras: {
        title: channel.snippet?.title,
        viewCount: Number(stats.viewCount ?? 0),
        hiddenSubscriberCount: stats.hiddenSubscriberCount,
      },
    };
  }

  async getPostMetrics(params: {
    accessToken: string;
    postId: string;
  }): Promise<PostMetrics> {
    const { accessToken, postId } = params;

    const res = await fetch(
      `${YT_API}/videos?part=statistics&id=${postId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Failed to fetch YouTube video metrics");
    }

    const stats = data.items?.[0]?.statistics ?? {};

    return {
      impressions: Number(stats.viewCount ?? 0),
      likes: Number(stats.likeCount ?? 0),
      replies: Number(stats.commentCount ?? 0),
      reposts: 0, // YouTube doesn't have a share count in Data API
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
    const { accessToken, userId, since, limit = 50 } = params;

    // First get the uploads playlist
    const channelParam = userId ? `&id=${userId}` : "&mine=true";
    const channelRes = await fetch(
      `${YT_API}/channels?part=contentDetails${channelParam}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const channelData = await channelRes.json();
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) {
      return [];
    }

    const res = await fetch(
      `${YT_API}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${Math.min(limit, 50)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Failed to list YouTube videos");
    }

    return ((data.items ?? []) as Array<Record<string, unknown>>)
      .map((item) => {
        const snippet = item.snippet as Record<string, unknown>;
        return {
          postId: (snippet.resourceId as Record<string, unknown>)?.videoId as string,
          body: (snippet.title as string) ?? "",
          contentType: "reel" as const,
          permalink: `https://www.youtube.com/watch?v=${(snippet.resourceId as Record<string, unknown>)?.videoId}`,
          timestamp: snippet.publishedAt as string,
        };
      })
      .filter((p) => {
        if (!since) return true;
        return new Date(p.timestamp) >= new Date(since);
      })
      .slice(0, limit);
  }

  async publish(): Promise<PublishResult> {
    // YouTube upload requires resumable upload protocol — not practical via simple API call.
    return { success: false, error: "YouTube publishing requires the resumable upload API — use YouTube Studio" };
  }

  async exchangeCodeForToken(code: string, redirectUri: string) {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error_description ?? "YouTube token exchange failed");
    }

    // Get channel info
    const channelRes = await fetch(
      `${YT_API}/channels?part=snippet&mine=true`,
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    );
    const channelData = await channelRes.json();
    const channel = channelData.items?.[0];

    return {
      accessToken: data.access_token,
      tokenType: data.token_type ?? "bearer",
      expiresIn: data.expires_in,
      userId: channel?.id ?? "",
      username: channel?.snippet?.title,
    };
  }

  async refreshLongLivedToken(token: string) {
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: token,
      }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error_description ?? "YouTube token refresh failed");
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type ?? "bearer",
      expiresIn: data.expires_in,
    };
  }
}
