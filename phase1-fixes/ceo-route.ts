import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { queryBrain } from "@/lib/query";
import { logError } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    // Fetch active (non-done, non-cancelled) tasks to give CEO mode real context
    const supabase = await createClient();
    const { data: activeTasks } = await supabase
      .from("tasks")
      .select("title, state, priority_num, identifier, due_date")
      .eq("user_id", user.id)
      .in("state", ["backlog", "unstarted", "started", "in_review"])
      .order("priority_num", { ascending: true })
      .limit(30);

    // Fetch active goals for goal-aware briefing
    const { data: activeGoals } = await supabase
      .from("goals")
      .select("title, priority, progress_current, progress_target, target_date, pillar_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("priority", { ascending: true })
      .limit(20);

    // Fetch pillar names for goal context
    const { data: pillars } = await supabase
      .from("pillars")
      .select("id, name, emoji")
      .eq("user_id", user.id)
      .eq("is_active", true);

    const pillarMap = new Map((pillars ?? []).map(p => [p.id, p]));

    // Build task context string
    const taskContext = (activeTasks ?? [])
      .map(t => `- [${t.identifier ?? "?"}] ${t.title} (${t.state}, P${t.priority_num ?? 3}${t.due_date ? `, due ${t.due_date}` : ""})`)
      .join("\n");

    // Build goal context string
    const goalContext = (activeGoals ?? [])
      .map(g => {
        const pillar = pillarMap.get(g.pillar_id);
        const pillarName = pillar ? `${pillar.emoji} ${pillar.name}` : "Unknown";
        return `- [${pillarName}] ${g.title}: ${g.progress_current ?? "?"} → ${g.progress_target ?? "?"} (${g.priority}${g.target_date ? `, target ${g.target_date}` : ""})`;
      })
      .join("\n");

    const CEO_PROMPT = `You are Tyler's CEO briefing system. Review all of Tyler's stored memories, tasks, decisions, meetings, and project knowledge across every venture (Motus, RuhrohHalp, Iron Passport, Caliber, thestayed).

IMPORTANT: Only reference ACTIVE tasks. Do NOT mention completed or cancelled items. Here are Tyler's current active tasks:

${taskContext || "(No active tasks found in database)"}

${goalContext ? `Here are Tyler's active life goals across his pillars:\n\n${goalContext}\n\nPrioritize recommendations that move these goals forward.` : ""}

Return a structured CEO briefing with exactly these four sections. Use bullet points. Be specific — reference real items, people, deadlines, and context from the memories. Frame everything through the lens of Tyler's goals and what will create the most progress.

## Highest-Leverage Tasks
The top 3 things Tyler should focus on RIGHT NOW that will create the most impact across all ventures and life goals. Explain why each is high-leverage and which goal it serves.

## Open Decisions
Decisions that are pending or need Tyler's input. Include context and what's blocking the decision.

## Cross-Venture Blockers
Anything blocking progress across ventures — dependencies, missing info, waiting on people, resource conflicts.

## Delegatable Work
Items Tyler is currently holding that could be handed off to someone else. Suggest who could take each item if known from context.`;

    const result = await queryBrain(CEO_PROMPT, {
      userId: user.id,
      topK: 12,
      threshold: 0.55,
    });

    // Parse the structured answer into sections
    const sections = parseCeoSections(result.answer);

    return NextResponse.json({
      ...sections,
      sources: result.sources,
      raw: result.answer,
    });
  } catch (error) {
    logError("brain.ceo", error);
    return NextResponse.json({ error: "CEO mode failed" }, { status: 500 });
  }
}

function parseCeoSections(answer: string) {
  const leverage = extractSection(answer, "Highest-Leverage Tasks");
  const decisions = extractSection(answer, "Open Decisions");
  const blockers = extractSection(answer, "Cross-Venture Blockers");
  const delegate = extractSection(answer, "Delegatable Work");

  return { leverage, decisions, blockers, delegate };
}

function extractSection(text: string, heading: string): string[] {
  // Find the section between this heading and the next ## heading (or end)
  const pattern = new RegExp(
    `##\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  const match = text.match(pattern);
  if (!match) return [];

  // Extract bullet points (lines starting with - or *)
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^[\s]*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}
