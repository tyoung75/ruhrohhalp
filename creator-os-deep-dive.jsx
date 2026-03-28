import { useState } from "react";

const C = {
  bg: "#0a0a0f",
  card: "#13131a",
  surface: "#1a1a24",
  border: "#2a2a3a",
  text: "#e8e8f0",
  textDim: "#8888a0",
  textFaint: "#555570",
  orange: "#e07d4a",
  green: "#41c998",
  blue: "#5d9ef8",
  purple: "#a78bfa",
  red: "#ef4444",
  yellow: "#f59e0b",
  pink: "#ec4899",
  cyan: "#22d3ee",
};

const stages = [
  {
    id: "context",
    title: "1. CONTEXT GATHERING",
    subtitle: "Every generation starts by pulling in your world",
    color: C.blue,
    icon: "🌐",
    sources: [
      { name: "Recent Posts (7 days)", desc: "Avoids repetition — the agent knows what you already said", tag: "content_queue" },
      { name: "Active Goals & Tasks", desc: "Links content to what you're actually working on", tag: "goals + tasks" },
      { name: "Strava Training", desc: "Recent runs, lifts, weekly mileage → running content", tag: "Strava API" },
      { name: "Motus Workout Signals", desc: "Your app data → fitness authenticity", tag: "goal_signals" },
      { name: "Top Performing Posts", desc: "What got engagement → lean into what works", tag: "post_analytics" },
      { name: "Voice References", desc: "Your manual posts from IG/TikTok/Threads → ground truth voice", tag: "external posts" },
      { name: "Strategy Insights", desc: "What the strategy agent recommends right now", tag: "strategy_insights" },
      { name: "Creator Feedback", desc: "Your directives, dislikes, corrections, likes", tag: "content_feedback" },
      { name: "Briefing Summary", desc: "Today's briefing context → timely content", tag: "briefings" },
      { name: "Semantic Memory", desc: "Content performance learnings from embedding search", tag: "memories" },
    ],
  },
  {
    id: "generation",
    title: "2. AI GENERATION",
    subtitle: "Claude Sonnet builds posts using your brand DNA",
    color: C.orange,
    icon: "✍️",
    details: [
      {
        name: "Brand Pillars",
        items: [
          { label: "Running & Endurance", pct: "35-40%", color: C.green },
          { label: "Building in Public", pct: "20-25%", color: C.blue },
          { label: "NYC Lifestyle", pct: "10-15%", color: C.purple },
          { label: "Fitness & Strength", pct: "10-15%", color: C.orange },
          { label: "Travel & Adventure", pct: "5-10%", color: C.yellow },
        ],
      },
      {
        name: "Output Per Post",
        items: [
          { label: "body", desc: "The actual post text (or thread array)" },
          { label: "platform", desc: "threads / instagram / tiktok / youtube" },
          { label: "pillar", desc: "Which brand pillar this serves" },
          { label: "confidence", desc: "0-1 quality score" },
          { label: "brand_voice_score", desc: "0-1 match to YOUR voice" },
          { label: "timeliness_score", desc: "0-1 relevance right now" },
          { label: "reasoning", desc: "Why this post, why now" },
          { label: "suggested_time", desc: "Best time to publish" },
        ],
      },
    ],
  },
  {
    id: "audit",
    title: "3. SAFETY AUDIT",
    subtitle: "Groq Llama Scout screens every post before it touches your queue",
    color: C.red,
    icon: "🛡️",
    outcomes: [
      { status: "APPROVED", desc: "Clean content → queued for publishing", color: C.green, arrow: "→ Queue" },
      { status: "FLAGGED", desc: "Needs review → saved as draft for you to edit", color: C.yellow, arrow: "→ Drafts" },
      { status: "REJECTED", desc: "Policy violation → discarded entirely", color: C.red, arrow: "→ /dev/null" },
    ],
    checks: ["Brand safety", "No hate speech", "No sensitive data leaks", "No unverified claims", "No engagement bait", "Tone alignment"],
  },
  {
    id: "queue",
    title: "4. SMART QUEUE",
    subtitle: "Posts scored and ranked by an 8-factor algorithm",
    color: C.cyan,
    icon: "📋",
    scoring: [
      { factor: "Brand Voice Alignment", weight: "20%", desc: "How closely it matches YOUR actual voice" },
      { factor: "Agent Confidence", weight: "15%", desc: "How sure Claude is about quality" },
      { factor: "Timeliness", weight: "15%", desc: "How relevant to what's happening right now" },
      { factor: "Content Type Diversity", weight: "10%", desc: "Mix of text, threads, media" },
      { factor: "Time-of-Day Fit", weight: "10%", desc: "Optimal posting window" },
      { factor: "Post Length Sweet Spot", weight: "10%", desc: "Not too short, not too long" },
      { factor: "Analytics Boost", weight: "10%", desc: "Similar topics performed well before" },
      { factor: "Freshness Decay", weight: "10%", desc: "Older queued posts lose priority" },
    ],
  },
  {
    id: "publish",
    title: "5. AUTO-PUBLISH",
    subtitle: "Cron runs every 5 minutes — posts go live at their scheduled time",
    color: C.green,
    icon: "📤",
    platforms: [
      { name: "Threads", status: "Full publish", color: C.text },
      { name: "Instagram", status: "Full publish (single/carousel/reel)", color: C.pink },
      { name: "TikTok", status: "Tracking only (publish pending API approval)", color: C.yellow },
      { name: "YouTube", status: "Tracking only (API key, no OAuth publish)", color: C.red },
    ],
    mechanics: [
      "Publishes up to 3 posts per cron run (rate limited)",
      "Retries with exponential backoff: 5min → 25min → 125min",
      "Max 3 attempts before marking as failed",
      "Status: queued → posting → posted (with post_url)",
    ],
  },
  {
    id: "analytics",
    title: "6. ANALYTICS ENGINE",
    subtitle: "Daily cron collects engagement data for every post",
    color: C.purple,
    icon: "📊",
    metrics: [
      { name: "Impressions", desc: "How many people saw it" },
      { name: "Likes", desc: "Direct engagement signal" },
      { name: "Replies", desc: "Conversation starter signal" },
      { name: "Reposts", desc: "Viral/share signal" },
      { name: "Quotes", desc: "Thought leadership signal" },
      { name: "Follows Gained", desc: "Growth attribution" },
      { name: "Engagement Rate", desc: "(likes + replies + reposts) / impressions" },
    ],
    storage: [
      "post_analytics — per-post metrics",
      "post_analytics_daily — aggregated by day",
      "follower_snapshots — Threads + IG + TikTok + YouTube",
    ],
  },
  {
    id: "feedback",
    title: "7. FEEDBACK LOOP",
    subtitle: "Your input directly shapes the next generation",
    color: C.yellow,
    icon: "🔄",
    types: [
      { type: "👍 Like", desc: "\"More like this\" → importance 6 → agent doubles down on pattern", color: C.green },
      { type: "👎 Dislike", desc: "\"Less like this\" → importance 8 → agent avoids the pattern", color: C.red },
      { type: "🗑️ Deleted", desc: "\"I deleted this\" + reason → importance 8 → strongest negative signal", color: C.red },
      { type: "📝 Correction", desc: "\"It should have been...\" → importance 7 → agent adjusts approach", color: C.yellow },
      { type: "📌 Directive", desc: "\"Never do X\" / \"Always do Y\" → importance 9 → permanent standing rule", color: C.orange },
    ],
    path: [
      "You click feedback on History tab",
      "Stored in content_feedback table with context",
      "Embedded into semantic memory with importance weight",
      "Next generation pulls feedback via gatherDailyContext()",
      "Injected into Claude prompt as CREATOR FEEDBACK section",
      "Agent adjusts: follows directives, avoids dislikes, replicates likes",
    ],
  },
  {
    id: "strategy",
    title: "8. STRATEGY INTELLIGENCE",
    subtitle: "Weekly analysis → actionable recommendations you can generate from",
    color: C.pink,
    icon: "🎯",
    outputs: [
      { name: "Today's Focus", desc: "Top 3 recommendations for TODAY with \"Generate This\" buttons" },
      { name: "Weekly Game Plan", desc: "Velocity targets, platform breakdown, posting cadence" },
      { name: "Pillar Coverage", desc: "Are you hitting 35-40% running, 20-25% building, etc?" },
      { name: "What's Working", desc: "Insights from analytics — topics, formats, times that perform" },
      { name: "Adjust & Improve", desc: "Patterns to fix — topics to drop, formats to try" },
      { name: "Best Posting Times", desc: "7-day × 4-slot heatmap from engagement data" },
      { name: "Trend Radar", desc: "Hot trends with relevance scores to your brand" },
      { name: "Talk to Agent", desc: "Submit directives directly to shape strategy" },
    ],
  },
];

function StageCard({ stage, isActive, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.card,
        border: `1px solid ${isActive ? stage.color : C.border}`,
        borderRadius: 12,
        padding: "20px 24px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        boxShadow: isActive ? `0 0 20px ${stage.color}15` : "none",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: isActive ? 16 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>{stage.icon}</span>
          <div>
            <div style={{
              fontFamily: "monospace",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.5,
              color: stage.color,
            }}>
              {stage.title}
            </div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
              {stage.subtitle}
            </div>
          </div>
        </div>
        <span style={{ color: C.textFaint, fontSize: 14 }}>
          {isActive ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded content */}
      {isActive && (
        <div style={{ marginTop: 4 }}>
          {/* Context Gathering */}
          {stage.sources && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {stage.sources.map((s) => (
                <div key={s.name} style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{s.name}</span>
                    <span style={{
                      fontSize: 9,
                      fontFamily: "monospace",
                      color: stage.color,
                      background: `${stage.color}15`,
                      padding: "2px 6px",
                      borderRadius: 3,
                    }}>{s.tag}</span>
                  </div>
                  <p style={{ fontSize: 11, color: C.textDim, margin: "4px 0 0" }}>{s.desc}</p>
                </div>
              ))}
            </div>
          )}

          {/* Generation */}
          {stage.details && (
            <div>
              {stage.details.map((d) => (
                <div key={d.name} style={{ marginBottom: 16 }}>
                  <div style={{
                    fontFamily: "monospace",
                    fontSize: 10,
                    color: C.textFaint,
                    letterSpacing: 1,
                    marginBottom: 8,
                  }}>
                    {d.name.toUpperCase()}
                  </div>
                  {d.items[0]?.pct ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {d.items.map((item) => (
                        <div key={item.label} style={{
                          background: C.surface,
                          border: `1px solid ${C.border}`,
                          borderRadius: 8,
                          padding: "10px 14px",
                          flex: "1 1 160px",
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: item.color }}>{item.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginTop: 2 }}>{item.pct}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {d.items.map((item) => (
                        <div key={item.label} style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "baseline",
                          background: C.surface,
                          borderRadius: 6,
                          padding: "6px 10px",
                        }}>
                          <code style={{ fontSize: 11, color: C.orange, flexShrink: 0 }}>{item.label}</code>
                          <span style={{ fontSize: 10, color: C.textDim }}>{item.desc}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Audit */}
          {stage.outcomes && (
            <div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                {stage.outcomes.map((o) => (
                  <div key={o.status} style={{
                    flex: 1,
                    background: C.surface,
                    border: `1px solid ${o.color}40`,
                    borderRadius: 8,
                    padding: "12px 14px",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: o.color }}>{o.status}</div>
                    <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>{o.desc}</div>
                    <div style={{ fontSize: 10, fontFamily: "monospace", color: o.color, marginTop: 6 }}>{o.arrow}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {stage.checks.map((c) => (
                  <span key={c} style={{
                    fontSize: 10,
                    color: C.textDim,
                    background: C.surface,
                    padding: "4px 10px",
                    borderRadius: 4,
                    border: `1px solid ${C.border}`,
                  }}>
                    ✓ {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Queue scoring */}
          {stage.scoring && (
            <div>
              {stage.scoring.map((s) => (
                <div key={s.factor} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 8,
                }}>
                  <div style={{
                    width: 44,
                    textAlign: "right",
                    fontSize: 13,
                    fontWeight: 700,
                    color: C.cyan,
                    fontFamily: "monospace",
                  }}>
                    {s.weight}
                  </div>
                  <div style={{
                    flex: 1,
                    background: C.surface,
                    borderRadius: 6,
                    padding: "8px 12px",
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{s.factor}</div>
                    <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Publish */}
          {stage.platforms && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {stage.platforms.map((p) => (
                  <div key={p.name} style={{
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: p.color, marginTop: 4 }}>{p.status}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {stage.mechanics.map((m, i) => (
                  <div key={i} style={{ fontSize: 11, color: C.textDim }}>
                    <span style={{ color: C.green, marginRight: 6 }}>→</span>{m}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Analytics */}
          {stage.metrics && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
                {stage.metrics.map((m) => (
                  <div key={m.name} style={{
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    textAlign: "center",
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.purple }}>{m.name}</div>
                    <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>{m.desc}</div>
                  </div>
                ))}
              </div>
              <div style={{
                fontFamily: "monospace",
                fontSize: 10,
                color: C.textFaint,
                letterSpacing: 1,
                marginBottom: 6,
              }}>STORED IN</div>
              {stage.storage.map((s, i) => (
                <div key={i} style={{ fontSize: 11, color: C.textDim, marginBottom: 2 }}>
                  <code style={{ color: C.purple }}>{s.split("—")[0].trim()}</code>
                  {s.includes("—") && <span> — {s.split("—")[1]}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Feedback */}
          {stage.types && (
            <div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {stage.types.map((t) => (
                  <div key={t.type} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: t.color, flexShrink: 0, minWidth: 120 }}>{t.type}</span>
                    <span style={{ fontSize: 11, color: C.textDim }}>{t.desc}</span>
                  </div>
                ))}
              </div>
              <div style={{
                fontFamily: "monospace",
                fontSize: 10,
                color: C.textFaint,
                letterSpacing: 1,
                marginBottom: 8,
              }}>DATA PATH</div>
              {stage.path.map((step, i) => (
                <div key={i} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 6,
                }}>
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: `${C.yellow}20`,
                    border: `1px solid ${C.yellow}40`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    color: C.yellow,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>
                    {i + 1}
                  </div>
                  <span style={{ fontSize: 11, color: C.textDim }}>{step}</span>
                </div>
              ))}
            </div>
          )}

          {/* Strategy */}
          {stage.outputs && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {stage.outputs.map((o) => (
                <div key={o.name} style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.pink }}>{o.name}</div>
                  <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>{o.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CreatorOSDeepDive() {
  const [activeStage, setActiveStage] = useState("context");

  return (
    <div style={{
      background: C.bg,
      minHeight: "100vh",
      padding: "32px 24px",
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      color: C.text,
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{
          fontSize: 11,
          fontFamily: "monospace",
          color: C.orange,
          letterSpacing: 3,
          marginBottom: 8,
        }}>
          CREATOR OS — DEEP DIVE
        </div>
        <h1 style={{
          fontSize: 28,
          fontWeight: 700,
          margin: 0,
          background: `linear-gradient(135deg, ${C.orange}, ${C.pink})`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          The Content Engine
        </h1>
        <p style={{ color: C.textDim, fontSize: 13, marginTop: 8, maxWidth: 600, margin: "8px auto 0" }}>
          From 10 data sources → AI generation → safety audit → smart queue → auto-publish → analytics → your feedback → better next time
        </p>
      </div>

      {/* Pipeline overview bar */}
      <div style={{
        maxWidth: 900,
        margin: "24px auto",
        display: "flex",
        gap: 2,
        padding: "0 4px",
      }}>
        {stages.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveStage(s.id)}
            style={{
              flex: 1,
              padding: "8px 4px",
              background: activeStage === s.id ? `${s.color}20` : C.surface,
              border: `1px solid ${activeStage === s.id ? s.color : C.border}`,
              borderRadius: 6,
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 14 }}>{s.icon}</div>
            <div style={{
              fontSize: 8,
              fontFamily: "monospace",
              color: activeStage === s.id ? s.color : C.textFaint,
              marginTop: 2,
              letterSpacing: 0.5,
            }}>
              {s.title.split(". ")[1]}
            </div>
          </button>
        ))}
      </div>

      {/* Stage cards */}
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {stages.map((stage, idx) => (
          <div key={stage.id}>
            <StageCard
              stage={stage}
              isActive={activeStage === stage.id}
              onClick={() => setActiveStage(activeStage === stage.id ? null : stage.id)}
            />
            {/* Arrow between stages */}
            {idx < stages.length - 1 && (
              <div style={{
                display: "flex",
                justifyContent: "center",
                padding: "4px 0",
              }}>
                <div style={{
                  width: 2,
                  height: 12,
                  background: `linear-gradient(${stage.color}, ${stages[idx + 1].color})`,
                  opacity: 0.4,
                }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Cycle indicator */}
      <div style={{
        maxWidth: 900,
        margin: "24px auto 0",
        textAlign: "center",
        padding: "16px",
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
      }}>
        <div style={{
          fontSize: 11,
          fontFamily: "monospace",
          color: C.yellow,
          letterSpacing: 2,
          marginBottom: 8,
        }}>
          ♻️ THE LOOP NEVER STOPS
        </div>
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
          Analytics feed the Strategy Agent → Strategy shapes Generation → Your Feedback refines everything →
          Next batch is smarter. Every post you like, dislike, or delete makes the system better.
        </div>
      </div>
    </div>
  );
}