/**
 * System Intelligence Module
 *
 * Provides a shared "reflect and improve" capability that any cron job or
 * scheduled task can call. Queries semantic memory for recent feedback,
 * decisions, and signals, then asks Claude to identify patterns and suggest
 * system improvements.
 *
 * This is the compounding intelligence layer — every feedback input
 * (content, brand, task, goal) flows through embedAndStore with unified tags,
 * and this module surfaces cross-domain patterns back to the system.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { callClaude } from "@/lib/processors/claude";
import { logError } from "@/lib/logger";

const TYLER_USER_ID = "e3657b64-9c95-4d9a-ad12-304cf8e2f21e";

/**
 * Unified tag taxonomy for all feedback across the system.
 * Any module that calls embedAndStore should use these tag prefixes
 * so memories are discoverable across domains.
 */
export const FEEDBACK_TAGS = {
  // Content feedback (creator tab)
  contentLiked: "feedback:liked",
  contentDisliked: "feedback:disliked",
  contentCorrection: "feedback:correction",
  contentDirective: "feedback:directive",
  // Brand feedback
  brandLiked: "feedback:liked",
  brandDisliked: "feedback:disliked",
  brandCorrection: "feedback:correction",
  brandDirective: "feedback:directive",
  // Domain tags (always include one)
  domainContent: "domain:content",
  domainBrand: "domain:brand",
  domainTask: "domain:task",
  domainGoal: "domain:goal",
  // System-wide
  systemLearning: "system:learning",
  systemFeedback: "system:feedback",
} as const;

/**
 * Gather recent feedback and signals across all domains for a system
 * intelligence reflection. Used by cron jobs to include a "what should
 * the system learn from recent activity" step.
 */
export async function gatherIntelligenceContext(userId: string = TYLER_USER_ID): Promise<string> {
  const supabase = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [contentFb, brandFb, recentMemories, dismissals] = await Promise.all([
    // Content feedback (last 7 days)
    supabase
      .from("content_feedback")
      .select("feedback_type, content, context, created_at")
      .eq("user_id", userId)
      .eq("active", true)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),
    // Brand feedback (last 7 days) — graceful if table doesn't exist
    supabase
      .from("brand_outreach_feedback")
      .select("feedback_type, content, context, created_at")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20),
    // Recent high-importance memories (system learnings)
    supabase
      .from("memories")
      .select("content, tags, importance, source, created_at")
      .eq("user_id", userId)
      .gte("importance", 7)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(15),
    // Signal dismissals (things Tyler explicitly rejected)
    supabase
      .from("signal_dismissals")
      .select("reason, scope, signal_content, created_at")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const parts: string[] = [];

  if (contentFb.data?.length) {
    const lines = contentFb.data.map((f) => `- [${f.feedback_type}] ${f.content}`);
    parts.push(`## Content Feedback (${contentFb.data.length} items)\n${lines.join("\n")}`);
  }

  if (brandFb.data?.length) {
    const lines = brandFb.data.map((f) => `- [${f.feedback_type}] ${f.content}`);
    parts.push(`## Brand Outreach Feedback (${brandFb.data.length} items)\n${lines.join("\n")}`);
  }

  if (recentMemories.data?.length) {
    const lines = recentMemories.data.map((m) => `- [${m.source}, importance=${m.importance}] ${(m.content as string).slice(0, 150)}`);
    parts.push(`## High-Importance Memories (${recentMemories.data.length} items)\n${lines.join("\n")}`);
  }

  if (dismissals.data?.length) {
    const lines = dismissals.data.map((d) => `- [${d.scope}] ${d.reason}: ${(d.signal_content as string)?.slice(0, 100) ?? ""}`);
    parts.push(`## Dismissed Signals (${dismissals.data.length} items)\n${lines.join("\n")}`);
  }

  return parts.join("\n\n") || "(No recent feedback or signals found.)";
}

/**
 * Generate a system intelligence reflection. Call this at the end of any
 * cron job to produce insights about how the system should evolve.
 *
 * Returns a brief analysis that can be:
 * 1. Included in briefing output
 * 2. Stored as a high-importance memory for future retrieval
 * 3. Used to update strategy or behavior
 */
export async function reflectAndImprove(
  jobContext: string,
  intelligenceContext: string,
): Promise<string | null> {
  if (intelligenceContext.includes("No recent feedback")) return null;

  try {
    const reflection = await callClaude(
      `You are the intelligence layer for Tyler Young's personal OS. Your job is to identify patterns in Tyler's feedback, decisions, and signals, and recommend specific system improvements.

Be concise (3-5 bullet points). Focus on actionable patterns, not obvious observations.`,
      `A scheduled job just ran: ${jobContext}

Here is the recent feedback and signal context across all domains:

${intelligenceContext}

Based on this, what patterns do you see? What should the system learn, remember, or adjust? Think about:
1. Voice/tone preferences Tyler is expressing
2. Brand/content types Tyler gravitates toward or rejects
3. Timing or scheduling patterns
4. Cross-domain connections (e.g., training data informing brand outreach)
5. Blind spots the system might have`,
      512,
    );

    return reflection;
  } catch (error) {
    logError("intelligence.reflect", error);
    return null;
  }
}
