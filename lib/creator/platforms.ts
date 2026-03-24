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

export interface PlatformAdapter {
  platform: string;
  publish(params: {
    accessToken: string;
    userId: string; // platform user ID
    body: string;
    mediaUrls?: string[];
    contentType: "text" | "image" | "carousel" | "reel";
  }): Promise<PublishResult>;

  getPostMetrics(params: {
    accessToken: string;
    postId: string;
  }): Promise<PostMetrics>;

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
}

/**
 * Registry of available platform adapters.
 * Start with Threads, add Instagram and TikTok later.
 */
import { ThreadsAdapter } from "./threads";

const adapters: Record<string, PlatformAdapter> = {
  threads: new ThreadsAdapter(),
};

export function getPlatformAdapter(platform: string): PlatformAdapter {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`No adapter for platform: ${platform}`);
  return adapter;
}
