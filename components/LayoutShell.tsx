"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { Session, User } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { api } from "@/lib/client-api";
import type { PlanTier } from "@/lib/types/domain";
import { C } from "@/lib/ui";
// TIERS import removed — tier display handled in settings
import { Spinner } from "@/components/primitives";
import { NavSidebar } from "@/components/NavSidebar";
import { PricingModal } from "@/components/pricing-modal";
import { SettingsPanel } from "@/components/settings-panel";
import { ChiefOfStaff } from "@/components/chief-of-staff";
import { BgTaskToasts } from "@/components/BgTaskToasts";
import { useMobile } from "@/lib/useMobile";

/** Routes that should be publicly accessible without auth */
const PUBLIC_ROUTES = ["/terms", "/privacy", "/home"];

type MeResponse = {
  user: { id: string; email: string | null };
  tier: PlanTier;
  usageCount: number;
  usageLimit: number | null;
  hasKeys: Record<"claude" | "chatgpt" | "gemini", boolean>;
};

const LOCAL_AUTH_KEY = "ruhrohhalp.local-auth";

function localModeEnabled() {
  return process.env.NODE_ENV !== "production";
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createSupabaseClient(), []);
  const isMobile = useMobile();

  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [localMode, setLocalMode] = useState(false);
  const [localEmail, setLocalEmail] = useState("");

  const [tier, setTier] = useState<PlanTier>("free");
  const [hasKeys, setHasKeys] = useState<Record<"claude" | "chatgpt" | "gemini", boolean>>({
    claude: false,
    chatgpt: false,
    gemini: false,
  });

  const [showSettings, setShowSettings] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [authMsg, setAuthMsg] = useState<string | null>(null);

  // Close mobile nav on route change
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  async function refreshServerState() {
    try {
      const meData = await api<MeResponse>("/api/me");
      setTier(meData.tier);
      setHasKeys(meData.hasKeys);
    } catch {
      // no-op
    }
  }

  useEffect(() => {
    let mounted = true;

    async function boot() {
      if (localModeEnabled() && typeof window !== "undefined") {
        const storedEmail = window.localStorage.getItem(LOCAL_AUTH_KEY);
        if (storedEmail) {
          setLocalMode(true);
          setLocalEmail(storedEmail);
          setLoading(false);
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);

      if (data.session?.user) {
        await refreshServerState();
      }

      setLoading(false);
    }

    void boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) void refreshServerState();
      else {
        setTier("free");
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function signInGoogle() {
    const redirectTo = `${window.location.origin}/auth/callback`;
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
  }

  async function signInMagicLink() {
    if (!email.trim()) return;
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    setAuthMsg(error ? error.message : "Check your email for a magic link.");
  }

  async function signOut() {
    if (localMode && typeof window !== "undefined") {
      window.localStorage.removeItem(LOCAL_AUTH_KEY);
      window.localStorage.removeItem("ruhrohhalp.local-items");
      setLocalMode(false);
      setLocalEmail("");
      setTier("free");
      return;
    }
    await supabase.auth.signOut();
  }

  const authed = localMode || (!!session && !!user);

  // Public routes bypass auth entirely (ToS, Privacy, Homepage)
  if (PUBLIC_ROUTES.includes(pathname)) {
    return <>{children}</>;
  }

  // Loading state
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: C.bg }}>
        <Spinner color={C.cl} size={20} />
      </div>
    );
  }

  // Sign-in screen
  if (!authed) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: C.bg }}>
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            background: C.surface,
            border: `1px solid ${C.borderMid}`,
            borderRadius: 16,
            padding: isMobile ? 18 : 24,
          }}
        >
          <div style={{ fontFamily: C.serif, fontSize: isMobile ? 28 : 34, fontStyle: "italic", color: C.cream }}>
            ruh-roh. halp.
          </div>
          <p style={{ color: C.textDim, marginTop: 8, marginBottom: 20, fontSize: isMobile ? 13 : 14 }}>
            Sign in to access your cross-device planner, task agents, and tier settings.
          </p>
          <button
            onClick={() => void signInGoogle()}
            style={{
              width: "100%",
              border: `1px solid ${C.border}`,
              background: C.card,
              color: C.text,
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 10,
              cursor: "pointer",
            }}
          >
            Continue with Google
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                flex: 1,
                border: `1px solid ${C.border}`,
                background: C.card,
                color: C.text,
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 16, // prevents iOS zoom on focus
              }}
            />
            <button
              onClick={() => void signInMagicLink()}
              style={{
                border: "none",
                background: C.cl,
                color: C.bg,
                borderRadius: 10,
                padding: "10px 14px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Magic Link
            </button>
          </div>
          {localModeEnabled() && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 10px" }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ fontSize: 10, color: C.textFaint, fontFamily: C.mono }}>LOCAL DEV</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>
              <button
                onClick={() => {
                  const nextEmail = email.trim();
                  if (!nextEmail) {
                    setAuthMsg("Enter an email to continue in local dev mode.");
                    return;
                  }
                  window.localStorage.setItem(LOCAL_AUTH_KEY, nextEmail);
                  window.localStorage.removeItem("ruhrohhalp.local-items");
                  setLocalMode(true);
                  setLocalEmail(nextEmail);
                  setTier("free");
                  setAuthMsg("Local dev mode enabled.");
                }}
                style={{
                  width: "100%",
                  border: `1px solid ${C.border}`,
                  background: C.card,
                  color: C.cream,
                  borderRadius: 10,
                  padding: "10px 14px",
                  cursor: "pointer",
                }}
              >
                Continue with Email Only
              </button>
            </>
          )}
          {authMsg && (
            <p style={{ color: C.textDim, marginTop: 10, fontSize: 13 }}>{authMsg}</p>
          )}

          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <a href="/terms" style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, textDecoration: "none" }}>Terms of Service</a>
            <a href="/privacy" style={{ color: C.textDim, fontSize: 11, fontFamily: C.mono, textDecoration: "none" }}>Privacy Policy</a>
          </div>
        </div>
      </div>
    );
  }

  // Authed layout with sidebar
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, color: C.text, overflow: "hidden" }}>
      {showPricing && (
        <PricingModal
          current={tier}
          onSelect={async (nextTier) => {
            if (localMode) {
              setTier(nextTier);
              setShowPricing(false);
              return;
            }
            if (nextTier === "free") {
              setShowPricing(false);
              return;
            }
            const data = await api<{ url: string }>("/api/billing/checkout", {
              method: "POST",
              body: JSON.stringify({ tier: nextTier }),
            });
            if (data.url) window.location.href = data.url;
          }}
          onClose={() => setShowPricing(false)}
        />
      )}

      {showSettings && !localMode && (
        <SettingsPanel
          tier={tier}
          hasKeys={hasKeys}
          onClose={() => setShowSettings(false)}
          onChangePlan={() => {
            setShowSettings(false);
            setShowPricing(true);
          }}
          onSaved={refreshServerState}
        />
      )}

      {/* Mobile top bar with hamburger */}
      {isMobile && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 14px",
            borderBottom: `1px solid ${C.border}`,
            background: C.surface,
            flexShrink: 0,
            gap: 12,
            zIndex: 10,
          }}
        >
          <button
            onClick={() => setNavOpen(true)}
            style={{
              background: "none",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.cream,
              fontSize: 18,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ☰
          </button>
          <div style={{ fontFamily: C.serif, fontSize: 17, fontStyle: "italic", color: C.cream }}>
            ruh-roh. halp.
          </div>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <NavSidebar
          userEmail={localMode ? localEmail : user?.email}
          onSignOut={() => void signOut()}
          isMobile={isMobile}
          isOpen={navOpen}
          onClose={() => setNavOpen(false)}
        />

        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {localMode && (
            <div
              style={{
                padding: isMobile ? "6px 14px" : "8px 18px",
                borderBottom: `1px solid ${C.border}`,
                background: `${C.cl}10`,
                color: C.textDim,
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              Local dev mode for <span style={{ color: C.cream }}>{localEmail}</span>. Agent chat, billing, and synced settings are disabled.
            </div>
          )}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", paddingBottom: 42 }}>
            {children}
          </div>
        </div>
      </div>
      {!localMode && <ChiefOfStaff />}
      <BgTaskToasts />
    </div>
  );
}
