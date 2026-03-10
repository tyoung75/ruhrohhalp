import { C } from "@/lib/ui";
import { PROVIDERS } from "@/lib/ai/registry";
import type { TaskType } from "@/lib/types/domain";

export function Spinner({ color = C.cl, size = 14 }: { color?: string; size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `2px solid ${color}30`,
        borderTopColor: color,
        borderRadius: "50%",
        animation: "spin .7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

export function ThinkDots({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "10px 14px" }}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`dot-${i}`}
          style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "block" }}
        />
      ))}
    </div>
  );
}

const TYPE_META: Record<TaskType, { label: string; color: string; icon: string }> = {
  task: { label: "Task", color: C.task, icon: "◈" },
  note: { label: "Note", color: C.note, icon: "◎" },
  todo: { label: "To-Do", color: C.todo, icon: "☐" },
  reminder: { label: "Reminder", color: C.reminder, icon: "◷" },
};

export function TypeBadge({ type }: { type: TaskType }) {
  const meta = TYPE_META[type] || TYPE_META.task;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 10,
        fontFamily: C.mono,
        letterSpacing: 0.5,
        padding: "1px 7px",
        borderRadius: 4,
        background: `${meta.color}15`,
        color: meta.color,
        border: `1px solid ${meta.color}28`,
      }}
    >
      {meta.icon} {meta.label}
    </span>
  );
}

export function AgentDot({ id, size = 8 }: { id: keyof typeof PROVIDERS; size?: number }) {
  const provider = PROVIDERS[id];
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: provider.color,
        boxShadow: `0 0 5px ${provider.color}80`,
      }}
    />
  );
}
