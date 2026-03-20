"use client";

import { C } from "@/lib/ui";
import { CommandBar } from "@/components/command-bar";
import { BriefingView } from "@/components/briefing-view";
import { TaskRail } from "@/components/task-rail";
import { AgentStatus } from "@/components/agent-status";

export default function CommandConsolePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, color: C.text, fontFamily: C.sans }}>
      {/* Command Bar - persistent at top */}
      <CommandBar />

      {/* Main content area */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", background: C.bg }}>
        {/* Left column - Briefing (60%) */}
        <div
          style={{
            flex: "0 0 60%",
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${C.border}`,
            overflow: "auto",
          }}
        >
          <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", height: "100%" }}>
            <BriefingView />
          </div>
        </div>

        {/* Right column - Task Rail (40%) */}
        <div
          style={{
            flex: "0 0 40%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: C.bg,
          }}
        >
          <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
            <TaskRail />
          </div>
        </div>
      </div>

      {/* Agent Status Bar - persistent at bottom */}
      <AgentStatus />
    </div>
  );
}
