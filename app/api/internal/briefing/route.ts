import { NextRequest, NextResponse } from "next/server";
import { validateInternalRequest } from "@/lib/internal-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "@/lib/jobs/executor";
import { loadBriefingContext } from "@/lib/ai/briefing-context";

export async function POST(request: NextRequest) {
  if (!validateInternalRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const type = (body.type ?? "morning") as "morning" | "evening" | "weekly";
  const today = new Date().toISOString().slice(0, 10);

  const result = await runJob(
    `briefing-${type}`,
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

      // Load briefing context (full cross-system snapshot for weekly)
      let context: Record<string, unknown> = {};
      if (type === "weekly") {
        context = await loadBriefingContext(userId);
      }

      // TODO: implement real briefing generation with callAI()
      // For now, save stub to briefings table with gmail_draft_pending
      const { data: briefing, error } = await supabase
        .from("briefings")
        .insert({
          user_id: userId,
          date: today,
          period: type,
          content_md: `# ${type.charAt(0).toUpperCase() + type.slice(1)} Briefing — ${today}\n\n_Briefing generation pending implementation._`,
          content_json: { type, context_loaded: type === "weekly", context_keys: Object.keys(context) },
          gmail_draft_pending: true,
        })
        .select("id")
        .single();

      if (error) throw new Error(error.message);

      return {
        ok: true,
        job: "briefing",
        type,
        briefing_id: briefing.id,
        gmail_draft_pending: true,
        context_loaded: type === "weekly",
      };
    },
    { idempotencyKey: `briefing-${type}-${today}` },
  );

  return NextResponse.json(result);
}
