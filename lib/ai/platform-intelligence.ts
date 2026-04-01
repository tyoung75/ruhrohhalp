import { createAdminClient } from "@/lib/supabase/admin";
import { AI_MODELS } from "@/lib/ai-config";
import { callAI } from "@/lib/ai/providers";

export type ContentIdea = {
  topic: string;
  platforms: string[];
  content_type?: string;
  angle?: string;
  goal_id?: string;
};

type SystemContext = {
  active_goals: { id: string; title: string; progress_current: string; progress_target: string }[];
  top_tasks: { title: string; priority_score: number }[];
  brain_dump_week: string | null;
  top_of_mind: string | null;
  queued_topics: string[];
  content_directives: string[];
};

type PerformanceContext = {
  recent_posts: { platform: string; body: string; engagement_rate: number; likes: number }[];
  content_patterns: Record<string, unknown>;
};

type PlatformVariant = {
  platform: string;
  body: string;
  caption: string | null;
  title: string | null;
  hashtags: string[];
  content_type: string;
  platform_format: string;
  platform_spec: Record<string, unknown>;
};

/**
 * Load system context: active goals, top scored tasks, brain dump, queued topics.
 */
export async function loadSystemContext(userId: string): Promise<SystemContext> {
  const supabase = createAdminClient();

  const [goalsRes, tasksRes, settingsRes, queuedRes, directivesRes] = await Promise.all([
    supabase
      .from("goals")
      .select("id, title, progress_current, progress_target")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(10),
    supabase
      .from("tasks")
      .select("title, priority_score")
      .eq("user_id", userId)
      .not("state", "in", "(done,cancelled)")
      .order("priority_score", { ascending: false })
      .limit(5),
    supabase
      .from("user_settings")
      .select("brain_dump_week, top_of_mind")
      .eq("user_id", userId)
      .single(),
    supabase
      .from("content_queue")
      .select("topic, body")
      .eq("user_id", userId)
      .in("status", ["draft", "queued", "approved"])
      .limit(20),
    // Fetch broad content directives from signal replies
    supabase
      .from("signal_replies")
      .select("reply")
      .eq("user_id", userId)
      .eq("scope", "broad")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return {
    active_goals: goalsRes.data ?? [],
    top_tasks: tasksRes.data ?? [],
    brain_dump_week: settingsRes.data?.brain_dump_week ?? null,
    top_of_mind: settingsRes.data?.top_of_mind ?? null,
    queued_topics: (queuedRes.data ?? []).map(q => q.topic || q.body?.slice(0, 50) || ""),
    content_directives: (directivesRes.data ?? []).map(d => d.reply).filter(Boolean),
  };
}

/**
 * Load performance context: recent posts per platform + content patterns.
 */
export async function loadPerformanceContext(userId: string): Promise<PerformanceContext> {
  const supabase = createAdminClient();

  const [analyticsRes, settingsRes] = await Promise.all([
    supabase
      .from("post_analytics")
      .select("platform, content_queue_id, impressions, likes, replies, engagement_rate")
      .eq("user_id", userId)
      .order("fetched_at", { ascending: false })
      .limit(60),
    supabase
      .from("user_settings")
      .select("content_patterns")
      .eq("user_id", userId)
      .single(),
  ]);

  // Join with content_queue to get body text
  const queueIds = (analyticsRes.data ?? []).map(a => a.content_queue_id).filter(Boolean);
  const bodyMap = new Map<string, string>();

  if (queueIds.length > 0) {
    const { data: posts } = await supabase
      .from("content_queue")
      .select("id, body")
      .in("id", queueIds);
    for (const p of posts ?? []) {
      bodyMap.set(p.id, p.body);
    }
  }

  const recent_posts = (analyticsRes.data ?? []).map(a => ({
    platform: a.platform,
    body: a.content_queue_id ? bodyMap.get(a.content_queue_id) ?? "" : "",
    engagement_rate: a.engagement_rate ?? 0,
    likes: a.likes ?? 0,
  }));

  return {
    recent_posts,
    content_patterns: (settingsRes.data?.content_patterns as Record<string, unknown>) ?? {},
  };
}

/**
 * Generate per-platform content variants using Opus.
 */
export async function generatePlatformVariants(
  idea: ContentIdea,
  systemCtx: SystemContext,
  performanceCtx: PerformanceContext,
): Promise<PlatformVariant[]> {
  const platforms = idea.platforms.length > 0 ? idea.platforms : ["threads"];

  const directivesBlock = systemCtx.content_directives.length > 0
    ? `\n\nCONTENT DIRECTIVES FROM TYLER (must follow):\n${systemCtx.content_directives.map(d => `- ${d}`).join("\n")}`
    : "";

  const systemPrompt = `You are the Platform Intelligence Agent for a personal brand content system.

CONTEXT:
- Active goals: ${JSON.stringify(systemCtx.active_goals.map(g => g.title))}
- Top priorities: ${JSON.stringify(systemCtx.top_tasks.map(t => t.title))}
- Brain dump: ${systemCtx.brain_dump_week || "none"}
- Top of mind: ${systemCtx.top_of_mind || "none"}
- Already queued topics: ${systemCtx.queued_topics.join(", ") || "none"}
- Recent content performance patterns: ${JSON.stringify(performanceCtx.content_patterns)}${directivesBlock}

PLATFORM RULES:
- threads: Max 500 chars, conversational, lowercase, no hashtags in body. Hook in first line.
- instagram: Caption up to 2200 chars, 3-5 hashtags, CTA at end. Separate title for carousel/reel.
- tiktok: Caption up to 150 chars, 3 hashtags max, hook-driven. Title required for video.
- youtube: Description up to 5000 chars, SEO-optimized title, timestamps if applicable.

VOICE: Direct, specific, lowercase preferred, no clichés, no corporate speak. Tyler's authentic voice.

Output MUST be valid JSON array of platform variants.`;

  const userPrompt = `Generate content for each platform: ${platforms.join(", ")}

Topic: ${idea.topic}
${idea.angle ? `Angle: ${idea.angle}` : ""}
${idea.content_type ? `Content type: ${idea.content_type}` : ""}

Return a JSON array where each element has:
{
  "platform": "threads|instagram|tiktok|youtube",
  "body": "the main content text",
  "caption": "platform caption (null if same as body)",
  "title": "title for reels/videos/carousels (null for text posts)",
  "hashtags": ["tag1", "tag2"],
  "content_type": "text|image|carousel|reel|video",
  "platform_format": "thread|carousel|reel|short|long_form",
  "platform_spec": {}
}

Only output the JSON array, no explanation.`;

  const raw = await callAI({
    model: AI_MODELS.PLATFORM_INTELLIGENCE,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    route: "content-queue/generate",
    maxTokens: 3000,
    timeoutMs: 60000,
  });

  // Parse the JSON response
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Platform Intelligence Agent did not return valid JSON array");
  }

  const variants: PlatformVariant[] = JSON.parse(jsonMatch[0]);
  return variants;
}

/**
 * Audit a content variant using Llama 4 Scout via Groq.
 * Returns { passed: boolean, notes: string }.
 */
export async function auditVariant(
  variant: PlatformVariant,
): Promise<{ passed: boolean; notes: string }> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return { passed: true, notes: "Audit skipped: no GROQ_API_KEY" };

  const prompt = `You are a brand voice auditor. Score this content 1-10 on brand voice consistency.

Brand voice rules: Direct, specific, lowercase preferred, no clichés, no corporate speak, authentic.

Platform: ${variant.platform}
Content: ${variant.body}
${variant.caption ? `Caption: ${variant.caption}` : ""}

Respond with JSON: {"score": 7, "passed": true, "notes": "brief feedback"}
Score >= 6 passes. Only output JSON.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: AI_MODELS.AUDIT,
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return { passed: true, notes: "Audit API error — defaulting to pass" };

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { passed: true, notes: "Audit response not parseable" };

    const result = JSON.parse(jsonMatch[0]);
    return {
      passed: result.passed ?? result.score >= 6,
      notes: result.notes ?? "",
    };
  } catch {
    return { passed: true, notes: "Audit failed — defaulting to pass" };
  }
}
