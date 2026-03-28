import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { runJob } from "@/lib/jobs/executor";

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const type = body.type ?? "morning";
  const today = new Date().toISOString().slice(0, 10);

  const result = await runJob(
    `briefing-${type}`,
    async () => {
      // TODO: implement real briefing generation
      return { ok: true, job: "briefing", type, message: "stub" };
    },
    { idempotencyKey: `briefing-${type}-${today}` },
  );

  return NextResponse.json(result);
}
