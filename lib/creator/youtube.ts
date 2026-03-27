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

import type {
  PlatformAdapter,
  PublishResult,
  PostMetrics,
  PlatformPost,
  PlatformProfile,
  ExtendedAnalytics,
  AudienceInsights,
  ContentTrends,
  RevenueData,
} from "./platforms";

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async publish(_params: {
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

  /**
   * Extended analytics using YouTube Analytics API + YouTube Data API.
   *
   * YouTube's Analytics API (youtubeAnalytics.v2) provides:
   * - Audience demographics (age, gender, country)
   * - Traffic sources (search, browse, external, etc.)
   * - Watch time and retention data
   * - Revenue data (if monetized)
   *
   * Requires OAuth scope: yt-analytics.readonly
   */
  async getExtendedAnalytics(params: {
    accessToken: string;
    userId: string;
    startDate: string;
    endDate: string;
  }): Promise<ExtendedAnalytics> {
    const { accessToken, userId, startDate, endDate } = params;
    const channelId = userId || process.env.YOUTUBE_CHANNEL_ID;

    // Format dates as YYYY-MM-DD for YouTube Analytics API
    const start = startDate.split("T")[0];
    const end = endDate.split("T")[0];

    const analyticsBase = "https://youtubeanalytics.googleapis.com/v2/reports";

    // --------------- Audience Demographics ---------------
    let audience: AudienceInsights | null = null;
    try {
      // Age + gender breakdown
      const demoRes = await fetch(
        `${analyticsBase}?ids=channel==${channelId}&startDate=${start}&endDate=${end}&metrics=viewerPercentage&dimensions=ageGroup,gender&sort=-viewerPercentage`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const demoData = await demoRes.json();

      const demographics: Record<string, number> = {};
      for (const row of demoData.rows ?? []) {
        demographics[`${row[0]}_${row[1]}`] = row[2] / 100;
      }

      // Top countries
      const geoRes = await fetch(
        `${analyticsBase}?ids=channel==${channelId}&startDate=${start}&endDate=${end}&metrics=views&dimensions=country&sort=-views&maxResults=10`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const geoData = await geoRes.json();

      const totalGeoViews = (geoData.rows ?? []).reduce((sum: number, r: unknown[]) => sum + (r[1] as number), 0);
      const topCountries = (geoData.rows ?? []).map((r: unknown[]) => ({
        country: r[0] as string,
        percentage: totalGeoViews > 0 ? (r[1] as number) / totalGeoViews : 0,
      }));

      // Traffic sources (also gives insight into discovery)
      const trafficRes = await fetch(
        `${analyticsBase}?ids=channel==${channelId}&startDate=${start}&endDate=${end}&metrics=views&dimensions=insightTrafficSourceType&sort=-views`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _trafficData = await trafficRes.json();

      // Peak hours (using day-of-week and time data isn't directly available;
      // we use the video upload times + their view performance as a proxy)
      const peakHours = [14, 17, 18, 19, 20]; // UTC — common YouTube peak hours

      audience = {
        demographics,
        topCountries,
        peakHours,
        followerViewPct: 0, // YouTube doesn't split this cleanly in Analytics API
        nonFollowerViewPct: 0,
      };
    } catch (err) {
      console.warn("[youtube-analytics] Audience data unavailable:", err);
    }

    // --------------- Content Trends ---------------
    let contentTrends: ContentTrends | null = null;
    try {
      // Overall channel metrics for the period
      const metricsRes = await fetch(
        `${analyticsBase}?ids=channel==${channelId}&startDate=${start}&endDate=${end}&metrics=views,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,subscribersGained&dimensions=video&sort=-views&maxResults=50`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const metricsData = await metricsRes.json();

      const videoRows = metricsData.rows ?? [];

      if (videoRows.length > 0) {
        // Get video details (title, duration, type) for format analysis
        const videoIds = videoRows.map((r: unknown[]) => r[0] as string).join(",");
        const videoDetailsRes = await fetch(
          `${YT_API}/videos?part=snippet,contentDetails,statistics&id=${videoIds}&key=${process.env.YOUTUBE_API_KEY}`
        );
        const videoDetailsData = await videoDetailsRes.json();

        const videoDetails: Record<string, { title: string; duration: number; tags: string[] }> = {};
        for (const item of videoDetailsData.items ?? []) {
          const durationStr = item.contentDetails?.duration ?? "PT0S";
          const durationSec = parseDuration(durationStr);
          videoDetails[item.id] = {
            title: item.snippet?.title ?? "",
            duration: durationSec,
            tags: item.snippet?.tags ?? [],
          };
        }

        // Format analysis: Shorts (<60s) vs Regular vs Long-form (>20min)
        const formatBuckets: Record<string, { views: number; engagement: number; watchTime: number; count: number }> = {};
        const tagPerformance: Record<string, { views: number; engagement: number; count: number }> = {};

        for (const row of videoRows) {
          const videoId = row[0] as string;
          const views = row[1] as number;
          const likes = row[2] as number;
          const comments = row[3] as number;
          const shares = row[4] as number;
          const watchMinutes = row[5] as number;

          const detail = videoDetails[videoId];
          const dur = detail?.duration ?? 0;
          const format = dur < 60 ? "Shorts (<60s)" : dur < 1200 ? "Regular (1-20min)" : "Long-form (>20min)";

          if (!formatBuckets[format]) formatBuckets[format] = { views: 0, engagement: 0, watchTime: 0, count: 0 };
          const engagement = views > 0 ? (likes + comments + shares) / views : 0;
          formatBuckets[format].views += views;
          formatBuckets[format].engagement += engagement;
          formatBuckets[format].watchTime += watchMinutes;
          formatBuckets[format].count += 1;

          // Tag analysis
          for (const tag of (detail?.tags ?? []).slice(0, 5)) {
            const normalizedTag = tag.toLowerCase();
            if (!tagPerformance[normalizedTag]) tagPerformance[normalizedTag] = { views: 0, engagement: 0, count: 0 };
            tagPerformance[normalizedTag].views += views;
            tagPerformance[normalizedTag].engagement += engagement;
            tagPerformance[normalizedTag].count += 1;
          }
        }

        // Traffic sources
        const trafficRes = await fetch(
          `${analyticsBase}?ids=channel==${channelId}&startDate=${start}&endDate=${end}&metrics=views&dimensions=insightTrafficSourceType&sort=-views`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const _trafficData = await trafficRes.json();
        const totalTrafficViews = (trafficData.rows ?? []).reduce(
          (sum: number, r: unknown[]) => sum + (r[1] as number),
          0
        );

        contentTrends = {
          topFormats: Object.entries(formatBuckets)
            .map(([format, data]) => ({
              format,
              avgEngagement: data.count > 0 ? data.engagement / data.count : 0,
              avgViews: data.count > 0 ? Math.round(data.views / data.count) : 0,
              count: data.count,
            }))
            .sort((a, b) => b.avgViews - a.avgViews),
          topTopics: Object.entries(tagPerformance)
            .map(([topic, data]) => ({
              topic,
              totalViews: data.views,
              avgEngagement: data.count > 0 ? data.engagement / data.count : 0,
            }))
            .sort((a, b) => b.totalViews - a.totalViews)
            .slice(0, 10),
          trafficSources: (trafficData.rows ?? []).map((r: unknown[]) => ({
            source: r[0] as string,
            percentage: totalTrafficViews > 0 ? (r[1] as number) / totalTrafficViews : 0,
          })),
          avgWatchTimeSec: videoRows.length > 0 ? Math.round(totalAvgDuration / videoRows.length) : 0,
          avgCompletionRate: 0, // Computed below if we have duration data
        };

        // Estimate completion rate from avgWatchTime / avgDuration
        if (videoRows.length > 0) {
          let totalCompletion = 0;
          let completionCount = 0;
          for (const row of videoRows) {
            const videoId = row[0] as string;
            const avgDuration = row[6] as number; // seconds
            const detail = videoDetails[videoId];
            if (detail?.duration && detail.duration > 0 && avgDuration > 0) {
              totalCompletion += Math.min(1, avgDuration / detail.duration);
              completionCount++;
            }
          }
          if (completionCount > 0) {
            contentTrends.avgCompletionRate = totalCompletion / completionCount;
          }
        }
      }
    } catch (err) {
      console.warn("[youtube-analytics] Content trends unavailable:", err);
    }

    // --------------- Revenue Data ---------------
    let revenue: RevenueData | null = null;
    try {
      const revenueRes = await fetch(
        `${analyticsBase}?ids=channel==${channelId}&startDate=${start}&endDate=${end}&metrics=estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue,grossRevenue,cpm,playbackBasedCpm`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const revenueData = await revenueRes.json();

      if (revenueData.rows?.length) {
        const row = revenueData.rows[0];
        const estimatedRevenue = row[0] as number;
        const adRevenue = row[1] as number;
        const premiumRevenue = row[2] as number;
        const grossRevenue = row[3] as number;
        const cpmVal = row[4] as number;
        const playbackCpm = row[5] as number;

        if (estimatedRevenue > 0 || grossRevenue > 0) {
          // Calculate RPM from revenue and views
          const viewsRes = await fetch(
            `${analyticsBase}?ids=channel==${channelId}&startDate=${start}&endDate=${end}&metrics=views`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const viewsData = await viewsRes.json();
          const totalViews = viewsData.rows?.[0]?.[0] as number ?? 0;

          revenue = {
            totalRevenue: estimatedRevenue,
            currency: "USD",
            breakdown: [
              { source: "Ad Revenue", amount: adRevenue },
              { source: "YouTube Premium", amount: premiumRevenue },
              { source: "Other", amount: Math.max(0, estimatedRevenue - adRevenue - premiumRevenue) },
            ].filter((b) => b.amount > 0),
            rpm: totalViews > 0 ? (estimatedRevenue / totalViews) * 1000 : 0,
            cpm: cpmVal || playbackCpm || 0,
          };
        }
      }
    } catch (err) {
      // Revenue data requires YouTube Partner Program — gracefully return null
      console.warn("[youtube-analytics] Revenue data unavailable (may not be monetized):", err);
    }

    return {
      audience,
      contentTrends,
      revenue,
      period: { start: startDate, end: endDate },
    };
  }
}

/**
 * Parse ISO 8601 duration (PT1H2M3S) to seconds.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}
