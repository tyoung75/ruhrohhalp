import Anthropic from "@anthropic-ai/sdk";
import { BLOG_SYSTEM_PROMPT, buildBlogUserPrompt } from "@/lib/blog/prompts";
import type { BlogPost, StylePattern, WeeklyActivity } from "@/lib/blog/types";

function fallbackPost(activity: WeeklyActivity): BlogPost {
  const date = new Date(activity.weekStartIso).toISOString().slice(0, 10);
  return {
    title: `Here's What We Built — Week of ${date}`,
    slug: `weekly-build-${date}`,
    teaser: "A quick look at what we shipped this week.",
    metaDescription: "Weekly build log covering shipped updates and product progress.",
    tags: ["weekly build log", "product development", "shipping"],
    markdown: `## Here's What We Built\n\nThis week we shipped updates across our products and internal systems.\n\n### Highlights\n${activity.items
      .slice(0, 8)
      .map((item) => `- ${item.title}`)
      .join("\n")}\n\n### What's next\n- Keep tightening the feedback loop and ship the next tranche of improvements.`,
  };
}

export async function generateBlogPost(activity: WeeklyActivity, styleMemory: StylePattern[]): Promise<BlogPost> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackPost(activity);

  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 3000,
    system: BLOG_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildBlogUserPrompt(activity, styleMemory) }],
  });

  const text = message.content
    .filter((c: { type: string }) => c.type === "text")
    .map((c: { type: string; text: string }) => c.text)
    .join("\n")
    .trim();

  try {
    const parsed = JSON.parse(text) as BlogPost;
    if (!parsed?.markdown || !parsed?.title) throw new Error("Invalid blog payload");
    return parsed;
  } catch {
    return fallbackPost(activity);
  }
}
