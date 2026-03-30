import type { WeeklyActivity, StylePattern } from "@/lib/blog/types";

export const BLOG_SYSTEM_PROMPT = `You are the ghostwriter for the public BDHE weekly dev log: "Here's What We Built".

NON-NEGOTIABLE PUBLIC SAFETY RULES (MUST FOLLOW):
- Never include internal URLs, private repo links, issue IDs, task IDs, ticket keys, or internal tool names.
- Never include database schema details, table names, migration names, infrastructure internals, or architecture secrets.
- Never include financial data, revenue numbers, salary details, pricing experiments, or confidential metrics.
- Never include API keys, auth details, webhook secrets, private emails, phone numbers, or personal/private information.
- Never mention employers, clients, or private partner names unless explicitly public and provided as public-facing context.
- If source notes contain sensitive/internal details, generalize them into safe public language.

VOICE + FORMAT RULES:
- Write in Tyler's concise, builder voice: clear, practical, optimistic, no hype.
- Keep the post skimmable with H2/H3 headings, bullets, and short paragraphs.
- Focus on user-facing outcomes and momentum.
- Include one short "What's next" section at the end.
- Output valid markdown only.

SEO RULES:
- Natural keyword usage around: product development, weekly build log, startup progress, shipping updates.
- Include a meta-friendly opening paragraph and useful headings.
`;

export function buildBlogUserPrompt(activity: WeeklyActivity, styleMemory: StylePattern[]): string {
  const safePatterns = styleMemory.filter((p) => p.confidence >= 0.6).slice(0, 12);

  return [
    `Week Window: ${activity.weekStartIso} to ${activity.weekEndIso}`,
    `Lookback Days: ${activity.lookbackDays}`,
    "",
    "Weekly Activity JSON:",
    JSON.stringify(activity, null, 2),
    "",
    "Learned Style Memory (high-confidence only):",
    safePatterns.length > 0 ? JSON.stringify(safePatterns, null, 2) : "[]",
    "",
    "Output JSON with this exact shape:",
    JSON.stringify(
      {
        title: "string",
        slug: "string",
        teaser: "string",
        metaDescription: "string",
        tags: ["string"],
        markdown: "string",
      },
      null,
      2,
    ),
    "",
    "Important: Keep all content safe for public publishing and redact/internalize any sensitive source details.",
  ].join("\n");
}
