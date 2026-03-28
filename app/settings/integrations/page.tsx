"use client";

import { useState, useEffect } from "react";
import { C } from "@/lib/ui";

interface PlatformConnection {
  id: string;
  name: string;
  icon: string;
  color: string;
  authPath: string;
  description: string;
  scopes: string[];
  connected: boolean;
  username?: string;
}

const PLATFORMS: Omit<PlatformConnection, "connected" | "username">[] = [
  {
    id: "tiktok",
    name: "TikTok",
    icon: "♪",
    color: "#ff0050",
    authPath: "/api/auth/tiktok",
    description:
      "Connect your TikTok account to view profile info, follower stats, video lists, and per-video analytics.",
    scopes: [
      "user.info.basic",
      "user.info.stats",
      "video.list",
      "video.insights",
    ],
  },
  {
    id: "threads",
    name: "Threads",
    icon: "@",
    color: "#ffffff",
    authPath: "/api/auth/threads",
    description:
      "Connect Threads to publish posts, reply chains, and view engagement analytics.",
    scopes: ["threads_basic", "threads_content_publish", "threads_manage_insights"],
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: "◧",
    color: "#E1306C",
    authPath: "/api/auth/instagram",
    description:
      "Connect Instagram to publish images, carousels, reels, and view post analytics.",
    scopes: ["instagram_basic", "instagram_content_publish", "instagram_manage_insights"],
  },
  {
    id: "youtube",
    name: "YouTube",
    icon: "▶",
    color: "#ff0000",
    authPath: "/api/auth/youtube",
    description:
      "Connect YouTube to view channel stats, video performance, and subscriber analytics.",
    scopes: ["youtube.readonly"],
  },
];

export default function IntegrationsPage() {
  const [connections, setConnections] = useState<Record<string, { connected: boolean; username?: string }>>({});
  const [loading, setLoading] = useState(true);

  // Check URL params for success/error from OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    const username = params.get("username");

    if (success) {
      setConnections((prev) => ({
        ...prev,
        [success]: { connected: true, username: username || undefined },
      }));
    }
    if (error) {
      console.error("[integrations] OAuth error:", error);
    }
    setLoading(false);
  }, []);

  // Fetch existing connections from platform_tokens
  useEffect(() => {
    async function fetchConnections() {
      try {
        const res = await fetch("/api/creator/analytics?platforms=tiktok,threads,instagram,youtube");
        if (res.ok) {
          const data = await res.json();
          const connected: Record<string, { connected: boolean; username?: string }> = {};
          if (data?.platforms) {
            for (const p of data.platforms) {
              connected[p.platform] = { connected: true, username: p.username };
            }
          }
          setConnections((prev) => ({ ...prev, ...connected }));
        }
      } catch {
        // silent — just means we can't detect existing connections
      }
    }
    fetchConnections();
  }, []);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 720, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontFamily: C.serif,
            fontSize: 22,
            fontStyle: "italic",
            color: C.cream,
          }}
        >
          Platform Integrations
        </div>
        <div
          style={{
            fontFamily: C.mono,
            fontSize: 10,
            color: C.textFaint,
            marginTop: 4,
          }}
        >
          Connect your social media accounts to enable analytics, publishing,
          and creator workflows.
        </div>
      </div>

      {/* Platform cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {PLATFORMS.map((platform) => {
          const conn = connections[platform.id];
          const isConnected = conn?.connected ?? false;

          return (
            <div
              key={platform.id}
              className="fadeUp"
              style={{
                background: C.card,
                border: `1px solid ${isConnected ? `${platform.color}40` : C.border}`,
                borderRadius: 10,
                padding: "16px 18px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                {/* Icon */}
                <span
                  style={{
                    fontSize: 20,
                    color: platform.color,
                    width: 32,
                    textAlign: "center",
                  }}
                >
                  {platform.icon}
                </span>

                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontFamily: C.sans,
                      fontSize: 14,
                      color: C.cream,
                      fontWeight: 500,
                    }}
                  >
                    {platform.name}
                    {isConnected && conn?.username && (
                      <span
                        style={{
                          fontFamily: C.mono,
                          fontSize: 10,
                          color: C.textDim,
                          marginLeft: 8,
                        }}
                      >
                        @{conn.username}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: C.sans,
                      fontSize: 11,
                      color: C.textDim,
                      marginTop: 3,
                      lineHeight: 1.5,
                    }}
                  >
                    {platform.description}
                  </div>
                </div>

                {/* Connect button */}
                {isConnected ? (
                  <span
                    style={{
                      fontFamily: C.mono,
                      fontSize: 10,
                      padding: "5px 14px",
                      borderRadius: 6,
                      background: `${C.gpt}14`,
                      color: C.gpt,
                      border: `1px solid ${C.gpt}28`,
                    }}
                  >
                    ✓ Connected
                  </span>
                ) : (
                  <a
                    href={platform.authPath}
                    style={{
                      fontFamily: C.mono,
                      fontSize: 10,
                      padding: "5px 14px",
                      borderRadius: 6,
                      background: `${platform.color}18`,
                      color: platform.color,
                      border: `1px solid ${platform.color}30`,
                      textDecoration: "none",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    Connect →
                  </a>
                )}
              </div>

              {/* Scopes */}
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 10,
                  paddingLeft: 44,
                  flexWrap: "wrap",
                }}
              >
                {platform.scopes.map((scope) => (
                  <span
                    key={scope}
                    style={{
                      fontFamily: C.mono,
                      fontSize: 9,
                      padding: "2px 7px",
                      borderRadius: 3,
                      background: C.surface,
                      color: C.textFaint,
                      border: `1px solid ${C.border}`,
                    }}
                  >
                    {scope}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {loading && (
        <div
          style={{
            fontFamily: C.mono,
            fontSize: 10,
            color: C.textFaint,
            textAlign: "center",
            marginTop: 20,
          }}
        >
          Checking connections...
        </div>
      )}
    </div>
  );
}
