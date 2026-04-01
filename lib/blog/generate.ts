import Anthropic from "@anthropic-ai/sdk";
import { BLOG_SYSTEM_PROMPT, buildBlogUserPrompt } from "@/lib/blog/prompts";
import type { BlogPost, StylePattern, WeeklyActivity } from "@/lib/blog/types";

function fallbackPost(activity: WeeklyActivity): BlogPost {
  const date = new Date(activity.weekStartIso).toISOString().slice(0, 10);

  const byProject = new Map<string, typeof activity.items>();
  for (const item of activity.items.slice(0, 20)) {
    const key = item.project;
    const list = byProject.get(key) ?? [];
    list.push(item);
    byProject.set(key, list);
  }

  const projectNames: Record<string, string> = { motus: "Motus", thestayed: "The Stayed", bdhe: "BDHE", other: "Other" };
  let sections = "";
  for (const [project, items] of byProject.entries()) {
    sections += `\n## ${projectNames[project] ?? project}\n\n`;
    for (const item of items.slice(0, 6)) {
      sections += `- **${item.title}**${item.summary !== item.title ? ` — ${item.summary}` : ""}\n`;
    }
  }

  return {
    title: `Week of ${date} — Build Log`,
    slug: `week-of-${date}`,
    teaser: `${activity.stats.taskCount} tasks completed and ${activity.stats.commitCount} commits shipped this week.`,
    metaDescription: `Weekly build log for the week of ${date}. ${activity.stats.taskCount} tasks shipped across multiple projects.`,
    tags: ["weekly build log", "product development", "indie hacker", "shipping"],
    markdown: `# Week of ${date} — Build Log\n\nBusy week — ${activity.stats.taskCount} tasks completed and ${activity.stats.commitCount} commits pushed across ${byProject.size} project${byProject.size === 1 ? "" : "s"}.\n${sections}\n## What's Next\n\nMore to come next week. Stay tuned.`,
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

  const raw = message.content
    .filter((c: Record<string, unknown>) => c.type === "text")
    .map((c: Record<string, unknown>) => c.text as string)
    .join("\n")
    .trim();

  // Strip markdown code fences if the model wraps JSON in ```json ... ```
  const text = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(text) as BlogPost;
    if (!parsed?.markdown || !parsed?.title) throw new Error("Invalid blog payload");
    return parsed;
  } catch (err) {
    console.error("[weekly-dev-log] Failed to parse blog JSON:", err, "\nRaw response:", raw.slice(0, 500));
    return fallbackPost(activity);
  }
}
