/**
 * YouTube Data API v3 adapter for Creator OS.
 *
 * Uses the YouTube Data API with just an API key (no OAuth needed for
 * public subscriber/view counts). For publishing, YouTube requires
 * OAuth — that flow is stubbed for now.
 *
 * Required env vars:
 *   YOUTUBE_API_KEY     — Google Cloud API key with YouTube Data API enabled
 *   YOUTUBE_CHANNEL_ID  — Tyler's YouTube channel ID
 *
 * Quota: 10,000 units/day. channels.list costs 1 unit per call.
 * Docs: https://developers.google.com/youtube/v3/docs/channels
 */

import type { PlatformAdapter, PublishResult, PostMetrics, PlatformPost, PlatformProfile } from "./platforms";

const YT_API = "https://www.googleapis.com/youtube/v3";

export class YouTubeAdapter implements PlatformAdapter {
  platform = "youtube";

  /**
   * Fetch channel statistics using just an API key.
   * The accessToken param is accepted for interface compatibility but
   * we prefer the API key since it doesn't expire.
   */
  async getProfile(params: {
    accessToken: string;
    userId: string;
  }): Promise<PlatformProfile> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = params.userId || process.env.YOUTUBE_CHANNEL_ID;

    if (!apiKey) throw new Error("Missing YOUTUBE_API_KEY env var");
    if (!channelId) throw new Error("Missing YouTube channel ID");

    const res = await fetch(
      `${YT_API}/channels?part=statistics,snippet&id=${channelId}&key=${apiKey}`
    );
    const data = await res.json();

    if (data.error) {
      throw new Error(data.error.message ?? "YouTube API error");
    }

    const channel = data.items?.[0];
    if (!channel) throw new Error(`YouTube channel not found: ${channelId}`);

    const stats = channel.statistics ?? {};

    return {
      followers: parseInt(stats.subscriberCount ?? "0", 10),
      following: 0, // YouTube doesn't expose subscriptions count via this endpoint
      postsCount: parseInt(stats.videoCount ?? "0", 10),
      extras: {
        channelTitle: channel.snippet?.title,
        viewCount: parseInt(stats.viewCount ?? "0", 10),
        hiddenSubscriberCount: stats.hiddenSubscriberCount ?? false,
        description: channel.snippet?.description?.slice(0, 200),
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
    // YouTube publishing requires OAuth + video upload via resumable upload API.
    // Community posts are only available to channels with 500+ subscribers.
    return {
      success: false,
      error: "YouTube publishing requires OAuth and video upload. Use YouTube Studio for now.",
    };
  }

  async getPostMetrics(params: {
    accessToken: string;
    postId: string;
  }): Promise<PostMetrics> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error("Missing YOUTUBE_API_KEY");

    const res = await fetch(
      `${YT_API}/videos?part=statistics&id=${params.postId}&key=${apiKey}`
    );
    const data = await res.json();
    const stats = data.items?.[0]?.statistics ?? {};

    return {
      impressions: parseInt(stats.viewCount ?? "0", 10),
      likes: parseInt(stats.likeCount ?? "0", 10),
      replies: parseInt(stats.commentCount ?? "0", 10),
      reposts: 0,
      quotes: 0, // YouTube doesn't have quotes
      followsGained: 0,
    };
  }

  async listUserPosts(params: {
    accessToken: string;
    userId: string;
    since?: string;
    limit?: number;
  }): Promise<PlatformPost[]> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = params.userId || process.env.YOUTUBE_CHANNEL_ID;
    if (!apiKey || !channelId) return [];

    // First get the uploads playlist ID
    const channelRes = await fetch(
      `${YT_API}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`
    );
    const channelData = await channelRes.json();
    const uploadsPlaylist = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylist) return [];

    // Then list videos from uploads playlist
    const res = await fetch(
      `${YT_API}/playlistItems?part=snippet&playlistId=${uploadsPlaylist}&maxResults=${params.limit ?? 10}&key=${apiKey}`
    );
    const data = await res.json();

    return (data.items ?? []).map((item: Record<string, unknown>) => {
      const snippet = item.snippet as Record<string, unknown>;
      const resourceId = snippet.resourceId as Record<string, unknown>;
      return {
        postId: resourceId?.videoId as string,
        body: (snippet.title as string) ?? "",
        contentType: "reel" as const,
        permalink: `https://youtube.com/watch?v=${resourceId?.videoId}`,
        timestamp: snippet.publishedAt as string,
      };
    });
  }

  async exchangeCodeForToken(code: string, redirectUri: string) {
    const clientId = process.env.YOUTUBE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Missing YouTube/Google OAuth credentials");

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
    if (data.error) throw new Error(data.error_description ?? "YouTube token exchange failed");

    // Get channel ID
    const channelRes = await fetch(
      `${YT_API}/channels?part=id,snippet&mine=true`,
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    );
    const channelData = await channelRes.json();
    const channel = channelData.items?.[0];

    return {
      accessToken: data.access_token,
      tokenType: "bearer",
      expiresIn: data.expires_in,
      userId: channel?.id ?? "",
      username: channel?.snippet?.title,
    };
  }

  async refreshLongLivedToken(token: string) {
    const clientId = process.env.YOUTUBE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Missing YouTube/Google OAuth credentials");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error_description ?? "YouTube refresh failed");

    return {
      accessToken: data.access_token,
      tokenType: "bearer",
      expiresIn: data.expires_in ?? 3600,
    };
  }
}
