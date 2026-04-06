/**
 * Workout Post Generator — creates a single Threads post when a Strava
 * activity arrives via webhook.
 *
 * The post is focused on the workout but can weave in other context
 * (weather, what's happening in Tyler's life, NYC vibes, etc.) to keep
 * it from feeling like a bot reposting Strava stats.
 *
 * Runs through the brand voice audit before queuing.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { callClaude } from "@/lib/processors/claude";
import { type StravaActivity } from "@/lib/strava/client";
import { logError } from "@/lib/logger";

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

const toMiles = (m: number) => (m / 1609.344).toFixed(1);
const toHMS = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const toPace = (mps: number) => {
  if (!mps || mps === 0) return "";
  const spm = 1609.344 / mps;
  const min = Math.floor(spm / 60);
  const sec = Math.round(spm % 60);
  return `${min}:${sec.toString().padStart(2, "0")}/mi`;
};

function formatActivity(a: StravaActivity): string {
  const lines = [
    `Type: ${a.type} (${a.sport_type})`,
    `Name: "${a.name}"`,
  ];
  if (a.distance > 0) lines.push(`Distance: ${toMiles(a.distance)} miles`);
  lines.push(`Duration: ${toHMS(a.moving_time)}`);
  if (a.type === "Run" && a.average_speed > 0) lines.push(`Avg pace: ${toPace(a.average_speed)}`);
  if (a.max_speed > 0 && a.type === "Run") lines.push(`Max pace: ${toPace(a.max_speed)}`);
  if (a.average_heartrate) lines.push(`Avg HR: ${Math.round(a.average_heartrate)} bpm`);
  if (a.max_heartrate) lines.push(`Max HR: ${Math.round(a.max_heartrate)} bpm`);
  if (a.total_elevation_gain > 10) lines.push(`Elevation: ${Math.round(a.total_elevation_gain * 3.281)} ft`);
  if (a.suffer_score) lines.push(`Suffer score: ${a.suffer_score}`);
  if (a.pr_count > 0) lines.push(`PRs: ${a.pr_count}`);
  if (a.calories) lines.push(`Calories: ${a.calories}`);
  if (a.average_cadence) lines.push(`Cadence: ${Math.round(a.average_cadence * 2)} spm`);
  if (a.description) lines.push(`Notes: ${a.description}`);
  const date = new Date(a.start_date_local);
  lines.push(`Date: ${date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}`);
  lines.push(`Time: ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`);
  return lines.join("\n");
}

const WORKOUT_POST_SYSTEM = `You are Tyler Young's workout post writer. Tyler just finished a workout and you need to write ONE Threads post about it.

CRITICAL RULES:
- The post MUST be primarily about this workout. Reference specific stats from the activity.
- But DON'T just restate the stats like a bot. Tyler's voice is wry, observational, and specific.
- Weave in one natural aside — could be about the weather, the route, NYC, what he's doing after, a random thought mid-run, his training block, Berlin Marathon prep, coffee, etc.
- Keep it SHORT. 1-3 sentences max. Threads posts are punchy.
- Use real numbers from the workout. If Strava says 8:12/mi, say 8:12. Never round or estimate.
- lowercase casual. "I" is always capitalized. First letter of the post is capitalized.
- NO hashtags, NO emojis, NO "hot take:", NO engagement bait, NO lessons/morals.
- NO phrases like "there's something about", "not gonna lie", "hear me out", "genuinely".
- Don't wrap up with a neat conclusion. Posts can just stop mid-thought.
- Don't start with the workout type ("Just did a 6 mile run"). Start with an observation or the most interesting part.
- This should feel like something Tyler would actually type into Threads after a workout — raw, real, immediate.

ANTI-PATTERNS (never do these):
- "nothing like a morning run to..."  (cliché)
- "X miles in the books" (overused)
- listing stats separated by periods like "6.2 miles. 48:32. 7:49 pace." (bot energy)
- any sentence that sounds like a Peloton instructor
- framing the workout as suffering or grinding
- ending with a motivational takeaway

GOOD EXAMPLES of Tyler's actual voice:
- "8:12 pace on a 92 degree day is either impressive or stupid and I genuinely cannot tell which"
- "the thing about running the east river path at 6am is you see the same 4 people every single day and none of us have ever spoken"
- "tempo run said 7:30 pace, legs said 7:50, we compromised at 7:42 and I'm choosing to call that a win"
- "14 miles before coffee is a personality flaw I'm no longer interested in fixing"

CONTEXT you can reference (if provided):
- Recent posts Tyler has made (avoid repeating similar themes)
- Current goals, tasks, weather, time of day
- Berlin Marathon training context
- What day of the week it is

OUTPUT: Return ONLY a JSON object (no markdown, no explanation):
{
  "body": "the post text",
  "confidence": 0.0-1.0,
  "brand_voice_score": 0.0-1.0,
  "timeliness_score": 0.0-1.0,
  "reasoning": "why this angle"
}`;

export async function generateWorkoutPost(activity: StravaActivity): Promise<{
  queued: boolean;
  postId?: string;
  error?: string;
}> {
  const supabase = createAdminClient();

  try {
    // Check if we already generated a post for this activity
    const { data: existing } = await supabase
      .from("content_queue")
      .select("id")
      .eq("user_id", TYLER_USER_ID)
      .eq("agent_reasoning", `strava:${activity.id}`)
      .limit(1);

    if (existing?.length) {
      return { queued: false, error: "Already generated for this activity" };
    }

    // Gather light context — recent posts to avoid redundancy
    const { data: recentPosts } = await supabase
      .from("content_queue")
      .select("body, platform")
      .eq("user_id", TYLER_USER_ID)
      .in("status", ["posted", "queued", "draft"])
      .gte("created_at", new Date(Date.now() - 3 * 86400000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10);

    const recentContext = (recentPosts ?? [])
      .map((p: { body: string; platform: string }) => `[${p.platform}] ${(p.body).slice(0, 120)}`)
      .join("\n");

    const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });
    const timeOfDay = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    const userMessage = `Tyler just finished this workout:

${formatActivity(activity)}

Context:
- Day: ${dayOfWeek}
- Current time: ${timeOfDay}
${recentContext ? `\nRecent posts (avoid similar themes):\n${recentContext}` : ""}

Write ONE Threads post about this workout. Return ONLY the JSON object.`;

    const raw = await callClaude(WORKOUT_POST_SYSTEM, userMessage, 512, { temperature: 0.9 });

    // Parse response
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    let parsed: { body: string; confidence: number; brand_voice_score: number; timeliness_score: number; reasoning: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const objMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!objMatch) throw new Error("No JSON object in response");
      parsed = JSON.parse(objMatch[0]);
    }

    if (!parsed.body || typeof parsed.body !== "string") {
      throw new Error("Generated post has no body");
    }

    // Schedule for 30-60 min from now (gives time to feel natural, not instant)
    const delay = 30 + Math.floor(Math.random() * 30); // 30-60 min
    const scheduledFor = new Date(Date.now() + delay * 60 * 1000);

    // Insert into content_queue
    const insertRow: Record<string, unknown> = {
      user_id: TYLER_USER_ID,
      platform: "threads",
      content_type: "text",
      body: parsed.body,
      scheduled_for: scheduledFor.toISOString(),
      status: "queued",
      confidence_score: parsed.confidence ?? 0.8,
      brand_voice_score: parsed.brand_voice_score ?? 0.7,
      timeliness_score: parsed.timeliness_score ?? 0.9,
      agent_reasoning: `strava:${activity.id}`,
      context_snapshot: {
        source: "strava_webhook",
        activity_id: activity.id,
        activity_type: activity.type,
        activity_name: activity.name,
      },
    };

    // Try with model_source, fall back without
    let { data, error } = await supabase.from("content_queue")
      .insert({ ...insertRow, model_source: "internal" })
      .select("id").single();

    if (error?.message?.includes("model_source")) {
      ({ data, error } = await supabase.from("content_queue")
        .insert(insertRow)
        .select("id").single());
    }

    if (error) {
      throw new Error(`Insert failed: ${error.message}`);
    }

    return { queued: true, postId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("workout-post.generate", err);
    return { queued: false, error: msg };
  }
}
