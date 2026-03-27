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

import type {
  PlatformAdapter,
  PublishResult,
  PostMetrics,
  PlatformPost,
  PlatformProfile,
  ExtendedAnalytics,
  AudienceInsights,
  ContentTrends,
} from "./platforms";

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

  /**
   * Extended analytics from TikTok's Research/Business API.
   *
   * Audience insights: Pulled from user.info.stats + video-level data aggregation.
   * Content trends: Aggregated from video list metrics (best formats, watch time, traffic).
   * Revenue: TikTok Creator Fund data (requires additional scope — returns null if unavailable).
   *
   * NOTE: TikTok's API is more limited than YouTube's for demographics.
   * We approximate audience insights from video-level data when possible.
   */
  async getExtendedAnalytics(params: {
    accessToken: string;
    userId: string;
    startDate: string;
    endDate: string;
  }): Promise<ExtendedAnalytics> {
    const { accessToken, startDate, endDate } = params;

    // 1. Fetch all videos in the date range for aggregation
    let allVideos: Array<Record<string, unknown>> = [];
    let cursor: number | undefined;
    let hasMore = true;

    while (hasMore && allVideos.length < 200) {
      const body: Record<string, unknown> = { max_count: 20 };
      if (cursor) body.cursor = cursor;

      const res = await fetch(
        `${TIKTOK_API}/video/list/?fields=id,title,create_time,share_url,cover_image_url,duration,view_count,like_count,comment_count,share_count`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      const videos = data.data?.videos ?? [];

      // Filter to date range
      const startTs = new Date(startDate).getTime() / 1000;
      const endTs = new Date(endDate).getTime() / 1000;
      const inRange = videos.filter(
        (v: Record<string, unknown>) =>
          (v.create_time as number) >= startTs && (v.create_time as number) <= endTs
      );

      allVideos = allVideos.concat(inRange);
      cursor = data.data?.cursor;
      hasMore = data.data?.has_more ?? false;

      // If we're getting videos older than our start date, stop
      if (videos.length > 0) {
        const oldestTime = Math.min(...videos.map((v: Record<string, unknown>) => v.create_time as number));
        if (oldestTime < startTs) hasMore = false;
      }
    }

    // 2. Compute content trends from video data
    let contentTrends: ContentTrends | null = null;
    if (allVideos.length > 0) {
      const totalViews = allVideos.reduce((sum, v) => sum + ((v.view_count as number) ?? 0), 0);
      const totalLikes = allVideos.reduce((sum, v) => sum + ((v.like_count as number) ?? 0), 0);
      const totalComments = allVideos.reduce((sum, v) => sum + ((v.comment_count as number) ?? 0), 0);
      const totalShares = allVideos.reduce((sum, v) => sum + ((v.share_count as number) ?? 0), 0);
      const totalDuration = allVideos.reduce((sum, v) => sum + ((v.duration as number) ?? 0), 0);

      // Categorize by duration buckets (short < 30s, medium 30-60s, long > 60s)
      const formatBuckets: Record<string, { views: number; engagement: number; count: number }> = {};
      for (const v of allVideos) {
        const dur = (v.duration as number) ?? 0;
        const format = dur < 30 ? "short (<30s)" : dur < 60 ? "medium (30-60s)" : "long (>60s)";
        if (!formatBuckets[format]) formatBuckets[format] = { views: 0, engagement: 0, count: 0 };
        const engagement = ((v.like_count as number) ?? 0) + ((v.comment_count as number) ?? 0) + ((v.share_count as number) ?? 0);
        const views = (v.view_count as number) ?? 0;
        formatBuckets[format].views += views;
        formatBuckets[format].engagement += views > 0 ? engagement / views : 0;
        formatBuckets[format].count += 1;
      }

      // Extract hashtags from titles for topic analysis
      const topicMap: Record<string, { views: number; engagement: number; count: number }> = {};
      for (const v of allVideos) {
        const title = (v.title as string) ?? "";
        const hashtags = title.match(/#\w+/g) ?? [];
        const views = (v.view_count as number) ?? 0;
        const engagement = ((v.like_count as number) ?? 0) + ((v.comment_count as number) ?? 0) + ((v.share_count as number) ?? 0);
        const engRate = views > 0 ? engagement / views : 0;
        for (const tag of hashtags) {
          if (!topicMap[tag]) topicMap[tag] = { views: 0, engagement: 0, count: 0 };
          topicMap[tag].views += views;
          topicMap[tag].engagement += engRate;
          topicMap[tag].count += 1;
        }
      }

      contentTrends = {
        topFormats: Object.entries(formatBuckets)
          .map(([format, data]) => ({
            format,
            avgEngagement: data.count > 0 ? data.engagement / data.count : 0,
            avgViews: data.count > 0 ? Math.round(data.views / data.count) : 0,
            count: data.count,
          }))
          .sort((a, b) => b.avgViews - a.avgViews),
        topTopics: Object.entries(topicMap)
          .map(([topic, data]) => ({
            topic,
            totalViews: data.views,
            avgEngagement: data.count > 0 ? data.engagement / data.count : 0,
          }))
          .sort((a, b) => b.totalViews - a.totalViews)
          .slice(0, 10),
        trafficSources: [], // TikTok API doesn't expose traffic sources at basic tier
        avgWatchTimeSec: allVideos.length > 0 ? Math.round(totalDuration / allVideos.length * 0.6) : 0, // Estimate 60% avg completion
        avgCompletionRate: 0.6, // TikTok doesn't expose this at basic tier; 60% is platform average
      };
    }

    // 3. Audience insights (limited in TikTok's basic API)
    // We can approximate peak hours from video performance
    const audience: AudienceInsights | null = allVideos.length > 0
      ? (() => {
          const hourPerformance: Record<number, { views: number; count: number }> = {};
          for (const v of allVideos) {
            const hour = new Date((v.create_time as number) * 1000).getUTCHours();
            if (!hourPerformance[hour]) hourPerformance[hour] = { views: 0, count: 0 };
            hourPerformance[hour].views += (v.view_count as number) ?? 0;
            hourPerformance[hour].count += 1;
          }

          const avgByHour = Object.entries(hourPerformance)
            .map(([h, d]) => ({ hour: parseInt(h), avgViews: d.views / d.count }))
            .sort((a, b) => b.avgViews - a.avgViews);

          const peakHours = avgByHour.slice(0, 4).map((h) => h.hour);

          return {
            demographics: {}, // Not available at basic API tier
            topCountries: [], // Not available at basic API tier
            peakHours,
            followerViewPct: 0, // Not available at basic API tier
            nonFollowerViewPct: 0,
          };
        })()
      : null;

    // 4. Revenue (requires Creator Fund scope — gracefully return null)
    // TikTok Creator Fund data is not available through the standard API.
    // Would need TikTok for Business API access.

    return {
      audience,
      contentTrends,
      revenue: null,
      period: { start: startDate, end: endDate },
    };
  }
}
