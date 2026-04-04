/**
 * Weekly Review Auto-Generation
 * Runs Sunday 7 PM ET — synthesizes the week and embeds into memory.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callClaude } from "@/lib/processors/claude";
import { embedAndStore } from "@/lib/embedding/pipeline";
import { logError } from "@/lib/logger";

export const maxDuration = 60;
const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

function checkAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

export async function GET(request: NextRequest) {
  const authError = checkAuth(request);
  if (authError) return authError;

  const supabase = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  try {
    const [tasksRes, goalsRes, brandsRes, contentRes, feedbackRes] = await Promise.all([
      supabase.from("tasks").select("title, state, priority, updated_at").eq("user_id", TYLER_USER_ID).eq("state", "done").gte("updated_at", sevenDaysAgo).order("updated_at", { ascending: false }).limit(20),
      supabase.from("goals").select("title, progress_current, progress_target, status").eq("user_id", TYLER_USER_ID).eq("status", "active").limit(10),
      supabase.from("brand_deals").select("brand_name, status, updated_at").eq("user_id", TYLER_USER_ID).gte("updated_at", sevenDaysAgo).limit(10),
      supabase.from("content_queue").select("platform, status, body").eq("user_id", TYLER_USER_ID).eq("status", "posted").gte("created_at", sevenDaysAgo).limit(15),
      supabase.from("content_feedback").select("feedback_type, content").eq("user_id", TYLER_USER_ID).gte("created_at", sevenDaysAgo).limit(10),
    ]);

    const context = [
      `## Tasks Completed (${tasksRes.data?.length ?? 0})`,
      ...(tasksRes.data ?? []).map((t) => `- ${t.title}`),
      `\n## Active Goals`,
      ...(goalsRes.data ?? []).map((g) => `- ${g.title}: ${g.progress_current ?? "?"} / ${g.progress_target ?? "?"}`),
      `\n## Brand Pipeline Movement`,
      ...(brandsRes.data ?? []).map((b) => `- ${b.brand_name}: ${b.status}`),
      `\n## Content Published (${contentRes.data?.length ?? 0} posts)`,
      ...(contentRes.data ?? []).slice(0, 5).map((c) => `- [${c.platform}] ${(c.body as string)?.slice(0, 60)}`),
      `\n## Feedback Given`,
      ...(feedbackRes.data ?? []).map((f) => `- [${f.feedback_type}] ${f.content?.slice(0, 80)}`),
    ].join("\n");

    const review = await callClaude(
      "You generate concise weekly reviews for Tyler Young's personal OS. Be specific — reference actual tasks, goals, and brands by name. Structure: What Shipped, What Stalled, Top 3 Priorities for Next Week.",
      `Generate Tyler's weekly review based on this week's activity:\n\n${context}\n\nReturn a structured weekly review with exactly these three sections:\n## What Shipped\n## What Stalled\n## Top 3 Priorities for Next Week`,
      1024,
    );

    // Save as briefing
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    await supabase.from("briefings").upsert({
      user_id: TYLER_USER_ID,
      date: today,
      period: "weekly",
      content_md: review,
      content_json: [{ title: "Weekly Review", icon: "W", color: "#8B5CF6", items: [{ id: "review", text: review }] }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,date,period" });

    // Embed into memory
    await embedAndStore(
      `[WEEKLY REVIEW ${today}]\n${review}`,
      { userId: TYLER_USER_ID, source: "manual", sourceId: `weekly-review:${today}`, category: "general", importance: 8, tags: ["system:learning", "weekly-review"] },
    );

    return NextResponse.json({ ok: true, review, date: today });
  } catch (error) {
    logError("cron.weekly-review", error);
    return NextResponse.json({ error: "Weekly review failed" }, { status: 500 });
  }
}
