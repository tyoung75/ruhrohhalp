"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { C } from "@/lib/ui";

const NAV_ITEMS: { href: string; label: string; icon: string; shortcut: string }[] = [
  { href: "/", label: "Command Center", icon: "◈", shortcut: "1" },
  { href: "/tasks", label: "Tasks", icon: "☐", shortcut: "2" },
  { href: "/brain", label: "Brain", icon: "◇", shortcut: "3" },
  { href: "/knowledge", label: "Knowledge", icon: "▣", shortcut: "4" },
  { href: "/creator", label: "Creator", icon: "✧", shortcut: "5" },
  { href: "/settings/ingestion", label: "Ingestion", icon: "⟳", shortcut: "6" },
  { href: "/finance", label: "Finance", icon: "◆", shortcut: "7" },
  { href: "/brands", label: "Brands", icon: "◉", shortcut: "8" },
];

interface NavSidebarProps {
  userEmail?: string | null;
  onSignOut: () => void;
  isMobile?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export function NavSidebar({ userEmail, onSignOut, isMobile, isOpen, onClose }: NavSidebarProps) {
  const pathname = usePathname();

  // On mobile, don't render unless open
  if (isMobile && !isOpen) return null;

  return (
    <>
      {/* Backdrop for mobile */}
      {isMobile && isOpen && (
        <div className="mobile-nav-backdrop" style={{ display: "block" }} onClick={onClose} />
      )}

      <nav
        className={isMobile ? "mobile-nav-open" : undefined}
        style={{
          width: isMobile ? 260 : 200,
          minWidth: isMobile ? 260 : 200,
          height: "100vh",
          background: C.surface,
          borderRight: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          ...(isMobile
            ? {
                position: "fixed",
                top: 0,
                left: 0,
                zIndex: 90,
                boxShadow: "4px 0 24px rgba(0,0,0,0.5)",
              }
            : {}),
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: "18px 16px 14px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
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
          {isMobile && (
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: C.textDim,
                fontSize: 18,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                href={item.href as any}
                onClick={isMobile ? onClose : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: isMobile ? "12px 14px" : "9px 12px",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontFamily: C.sans,
                  fontSize: isMobile ? 14 : 13,
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
                <span style={{ fontSize: isMobile ? 16 : 14, width: 20, textAlign: "center", color: active ? C.cl : C.textFaint }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {!isMobile && (
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
                )}
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
            onClick={isMobile ? onClose : undefined}
            style={{
              display: "block",
              width: "100%",
              background: pathname.startsWith("/settings") ? C.cream : "none",
              border: `1px solid ${pathname.startsWith("/settings") ? C.cream : C.border}`,
              color: pathname.startsWith("/settings") ? C.bg : C.textDim,
              borderRadius: 6,
              padding: isMobile ? "8px 10px" : "5px 10px",
              fontFamily: C.mono,
              fontSize: isMobile ? 12 : 10,
              textDecoration: "none",
              textAlign: "center",
            }}
          >
            Settings
          </Link>

          <button
            onClick={() => {
              onSignOut();
              if (isMobile && onClose) onClose();
            }}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              color: C.textDim,
              borderRadius: 6,
              padding: isMobile ? "8px 10px" : "5px 10px",
              fontFamily: C.mono,
              fontSize: isMobile ? 12 : 10,
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
    </>
  );
}
