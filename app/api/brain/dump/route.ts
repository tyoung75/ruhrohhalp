import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { embedAndStore } from "@/lib/embedding";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";

/**
 * POST /api/brain/dump
 *
 * Structured brain dump — ingests the user's current priorities, weekly context,
 * and top-of-mind thoughts into the memory system with high importance so they
 * surface prominently in briefings and RAG queries.
 *
 * Also updates goal priorities when goal IDs are provided.
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    const body = await request.json();
    const { topGoals, thisWeek, topOfMind } = body as {
      topGoals?: Array<{ goalId?: string; text: string }>;
      thisWeek?: string;
      topOfMind?: string;
    };

    if (!topGoals?.length && !thisWeek?.trim() && !topOfMind?.trim()) {
      return NextResponse.json({ error: "At least one field is required" }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const results: { section: string; memoryIds: string[] }[] = [];

    // 1. Ingest top goals as high-importance memories
    if (topGoals?.length) {
      const goalsText = topGoals
        .map((g, i) => `${i + 1}. ${g.text}`)
        .join("\n");

      const content = `[Brain Dump — ${today}] Top Goals:\n${goalsText}`;
      const res = await embedAndStore(content, {
        userId: user.id,
        source: "manual",
        category: "work",
        importance: 9,
        tags: ["brain-dump", "goals", "priorities", today],
      });
      results.push({ section: "topGoals", memoryIds: res.memoryIds });

      // Update goal priorities if goal IDs were provided
      const supabase = await createClient();
      const goalIds = topGoals.filter((g) => g.goalId).map((g) => g.goalId!);
      if (goalIds.length > 0) {
        // Mark these goals as the user's current focus
        await supabase
          .from("goals")
          .update({ priority: "critical", updated_at: new Date().toISOString() })
          .in("id", goalIds)
          .eq("user_id", user.id);
      }
    }

    // 2. Ingest "this week" context
    if (thisWeek?.trim()) {
      const content = `[Brain Dump — ${today}] This week's context and plans:\n${thisWeek.trim()}`;
      const res = await embedAndStore(content, {
        userId: user.id,
        source: "manual",
        category: "work",
        importance: 8,
        tags: ["brain-dump", "weekly-context", today],
      });
      results.push({ section: "thisWeek", memoryIds: res.memoryIds });
    }

    // 3. Ingest "top of mind" thoughts
    if (topOfMind?.trim()) {
      const content = `[Brain Dump — ${today}] Top of mind:\n${topOfMind.trim()}`;
      const res = await embedAndStore(content, {
        userId: user.id,
        source: "manual",
        category: "general",
        importance: 8,
        tags: ["brain-dump", "top-of-mind", today],
      });
      results.push({ section: "topOfMind", memoryIds: res.memoryIds });
    }

    return NextResponse.json({
      success: true,
      results,
      date: today,
    });
  } catch (error) {
    logError("brain.dump", error);
    return NextResponse.json({ error: "Failed to process brain dump" }, { status: 500 });
  }
}

/**
 * GET /api/brain/dump
 *
 * Returns the most recent brain dump entries so the UI can pre-populate.
 */
export async function GET() {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    const supabase = await createClient();

    const { data: memories } = await supabase
      .from("memories")
      .select("id, content, tags, created_at")
      .eq("user_id", user.id)
      .contains("tags", ["brain-dump"])
      .order("created_at", { ascending: false })
      .limit(10);

    // Parse the most recent entries by section
    const latest: { topGoals?: string; thisWeek?: string; topOfMind?: string; date?: string } = {};

    for (const m of memories ?? []) {
      const content = m.content as string;
      if (!latest.date) {
        // Extract date from the tag
        const dateTag = (m.tags as string[])?.find((t: string) => /^\d{4}-\d{2}-\d{2}$/.test(t));
        if (dateTag) latest.date = dateTag;
      }
      if (!latest.topGoals && content.includes("Top Goals:")) {
        latest.topGoals = content.replace(/^\[Brain Dump.*?\]\s*Top Goals:\n?/, "");
      }
      if (!latest.thisWeek && content.includes("This week")) {
        latest.thisWeek = content.replace(/^\[Brain Dump.*?\]\s*This week's context and plans:\n?/, "");
      }
      if (!latest.topOfMind && content.includes("Top of mind:")) {
        latest.topOfMind = content.replace(/^\[Brain Dump.*?\]\s*Top of mind:\n?/, "");
      }
    }

    return NextResponse.json({ latest });
  } catch (error) {
    logError("brain.dump.get", error);
    return NextResponse.json({ error: "Failed to fetch brain dump" }, { status: 500 });
  }
}
