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
};

const sections = [
  {
    id: "ingestion",
    title: "DATA INGESTION",
    color: C.blue,
    x: 50,
    y: 40,
    items: [
      { name: "Gmail", desc: "Webhooks → emails parsed → embedded into Brain", icon: "📧" },
      { name: "Google Calendar", desc: "Events synced → context for briefings & content", icon: "📅" },
      { name: "Strava", desc: "OAuth → daily cron sync → training data + goal signals", icon: "🏃" },
      { name: "Linear", desc: "Webhooks → issues sync to tasks + embedded", icon: "📋" },
      { name: "Voice Memos", desc: "Whisper transcription → semantic chunks → Brain", icon: "🎙️" },
      { name: "Manual Capture", desc: "Brain Dump modal → instant embed to Supabase", icon: "💭" },
      { name: "Social Platforms", desc: "External posts synced for voice learning", icon: "📱" },
    ],
  },
  {
    id: "brain",
    title: "SEMANTIC BRAIN",
    color: C.purple,
    x: 50,
    y: 200,
    items: [
      { name: "Embeddings", desc: "BGE-M3 via Hugging Face — all content vectorized", icon: "🧬" },
      { name: "Semantic Search", desc: "pgvector similarity with threshold filtering", icon: "🔍" },
      { name: "7 Knowledge Tables", desc: "Memories, Decisions, Projects, People, Ideas, Meetings, Documents", icon: "📚" },
      { name: "CEO Mode", desc: "Strategic synthesis across all knowledge", icon: "👔" },
    ],
  },
  {
    id: "agents",
    title: "AI AGENTS",
    color: C.orange,
    x: 50,
    y: 360,
    items: [
      { name: "Content Agent", desc: "Claude Sonnet → generates posts with brand pillars + voice refs", icon: "✍️" },
      { name: "Strategy Agent", desc: "Claude Sonnet → weekly recommendations, trend detection", icon: "📊" },
      { name: "Briefing Agent", desc: "Daily @ 6AM + Weekly Monday → CEO synthesis", icon: "📰" },
      { name: "Safety Audit", desc: "Groq Llama Scout → screens all generated content", icon: "🛡️" },
      { name: "Task Agent", desc: "Per-task AI chat (Claude/GPT/Gemini selection)", icon: "🤖" },
    ],
  },
  {
    id: "surfaces",
    title: "USER SURFACES",
    color: C.green,
    x: 50,
    y: 530,
    items: [
      { name: "Command Center", desc: "Pillar Health + Today's Focus + Signals + Briefings", icon: "🎯" },
      { name: "Creator Tab", desc: "Queue → Analytics → History → Strategy (4 sub-tabs)", icon: "🎨" },
      { name: "Tasks", desc: "Planner with list/kanban views + AI agent per task", icon: "✅" },
      { name: "Brain Search", desc: "Semantic query across all memories + sources", icon: "🧠" },
      { name: "Knowledge", desc: "CRUD for 7 structured knowledge tables", icon: "📖" },
      { name: "Settings", desc: "Connected integrations, sync status, API keys", icon: "⚙️" },
    ],
  },
  {
    id: "outputs",
    title: "AUTOMATED OUTPUTS",
    color: C.yellow,
    x: 50,
    y: 700,
    items: [
      { name: "Auto-Publish", desc: "Cron every 5 min → publishes queued posts at scheduled time", icon: "📤" },
      { name: "Daily Briefing", desc: "6 AM ET → leverage tasks, decisions, insights", icon: "☀️" },
      { name: "Weekly CEO Brief", desc: "Monday 6 AM → project progress, blockers, strategy", icon: "📈" },
      { name: "Analytics Collection", desc: "Daily cron → engagement metrics per post", icon: "📉" },
      { name: "Token Refresh", desc: "Daily cron → refreshes expiring OAuth tokens", icon: "🔑" },
      { name: "Follower Snapshots", desc: "Threads + Instagram + TikTok + YouTube tracking", icon: "👥" },
    ],
  },
];

const flows = [
  { from: "ingestion", to: "brain", label: "embed & store" },
  { from: "brain", to: "agents", label: "context retrieval" },
  { from: "agents", to: "surfaces", label: "synthesized output" },
  { from: "surfaces", to: "outputs", label: "scheduled actions" },
  { from: "surfaces", to: "brain", label: "feedback loop" },
];

export default function TylerOSMap() {
  const [expanded, setExpanded] = useState(null);
  const [hoveredFlow, setHoveredFlow] = useState(null);

  return (
    <div style={{
      background: C.bg,
      minHeight: "100vh",
      padding: "32px 24px",
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      color: C.text,
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{
          fontSize: 11,
          fontFamily: "monospace",
          color: C.orange,
          letterSpacing: 3,
          marginBottom: 8,
        }}>
          SYSTEM ARCHITECTURE
        </div>
        <h1 style={{
          fontSize: 32,
          fontWeight: 700,
          margin: 0,
          background: `linear-gradient(135deg, ${C.orange}, ${C.blue})`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          TylerOS
        </h1>
        <p style={{ color: C.textDim, fontSize: 13, marginTop: 8 }}>
          Personal AI Operating System — Data flows down, feedback flows up
        </p>
      </div>

      {/* Flow arrows between sections */}
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {sections.map((section, idx) => {
          const isExpanded = expanded === section.id;
          const flow = flows.find(f => f.from === section.id);

          return (
            <div key={section.id}>
              {/* Section card */}
              <div
                onClick={() => setExpanded(isExpanded ? null : section.id)}
                style={{
                  background: C.card,
                  border: `1px solid ${isExpanded ? section.color : C.border}`,
                  borderRadius: 12,
                  padding: "20px 24px",
                  marginBottom: 0,
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {/* Section header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: section.color,
                      boxShadow: `0 0 12px ${section.color}60`,
                    }} />
                    <span style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: 2,
                      color: section.color,
                    }}>
                      {section.title}
                    </span>
                    <span style={{
                      fontFamily: "monospace",
                      fontSize: 10,
                      color: C.textFaint,
                      background: C.surface,
                      padding: "2px 8px",
                      borderRadius: 4,
                    }}>
                      {section.items.length} components
                    </span>
                  </div>
                  <span style={{ color: C.textFaint, fontSize: 14 }}>
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>

                {/* Collapsed: show item names inline */}
                {!isExpanded && (
                  <div style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 12,
                  }}>
                    {section.items.map((item) => (
                      <span key={item.name} style={{
                        fontSize: 11,
                        color: C.textDim,
                        background: C.surface,
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: `1px solid ${C.border}`,
                      }}>
                        {item.icon} {item.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Expanded: show full details */}
                {isExpanded && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    marginTop: 16,
                  }}>
                    {section.items.map((item) => (
                      <div key={item.name} style={{
                        background: C.surface,
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        padding: "12px 14px",
                      }}>
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                        }}>
                          <span style={{ fontSize: 16 }}>{item.icon}</span>
                          <span style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: C.text,
                          }}>
                            {item.name}
                          </span>
                        </div>
                        <p style={{
                          fontSize: 11,
                          color: C.textDim,
                          margin: 0,
                          lineHeight: 1.5,
                        }}>
                          {item.desc}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Flow arrow */}
              {flow && (
                <div
                  onMouseEnter={() => setHoveredFlow(flow.label)}
                  onMouseLeave={() => setHoveredFlow(null)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "6px 0",
                    opacity: hoveredFlow === flow.label ? 1 : 0.5,
                    transition: "opacity 0.2s",
                  }}
                >
                  <div style={{
                    width: 2,
                    height: 16,
                    background: `linear-gradient(${section.color}, ${sections[idx + 1]?.color || C.textFaint})`,
                  }} />
                  <span style={{
                    fontSize: 9,
                    fontFamily: "monospace",
                    color: hoveredFlow === flow.label ? C.text : C.textFaint,
                    padding: "2px 8px",
                    background: C.card,
                    borderRadius: 4,
                    border: `1px solid ${C.border}`,
                  }}>
                    {flow.label} {flow.from === "surfaces" && flow.to === "brain" ? "↑" : "↓"}
                  </span>
                  <div style={{
                    width: 2,
                    height: 16,
                    background: `linear-gradient(${section.color}, ${sections[idx + 1]?.color || C.textFaint})`,
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Stats footer */}
      <div style={{
        maxWidth: 900,
        margin: "32px auto 0",
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
      }}>
        {[
          { label: "API Routes", value: "51", color: C.blue },
          { label: "DB Tables", value: "20+", color: C.purple },
          { label: "Integrations", value: "8", color: C.green },
          { label: "AI Models", value: "4", color: C.orange },
        ].map((stat) => (
          <div key={stat.label} style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "14px 16px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: stat.color }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 10, fontFamily: "monospace", color: C.textFaint, marginTop: 4 }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}