import Link from "next/link";

export const metadata = {
  title: "ruhrohhalp — AI-Powered Creator Dashboard",
  description:
    "Personal AI operating system for managing social media content, analytics, tasks, and creator workflows across TikTok, Instagram, YouTube, and Threads.",
};

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0d0d0d",
        color: "#e8e1d3",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Nav */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          maxWidth: 960,
          margin: "0 auto",
          padding: "24px 24px 0",
        }}
      >
        <span
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: 22,
            fontStyle: "italic",
            color: "#e8e1d3",
          }}
        >
          ruh-roh. halp.
        </span>
        <Link
          href="/"
          style={{
            padding: "8px 20px",
            borderRadius: 8,
            background: "#c9a84c",
            color: "#0d0d0d",
            fontWeight: 600,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          Sign In
        </Link>
      </nav>

      {/* Hero */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "80px 24px 60px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: 44,
            fontWeight: 700,
            lineHeight: 1.15,
            marginBottom: 20,
          }}
        >
          Your AI-Powered
          <br />
          Creator Command Center
        </h1>
        <p
          style={{
            fontSize: 18,
            color: "#a09882",
            maxWidth: 600,
            margin: "0 auto 40px",
            lineHeight: 1.6,
          }}
        >
          Manage content, analytics, and creator workflows across TikTok,
          Instagram, YouTube, and Threads — all from one intelligent dashboard.
        </p>
      </section>

      {/* Features */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "0 24px 80px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 24,
        }}
      >
        {[
          {
            title: "Multi-Platform Analytics",
            desc: "Track followers, engagement, and growth across TikTok, Instagram, YouTube, and Threads in one unified view.",
          },
          {
            title: "Smart Content Queue",
            desc: "AI-ranked publishing queue that scores posts by engagement potential, brand voice alignment, and optimal timing.",
          },
          {
            title: "Daily Briefings",
            desc: "AI-generated daily briefings with leverage tasks, trend analysis, and actionable recommendations.",
          },
          {
            title: "Creator Workflow",
            desc: "From content ideation to publishing to analytics feedback — a complete loop powered by AI agents.",
          },
          {
            title: "TikTok Integration",
            desc: "Connect your TikTok account to sync videos, track performance metrics, and analyze content trends.",
          },
          {
            title: "Goal Tracking",
            desc: "Set goals across life pillars, track progress with health scores, and get AI-powered suggestions to stay on track.",
          },
        ].map((f) => (
          <div
            key={f.title}
            style={{
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                marginBottom: 8,
                color: "#e8e1d3",
              }}
            >
              {f.title}
            </h3>
            <p style={{ fontSize: 14, color: "#a09882", lineHeight: 1.6 }}>
              {f.desc}
            </p>
          </div>
        ))}
      </section>

      {/* How TikTok Integration Works */}
      <section
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "0 24px 80px",
        }}
      >
        <h2
          style={{
            fontSize: 28,
            fontWeight: 700,
            textAlign: "center",
            marginBottom: 40,
          }}
        >
          How TikTok Integration Works
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 24,
            textAlign: "center",
          }}
        >
          {[
            {
              step: "1",
              title: "Connect",
              desc: "Authorize your TikTok account via secure OAuth login.",
            },
            {
              step: "2",
              title: "Sync",
              desc: "Your videos, profile data, and analytics are synced automatically.",
            },
            {
              step: "3",
              title: "Analyze",
              desc: "View engagement metrics, follower growth, and content performance.",
            },
            {
              step: "4",
              title: "Optimize",
              desc: "Get AI-powered insights to improve your content strategy.",
            },
          ].map((s) => (
            <div key={s.step}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "#c9a84c",
                  color: "#0d0d0d",
                  fontWeight: 700,
                  fontSize: 18,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                {s.step}
              </div>
              <h4
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                {s.title}
              </h4>
              <p style={{ fontSize: 13, color: "#a09882", lineHeight: 1.5 }}>
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "24px",
          borderTop: "1px solid #2a2a2a",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 12,
          color: "#666",
        }}
      >
        <span>&copy; {new Date().getFullYear()} BearDuckHornEmpire LLC</span>
        <div style={{ display: "flex", gap: 20 }}>
          <Link
            href="/terms"
            style={{ color: "#888", textDecoration: "none" }}
          >
            Terms of Service
          </Link>
          <Link
            href="/privacy"
            style={{ color: "#888", textDecoration: "none" }}
          >
            Privacy Policy
          </Link>
          <a
            href="mailto:tylerjyoung5@gmail.com"
            style={{ color: "#888", textDecoration: "none" }}
          >
            Contact
          </a>
        </div>
      </footer>
    </main>
  );
}
