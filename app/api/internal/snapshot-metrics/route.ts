import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "@/lib/jobs/executor";
import { computeEngagementScore, extractPatterns } from "@/lib/ai/pattern-extraction";

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const isSunday = new Date().getDay() === 0;

  const result = await runJob(
    "snapshot-metrics",
    async () => {
      const supabase = createAdminClient();

      // Get the single user
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .limit(1)
        .single();

      if (!profile) throw new Error("No user found");
      const userId = profile.id;

      // Compute engagement_score for recent analytics rows that don't have one
      const { data: unscored } = await supabase
        .from("post_analytics")
        .select("id, impressions, likes, replies, reposts, saves, shares")
        .eq("user_id", userId)
        .is("engagement_score", null)
        .limit(100);

      let scoresUpdated = 0;
      for (const row of unscored ?? []) {
        const score = computeEngagementScore(row);
        await supabase
          .from("post_analytics")
          .update({ engagement_score: score })
          .eq("id", row.id);
        scoresUpdated++;
      }

      // Run pattern extraction on Sundays
      let patternsExtracted = false;
      if (isSunday) {
        await extractPatterns(userId);
        patternsExtracted = true;
      }

      return {
        ok: true,
        job: "snapshot-metrics",
        scores_updated: scoresUpdated,
        patterns_extracted: patternsExtracted,
      };
    },
    { idempotencyKey: `snapshot-metrics-${today}` },
  );

  return NextResponse.json(result);
}
