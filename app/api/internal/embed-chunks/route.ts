import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { runJob } from "@/lib/jobs/executor";

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const result = await runJob(
    "embed-chunks",
    async () => {
      // TODO: implement real embedding pipeline
      return { ok: true, job: "embed-chunks", message: "stub" };
    },
    { idempotencyKey: `embed-chunks-${today}` },
  );

  return NextResponse.json(result);
}
