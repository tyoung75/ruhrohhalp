import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";

// TODO: wrap in runJob() after Item 5
export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    job: "snapshot-metrics",
    message: "stub",
  });
}
