import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { runBrandScoutPipeline } from "@/lib/creator/brand-scout";
import { limitByKey } from "@/lib/security/rate-limit";

const requestSchema = z.object({
  mode: z.enum(["scout", "pipeline"]).default("pipeline"),
});

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { ok, retryAfterMs } = limitByKey(`creator-brand-scout:${user.id}`, 8, 60 * 60 * 1000);
  if (!ok) {
    return NextResponse.json(
      { error: `Rate limited. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.` },
      { status: 429 },
    );
  }

  try {
    const result = await runBrandScoutPipeline(user.id, parsed.data.mode);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[creator-brand-scout] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Brand scout failed" },
      { status: 500 },
    );
  }
}
