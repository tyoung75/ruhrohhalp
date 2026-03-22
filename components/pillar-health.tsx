import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/ui";
import { GoalProgressCompact, type GoalData } from "@/components/goal-progress-card";

interface PillarGoal extends GoalData {
  id: string;
  title: string;
  progress: number;
  metric?: string;
  deadline?: string;
}

interface Pillar {
  id: string;
  name: string;
  health: "strong" | "stable" | "at_risk" | "critical";
  goals: PillarGoal[];
  recentActivities?: string[];
}

interface PillarHealthProps {
  pillars?: Pillar[];
  loading?: boolean;
}

export function PillarHealth({ pillars = [], loading = false }: PillarHealthProps) {
  const router = useRouter();
  const [expandedPillar, setExpandedPillar] = useState<string | null>(null);

  const healthColors: Record<string, string> = {
    strong: C.gem,
    stable: C.task,
    at_risk: "#FFA500",
    critical: C.reminder,
  };

  const healthLabels: Record<string, string> = {
    strong: "Strong",
    stable: "Stable",
    at_risk: "At Risk",
    critical: "Critical",
  };

  const togglePillarExpanded = (pillarId: string) => {
    setExpandedPillar(expandedPillar === pillarId ? null : pillarId);
  };

  const handleGoalClick = (goalId: string) => {
    router.push(`/goals/${goalId}`);
  };

  if (loading) {
    return (
      <div
        style={{
          padding: 16,
          textAlign: "center",
          color: C.textDim,
          fontSize: 13,
        }}
      >
        Loading pillar health...
      </div>
    );
  }

  if (pillars.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          textAlign: "center",
          color: C.textDim,
          fontSize: 13,
        }}
      >
        No pillars configured yet.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {pillars.map((pillar) => {
        const isExpanded = expandedPillar === pillar.id;
        const healthColor = healthColors[pillar.health] || C.textDim;
        const healthLabel = healthLabels[pillar.health] || pillar.health;

        return (
          <div key={pillar.id}>
            {/* Pillar Header */}
            <button
              onClick={() => togglePillarExpanded(pillar.id)}
              style={{
                width: "100%",
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                transition: "border-color 0.2s, background 0.2s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = C.card;
                (e.currentTarget as HTMLElement).style.borderColor = C.cl;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = C.surface;
                (e.currentTarget as HTMLElement).style.borderColor = C.border;
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, textAlign: "left" }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: healthColor,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: C.text }}>
                    {pillar.name}
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
                    {healthLabel}
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: C.textFaint,
                  transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }}
              >
                ▼
              </div>
            </button>

            {/* Expanded Content: Goals */}
            {isExpanded && pillar.goals.length > 0 && (
              <div style={{ padding: "4px 12px 10px 48px" }}>
                {pillar.goals.map((goal) => (
                  <div
                    key={goal.id}
                    onClick={() => handleGoalClick(goal.id)}
                    style={{
                      cursor: "pointer",
                      borderRadius: 6,
                      transition: "border-color 0.2s, background 0.2s",
                      marginBottom: 8,
                    }}
                    onMouseEnter={(e) => {
                      const elem = e.currentTarget as HTMLElement;
                      elem.style.borderColor = C.cl;
                      elem.style.background = C.surface + "40";
                    }}
                    onMouseLeave={(e) => {
                      const elem = e.currentTarget as HTMLElement;
                      elem.style.borderColor = C.border;
                      elem.style.background = "transparent";
                    }}
                  >
                    <GoalProgressCompact goal={goal} />
                  </div>
                ))}
              </div>
            )}

            {/* Expanded Content: No Goals */}
            {isExpanded && pillar.goals.length === 0 && (
              <div
                style={{
                  padding: "12px 48px",
                  color: C.textDim,
                  fontSize: 12,
                  fontStyle: "italic",
                }}
              >
                No goals in this pillar yet.
              </div>
            )}

            {/* Expanded Content: Recent Activities */}
            {isExpanded && pillar.recentActivities && pillar.recentActivities.length > 0 && (
              <div style={{ padding: "8px 12px 0 48px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", color: C.textFaint, marginBottom: 6 }}>
                  Recent Activity
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {pillar.recentActivities.map((activity, idx) => (
                    <div
                      key={idx}
                      style={{
                        fontSize: 12,
                        color: C.textDim,
                        paddingLeft: 8,
                        borderLeft: `2px solid ${C.border}`,
                      }}
                    >
                      {activity}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface PillarRowProps {
  pillar: Pillar;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  healthColor: string;
  healthLabel: string;
}

function PillarRow({
  pillar,
  isExpanded,
  onToggleExpanded,
  healthColor,
  healthLabel,
}: PillarRowProps) {
  const router = useRouter();

  const handleGoalClick = (goalId: string) => {
    router.push(`/goals/${goalId}`);
  };

  return (
    <div>
      {/* Pillar Header */}
      <button
        onClick={onToggleExpanded}
        style={{
          width: "100%",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          transition: "border-color 0.2s, background 0.2s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = C.card;
          (e.currentTarget as HTMLElement).style.borderColor = C.cl;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = C.surface;
          (e.currentTarget as HTMLElement).style.borderColor = C.border;
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, textAlign: "left" }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: healthColor,
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: C.text }}>
              {pillar.name}
            </div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
              {healthLabel}
            </div>
          </div>
        </div>
        <div
          style={{
            fontSize: 12,
            color: C.textFaint,
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        >
          ▼
        </div>
      </button>

      {/* Expanded Content: Goals */}
      {isExpanded && pillar.goals.length > 0 && (
        <div style={{ padding: "4px 12px 10px 48px" }}>
          {pillar.goals.map((goal) => (
            <div
              key={goal.id}
              onClick={() => handleGoalClick(goal.id)}
              style={{
                cursor: "pointer",
                borderRadius: 6,
                padding: "4px",
                transition: "border-color 0.2s, background 0.2s",
                marginBottom: 8,
                border: `1px solid ${C.border}`,
              }}
              onMouseEnter={(e) => {
                const elem = e.currentTarget as HTMLElement;
                elem.style.borderColor = C.cl;
                elem.style.background = C.surface + "40";
              }}
              onMouseLeave={(e) => {
                const elem = e.currentTarget as HTMLElement;
                elem.style.borderColor = C.border;
                elem.style.background = "transparent";
              }}
            >
              <GoalProgressCompact goal={goal} />
            </div>
          ))}
        </div>
      )}

      {/* Expanded Content: No Goals */}
      {isExpanded && pillar.goals.length === 0 && (
        <div
          style={{
            padding: "12px 48px",
            color: C.textDim,
            fontSize: 12,
            fontStyle: "italic",
          }}
        >
          No goals in this pillar yet.
        </div>
      )}

      {/* Expanded Content: Recent Activities */}
      {isExpanded && pillar.recentActivities && pillar.recentActivities.length > 0 && (
        <div style={{ padding: "8px 12px 0 48px" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: C.textFaint, marginBottom: 6 }}>
            Recent Activity
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {pillar.recentActivities.map((activity, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: 12,
                  color: C.textDim,
                  paddingLeft: 8,
                  borderLeft: `2px solid ${C.border}`,
                }}
              >
                {activity}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
