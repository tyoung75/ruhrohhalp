import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";

// TODO: wrap in runJob() after Item 5
export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const type = body.type ?? "morning";

  return NextResponse.json({
    ok: true,
    job: "briefing",
    type,
    message: "stub",
  });
}
