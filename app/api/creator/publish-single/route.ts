/**
 * Publish a single post — POST /api/creator/publish-single
 *
 * Body: { postId: string }
 * Publishes one specific queue item immediately regardless of schedule.
 *
 * Auth: Authenticated user session.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { publishSinglePost } from "@/lib/creator/jobs";

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await request.json();
  const postId = body?.postId;

  if (!postId || typeof postId !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid postId" },
      { status: 400 }
    );
  }

  try {
    const result = await publishSinglePost(user.id, postId);
    return NextResponse.json(result, {
      status: result.success ? 200 : 422,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Publish failed" },
      { status: 500 }
    );
  }
}
