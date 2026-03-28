"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { C } from "@/lib/ui";

const NAV_ITEMS = [
  { href: "/", label: "Command Center", icon: "◈", shortcut: "1" },
  { href: "/tasks", label: "Tasks", icon: "☐", shortcut: "2" },
  { href: "/brain", label: "Brain", icon: "◇", shortcut: "3" },
  { href: "/knowledge", label: "Knowledge", icon: "▣", shortcut: "4" },
  { href: "/creator", label: "Creator", icon: "✧", shortcut: "5" },
  { href: "/settings/ingestion", label: "Ingestion", icon: "⟳", shortcut: "6" },
] as const;

interface NavSidebarProps {
  userEmail?: string | null;
  onSignOut: () => void;
}

export function NavSidebar({ userEmail, onSignOut }: NavSidebarProps) {
  const pathname = usePathname();

  return (
    <nav
      style={{
        width: 200,
        minWidth: 200,
        height: "100vh",
        background: C.surface,
        borderRight: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "18px 16px 14px",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ fontFamily: C.serif, fontSize: 20, fontStyle: "italic", color: C.cream }}>
          ruh-roh. halp.
        </div>
        <div
          style={{
            fontSize: 8,
            fontFamily: C.mono,
            color: C.textFaint,
            letterSpacing: 2,
            marginTop: 2,
          }}
        >
          TYLEROS
        </div>
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 8,
                textDecoration: "none",
                fontFamily: C.sans,
                fontSize: 13,
                color: active ? C.cream : C.textDim,
                background: active ? `${C.cl}14` : "transparent",
                border: `1px solid ${active ? `${C.cl}30` : "transparent"}`,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.background = C.card;
                  (e.currentTarget as HTMLElement).style.color = C.text;
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = C.textDim;
                }
              }}
            >
              <span style={{ fontSize: 14, width: 18, textAlign: "center", color: active ? C.cl : C.textFaint }}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: C.mono,
                  fontSize: 9,
                  color: C.textFaint,
                  opacity: 0.5,
                }}
              >
                {item.shortcut}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Bottom section */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <Link
          href="/settings"
          style={{
            display: "block",
            width: "100%",
            background: pathname.startsWith("/settings") ? C.white : "none",
            border: `1px solid ${pathname.startsWith("/settings") ? C.white : C.border}`,
            color: pathname.startsWith("/settings") ? C.bg : C.textDim,
            borderRadius: 6,
            padding: "5px 10px",
            fontFamily: C.mono,
            fontSize: 10,
            textDecoration: "none",
            textAlign: "center",
          }}
        >
          Settings
        </Link>

        <button
          onClick={onSignOut}
          style={{
            background: "none",
            border: `1px solid ${C.border}`,
            color: C.textDim,
            borderRadius: 6,
            padding: "5px 10px",
            fontFamily: C.mono,
            fontSize: 10,
            cursor: "pointer",
          }}
        >
          Sign Out
        </button>

        {userEmail && (
          <div
            style={{
              fontFamily: C.mono,
              fontSize: 9,
              color: C.textFaint,
              textAlign: "center",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {userEmail}
          </div>
        )}
      </div>
    </nav>
  );
}
