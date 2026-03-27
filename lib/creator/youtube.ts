/**
 * YouTube Data API adapter for Creator OS.
 *
 * Uses YouTube Data API v3 for channel/subscriber data.
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
    const { accessToken } = params;

    const res = await fetch(
      `${YT_API}/channels?part=statistics,snippet&mine=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? `YouTube profile fetch failed (${res.status})`);
    }

    const channel = data.items?.[0];
    if (!channel) {
      throw new Error("No YouTube channel found for this account");
    }

    const stats = channel.statistics ?? {};

    return {
      followers: parseInt(stats.subscriberCount ?? "0", 10),
      following: 0, // YouTube doesn't have a "following" concept
      postsCount: parseInt(stats.videoCount ?? "0", 10),
      extras: {
        title: channel.snippet?.title,
        description: channel.snippet?.description,
        viewCount: parseInt(stats.viewCount ?? "0", 10),
        hiddenSubscriberCount: stats.hiddenSubscriberCount ?? false,
      },
    };
  }

  async publish(): Promise<PublishResult> {
    return { success: false, error: "YouTube publishing not yet implemented" };
  }

  async getPostMetrics(params: {
    accessToken: string;
    postId: string;
  }): Promise<PostMetrics> {
    const { accessToken, postId } = params;

    const res = await fetch(
      `${YT_API}/videos?part=statistics&id=${postId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Failed to fetch YouTube video metrics");
    }

    const stats = data.items?.[0]?.statistics ?? {};

    return {
      impressions: parseInt(stats.viewCount ?? "0", 10),
      likes: parseInt(stats.likeCount ?? "0", 10),
      replies: parseInt(stats.commentCount ?? "0", 10),
      reposts: 0,
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

    // Get the uploads playlist for the authenticated user's channel
    const channelRes = await fetch(
      `${YT_API}/channels?part=contentDetails&mine=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const channelData = await channelRes.json();
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) return [];

    const res = await fetch(
      `${YT_API}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${Math.min(limit, 50)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? "Failed to list YouTube videos");
    }

    return (data.items ?? []).map((item: Record<string, unknown>) => {
      const snippet = item.snippet as Record<string, unknown>;
      const resourceId = snippet?.resourceId as Record<string, unknown>;

      return {
        postId: (resourceId?.videoId as string) ?? "",
        body: (snippet?.title as string) ?? "",
        contentType: "reel" as const,
        permalink: `https://www.youtube.com/watch?v=${resourceId?.videoId}`,
        timestamp: (snippet?.publishedAt as string) ?? new Date().toISOString(),
      };
    });
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

    return {
      accessToken: data.access_token,
      tokenType: data.token_type ?? "bearer",
      expiresIn: data.expires_in,
      userId: "me", // YouTube uses "me" for the authenticated user
      username: undefined,
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
