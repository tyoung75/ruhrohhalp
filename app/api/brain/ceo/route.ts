import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { queryBrain } from "@/lib/query";
import { logError } from "@/lib/logger";

const CEO_PROMPT = `Review all of Tyler's stored memories, tasks, decisions, meetings, and project knowledge across every venture (Motus, RuhrohHalp, Iron Passport, Caliber, thestayed).

Return a structured CEO briefing with exactly these four sections. Use bullet points. Be specific — reference real items, people, deadlines, and context from the memories.

## Highest-Leverage Tasks
The top 3 things Tyler should focus on RIGHT NOW that will create the most impact across all ventures. Explain why each is high-leverage.

## Open Decisions
Decisions that are pending or need Tyler's input. Include context and what's blocking the decision.

## Cross-Venture Blockers
Anything blocking progress across ventures — dependencies, missing info, waiting on people, resource conflicts.

## Delegatable Work
Items Tyler is currently holding that could be handed off to someone else. Suggest who could take each item if known from context.`;

export async function POST() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
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
