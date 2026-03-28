import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { runJob } from "@/lib/jobs/executor";

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runJob(
    "content-handoff",
    async () => {
      // TODO: implement real content handoff (Item 8b)
      return { ok: true, job: "content-handoff", message: "stub" };
    },
  );

  return NextResponse.json(result);
}
