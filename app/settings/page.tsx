"use client";

import Link from "next/link";
import { C } from "@/lib/ui";
import { useMobile } from "@/lib/useMobile";

const SETTINGS_SECTIONS = [
  {
    href: "/settings/ingestion",
    label: "Ingestion Pipeline",
    icon: "⟳",
    description: "Data sources feeding into your brain. Configure webhooks, check sync status, and trigger manual syncs.",
  },
  {
    href: "/settings/integrations",
    label: "Platform Integrations",
    icon: "⚡",
    description: "Connect social platforms (TikTok, Threads, Instagram, YouTube) for analytics and content management.",
  },
] as const;

export default function SettingsPage() {
  const isMobile = useMobile();
  return (
    <div style={{ padding: isMobile ? "20px 14px" : "32px 40px", maxWidth: 720, margin: "0 auto" }}>
      <h1
        style={{
          fontFamily: C.serif,
          fontSize: 26,
          fontStyle: "italic",
          color: C.cream,
          marginBottom: 6,
        }}
      >
        Settings
      </h1>
      <p
        style={{
          fontFamily: C.mono,
          fontSize: 11,
          color: C.textFaint,
          marginBottom: 32,
          letterSpacing: 0.5,
        }}
      >
        Manage integrations, data sources, and system configuration.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {SETTINGS_SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 16,
              padding: "20px 24px",
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              textDecoration: "none",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = `${C.cl}50`;
              (e.currentTarget as HTMLElement).style.background = C.surface;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = C.border;
              (e.currentTarget as HTMLElement).style.background = C.card;
            }}
          >
            <span style={{ fontSize: 22, marginTop: 2 }}>{section.icon}</span>
            <div>
              <div
                style={{
                  fontFamily: C.sans,
                  fontSize: 15,
                  fontWeight: 600,
                  color: C.cream,
                  marginBottom: 4,
                }}
              >
                {section.label}
              </div>
              <div
                style={{
                  fontFamily: C.sans,
                  fontSize: 12,
                  color: C.textDim,
                  lineHeight: 1.5,
                }}
              >
                {section.description}
              </div>
            </div>
            <span
              style={{
                marginLeft: "auto",
                color: C.textFaint,
                fontSize: 16,
                alignSelf: "center",
              }}
            >
              →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
