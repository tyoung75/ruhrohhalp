import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPipelineSummary } from "@/lib/brands/pipeline";

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    const summary = await getPipelineSummary(TYLER_USER_ID);
    return NextResponse.json(summary);
  }

  const { user, response } = await requireUser();
  if (response || !user) return response;

  const summary = await getPipelineSummary(user.id);
  return NextResponse.json(summary);
}
