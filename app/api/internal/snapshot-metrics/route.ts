import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { runJob } from "@/lib/jobs/executor";

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const result = await runJob(
    "snapshot-metrics",
    async () => {
      // TODO: implement real metric snapshot + pattern extraction (Item 8c)
      return { ok: true, job: "snapshot-metrics", message: "stub" };
    },
    { idempotencyKey: `snapshot-metrics-${today}` },
  );

  return NextResponse.json(result);
}
