/**
 * Platform adapter pattern for Creator OS.
 * Each platform implements a common interface for publishing, analytics, and token management.
 */

export interface PublishResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

export interface PostMetrics {
  impressions: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  followsGained: number;
}

/**
 * Extended analytics: audience demographics, content trends, and revenue.
 * Not all platforms expose all fields — adapters return what's available.
 */
export interface AudienceInsights {
  /** Age/gender breakdown (e.g., "18-24_male": 0.12) */
  demographics: Record<string, number>;
  /** Top countries by viewer percentage */
  topCountries: Array<{ country: string; percentage: number }>;
  /** Peak active hours (0-23 in UTC) */
  peakHours: number[];
  /** Follower vs non-follower view split */
  followerViewPct: number;
  nonFollowerViewPct: number;
}

export interface ContentTrends {
  /** Best performing content types with avg engagement */
  topFormats: Array<{ format: string; avgEngagement: number; avgViews: number; count: number }>;
  /** Topics/hashtags driving the most reach */
  topTopics: Array<{ topic: string; totalViews: number; avgEngagement: number }>;
  /** Traffic sources (e.g., "For You Page", "Search", "Profile") */
  trafficSources: Array<{ source: string; percentage: number }>;
  /** Average watch time / retention (seconds) */
  avgWatchTimeSec: number;
  /** Average completion rate (0-1) for video content */
  avgCompletionRate: number;
}

export interface RevenueData {
  /** Total estimated revenue for the period */
  totalRevenue: number;
  currency: string;
  /** Revenue by source (ads, creator fund, memberships, etc.) */
  breakdown: Array<{ source: string; amount: number }>;
  /** RPM (revenue per mille / 1000 views) */
  rpm: number;
  /** CPM (cost per mille — what advertisers pay) */
  cpm: number;
}

export interface ExtendedAnalytics {
  audience: AudienceInsights | null;
  contentTrends: ContentTrends | null;
  revenue: RevenueData | null;
  period: { start: string; end: string };
}

export interface PlatformPost {
  postId: string;
  body: string;
  mediaUrls?: string[];
  contentType: "text" | "image" | "carousel" | "reel";
  permalink?: string;
  timestamp: string; // ISO date
}

export interface PlatformProfile {
  followers: number;
  following: number;
  postsCount: number;
  extras?: Record<string, unknown>; // platform-specific: profile_views, reach, etc.
}

export interface PlatformAdapter {
  platform: string;

  /** Fetch the user's profile stats (followers, following, posts count). */
  getProfile(params: {
    accessToken: string;
    userId: string;
  }): Promise<PlatformProfile>;

  publish(params: {
    accessToken: string;
    userId: string; // platform user ID
    body: string;
    mediaUrls?: string[];
    contentType: "text" | "image" | "carousel" | "reel" | "thread";
  }): Promise<PublishResult>;

  getPostMetrics(params: {
    accessToken: string;
    postId: string;
  }): Promise<PostMetrics>;

  /** List recent posts from the platform (for syncing external/manual posts). */
  listUserPosts(params: {
    accessToken: string;
    userId: string;
    since?: string; // ISO date — only fetch posts after this date
    limit?: number;
  }): Promise<PlatformPost[]>;

  exchangeCodeForToken(code: string, redirectUri: string): Promise<{
    accessToken: string;
    tokenType: string;
    expiresIn?: number;
    userId: string;
    username?: string;
  }>;

  refreshLongLivedToken(token: string): Promise<{
    accessToken: string;
    tokenType: string;
    expiresIn: number;
  }>;

  /**
   * Fetch extended analytics: audience demographics, content trends, revenue.
   * Optional — adapters return null for unsupported sections.
   */
  getExtendedAnalytics?(params: {
    accessToken: string;
    userId: string;
    startDate: string; // ISO date
    endDate: string;   // ISO date
  }): Promise<ExtendedAnalytics>;
}

/**
 * Registry of available platform adapters.
 */
import { ThreadsAdapter } from "./threads";
import { InstagramAdapter } from "./instagram";
import { TikTokAdapter } from "./tiktok";
import { YouTubeAdapter } from "./youtube";

const adapters: Record<string, PlatformAdapter> = {
  threads: new ThreadsAdapter(),
  instagram: new InstagramAdapter(),
  tiktok: new TikTokAdapter(),
  youtube: new YouTubeAdapter(),
};

export function getPlatformAdapter(platform: string): PlatformAdapter {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`No adapter for platform: ${platform}`);
  return adapter;
}
