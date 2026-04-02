import type { BrandDeal, BrandOutreachEmail } from "@/lib/types/brands";

export const TYLER_STATS = {
  social: {
    tiktok: { handle: "@tyler_.young", followers: "5,984", likes: "500.6K", top_video_views: "2.3M", last_confirmed: "2026-03" },
    instagram: { handle: "@t_.young", followers: "1,070", monthly_views: "33.7K", last_confirmed: "2026-03" },
    threads: { handle: "@t_.young", followers: "289", monthly_views: "402K", last_confirmed: "2026-03" },
  },
  athletic: {
    austin_marathon: "3:23:02 (February 2026)",
    berlin_marathon: "September 2026 (training)",
    deadlift: "455lb",
    squat: "395lb",
    vo2_max: "53.8",
  },
  business: {
    app: "Motus ($24.99/month fitness app)",
    role: "Director at a marketplace tech company",
  },
} as const;

export const BRAND_VOICE_SYSTEM_PROMPT = `You draft partnership outreach emails for Tyler Young.

Voice and style rules:
- Tone: warm, direct, honest. Sound like a real person, never a pitch deck.
- Structure should follow: (1) who Tyler is + honest reason for writing, (2) actual relationship with the brand/product, (3) what he is building and his audience context woven naturally, (4) a simple ask.
- Use standard capitalization. Keep to 3-4 short paragraphs.
- Subject format must be: [Brand] x Tyler Young — [specific angle]
- Every email must feel custom-tailored, never like a reusable template.
- NEVER use these phrases: "This isn't a cold pitch", "genuinely", "honestly", "straightforward", "[Brand] is the only brand that..."
- Never end with inspirational closer lines.
- Weave stats naturally in context; do not dump a stat block in email body.
- Say "marketplace tech company", never company names.
- Audience phrase should be "people who train and live the same way".
- Use past tense for past events.
- Prefer freshest available stats.

Output format:
SUBJECT: <subject line>
BODY:
<email body text only>`;

export function formatStatsBlock(stats: typeof TYLER_STATS): string {
  return [
    `TikTok (${stats.social.tiktok.handle}): ${stats.social.tiktok.followers} followers, ${stats.social.tiktok.likes} likes, top video ${stats.social.tiktok.top_video_views} (${stats.social.tiktok.last_confirmed})`,
    `Instagram (${stats.social.instagram.handle}): ${stats.social.instagram.followers} followers, ${stats.social.instagram.monthly_views} monthly views (${stats.social.instagram.last_confirmed})`,
    `Threads (${stats.social.threads.handle}): ${stats.social.threads.followers} followers, ${stats.social.threads.monthly_views} monthly views (${stats.social.threads.last_confirmed})`,
    `Austin Marathon: ${stats.athletic.austin_marathon}`,
    `Berlin Marathon: ${stats.athletic.berlin_marathon}`,
    `Strength: Deadlift ${stats.athletic.deadlift}, Squat ${stats.athletic.squat}, VO2 max ${stats.athletic.vo2_max}`,
    `Product: ${stats.business.app}`,
    `Role: ${stats.business.role}`,
  ].join("\n");
}

export function buildInitialOutreachPrompt(brand: BrandDeal, stats: typeof TYLER_STATS): string {
  return `Draft an INITIAL brand partnership outreach email for ${brand.brand_name}.

Brand context:
- Brand: ${brand.brand_name}
- Contact name: ${brand.contact_name ?? "unknown"}
- Contact email: ${brand.contact_email ?? "unknown"}
- Relationship notes: ${brand.relationship_notes ?? "none"}
- Product usage: ${brand.product_usage ?? "none"}
- Angle: ${brand.angle ?? "none"}
- Phrases to avoid for this brand: ${brand.dont_say.length ? brand.dont_say.join(" | ") : "none"}

Tyler stats/context:
${formatStatsBlock(stats)}

Create a high-quality tailored initial outreach email.`;
}

export function buildFollowUpPrompt(
  brand: BrandDeal,
  originalEmail: BrandOutreachEmail,
  followUpNumber: 1 | 2,
  stats: typeof TYLER_STATS,
): string {
  return `Draft FOLLOW-UP #${followUpNumber} email for ${brand.brand_name}.

Original email context:
- Sent date: ${new Date(originalEmail.sent_at).toISOString().slice(0, 10)}
- Subject: ${originalEmail.subject ?? "unknown"}
- Summary: ${originalEmail.summary ?? "none"}

Brand context:
- Relationship notes: ${brand.relationship_notes ?? "none"}
- Product usage: ${brand.product_usage ?? "none"}
- Angle: ${brand.angle ?? "none"}
- Avoid: ${brand.dont_say.length ? brand.dont_say.join(" | ") : "none"}

Tyler stats/context:
${formatStatsBlock(stats)}

Follow-up rules:
- 1-2 short paragraphs only
- Reference the original outreach date/angle
- Add one NEW hook
- Keep ask simple.`;
}
