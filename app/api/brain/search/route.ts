import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { queryBrain } from "@/lib/query";
import { logError } from "@/lib/logger";
import type { MemoryCategory } from "@/lib/types/domain";

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  try {
    const body = await request.json();
    const { query, projectId, category, topK } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const result = await queryBrain(query, {
      userId: user.id,
      topK: topK ?? 8,
      projectId,
      category: category as MemoryCategory | undefined,
    });

    return NextResponse.json({
      answer: result.answer,
      sources: result.sources,
      chunks: result.chunks,
    });
  } catch (error) {
    logError("brain.search", error);
    return NextResponse.json({ error: "Memory search failed" }, { status: 500 });
  }
}
