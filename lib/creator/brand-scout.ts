import { z } from "zod";
import { AI_MODELS } from "@/lib/ai-config";
import { logError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_MODEL = "o4-mini";
const CLAUDE_MODEL = AI_MODELS.PRIMARY;
const VALIDATION_DATE = new Date().toISOString().slice(0, 10);

const DEFAULT_HANDLES: Record<string, string> = {
  threads: "t_.young",
  instagram: "t_.young",
  tiktok: "tyler_.young",
  youtube: "Tyler Young",
};

const sourceSchema = z.object({
  url: z.string().min(1),
  title: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

const opportunitySchema = z.object({
  brand: z.string().min(1),
  category: z.string().min(1),
  why_match: z.string().min(1),
  partnership_evidence: z.string().min(1),
  recommended_angle: z.string().min(1),
  deal_likelihood_score: z.coerce.number().min(0).max(100),
  creator_fit_score: z.coerce.number().min(0).max(100),
  contact_method_type: z.string().min(1),
  contact_method_value: z.string().min(1),
  contact_method_url: z.string().url(),
  contact_validation_note: z.string().min(1),
  sources: z.array(sourceSchema).min(1).max(6).optional(),
});

const providerPayloadSchema = z.object({
  results: z.array(opportunitySchema).min(1).max(3),
});

type Provider = "chatgpt" | "claude";
export type BrandScoutMode = "scout" | "pipeline";

export interface CreatorAudienceSnapshot {
  platform: string;
  handle: string | null;
  followers: number;
  engagementRate: number | null;
  avgImpressionsPerPost: number | null;
}

export interface CreatorBrandProfile {
  creatorName: string;
  creatorTier: string;
  totalFollowers: number;
  platforms: CreatorAudienceSnapshot[];
  niches: string[];
  positioning: string;
}

export interface BrandScoutSource {
  url: string;
  title?: string;
  note?: string;
}

export interface BrandScoutOpportunity {
  id: string;
  brand: string;
  category: string;
  whyMatch: string;
  partnershipEvidence: string;
  recommendedAngle: string;
  dealLikelihoodScore: number;
  creatorFitScore: number;
  contactMethodType: string;
  contactMethodValue: string;
  contactMethodUrl: string;
  contactValidated: boolean;
  validationNote: string;
  sources: BrandScoutSource[];
  providers: Provider[];
}

export interface ScoutProviderResponse {
  provider: Provider;
  model: string;
  searched: boolean;
  results: BrandScoutOpportunity[];
  error?: string;
}

export interface BrandScoutResponse {
  mode: BrandScoutMode;
  searchedAt: string;
  profile: CreatorBrandProfile;
  scout: {
    chatgpt: ScoutProviderResponse;
    claude: ScoutProviderResponse;
  };
  combinedTop: BrandScoutOpportunity[];
}

const SHARED_SCOUT_SYSTEM = `You are a creator sponsorship scout.

You MUST use live web search before answering.

Your job is to find realistic brand partnership targets for Tyler Young, then return JSON only.

Selection rules:
- Prefer brands that already run ambassador, creator, affiliate, or influencer programs.
- Prefer brands aligned to running, endurance, fitness, travel, NYC lifestyle, and build-in-public founder content.
- Prioritize realistic near-term deal likelihood over prestige. A realistic micro-creator deal beats an aspirational mega-brand.
- Only include a brand if there is a public, validated contact path for creator partnerships: creator program page, affiliate page, ambassador application, influencer intake form, partnerships email shown on a public page, or a public PR/contact page clearly tied to brand partnerships.
- Do not invent emails, contact names, or URLs.
- Exclude brands if the only contact path is vague, stale, or obviously unrelated.
- Keep results current and grounded in what is public on the web right now.

Return ONLY valid JSON in this shape:
{
  "results": [
    {
      "brand": "string",
      "category": "string",
      "why_match": "string",
      "partnership_evidence": "string",
      "recommended_angle": "string",
      "deal_likelihood_score": 0,
      "creator_fit_score": 0,
      "contact_method_type": "string",
      "contact_method_value": "string",
      "contact_method_url": "https://example.com",
      "contact_validation_note": "string",
      "sources": [
        {
          "url": "https://example.com",
          "title": "string",
          "note": "string"
        }
      ]
    }
  ]
}`;

export async function runBrandScoutPipeline(
  userId: string,
  mode: BrandScoutMode,
): Promise<BrandScoutResponse> {
  const profile = await loadCreatorBrandProfile(userId);

  const [chatgptSettled, claudeSettled] = await Promise.allSettled([
    runOpenAIScout(profile, mode),
    runClaudeScout(profile, mode),
  ]);

  const chatgpt = settleProviderResult("chatgpt", OPENAI_MODEL, chatgptSettled);
  const claude = settleProviderResult("claude", CLAUDE_MODEL, claudeSettled);

  const combinedTop = buildCombinedTop([
    ...chatgpt.results,
    ...claude.results,
  ]);

  return {
    mode,
    searchedAt: new Date().toISOString(),
    profile,
    scout: { chatgpt, claude },
    combinedTop,
  };
}

async function loadCreatorBrandProfile(userId: string): Promise<CreatorBrandProfile> {
  const supabase = createAdminClient();

  const [tokensRes, snapshotsRes] = await Promise.all([
    supabase
      .from("platform_tokens")
      .select("platform, platform_username")
      .eq("user_id", userId),
    supabase
      .from("follower_snapshots")
      .select("platform, followers, engagement_rate, avg_impressions_per_post, fetched_at")
      .eq("user_id", userId)
      .order("fetched_at", { ascending: false })
      .limit(40),
  ]);

  const handles = new Map<string, string>();
  for (const token of tokensRes.data ?? []) {
    if (token.platform && token.platform_username) {
      handles.set(token.platform, token.platform_username);
    }
  }

  const latestByPlatform = new Map<string, CreatorAudienceSnapshot>();
  for (const row of snapshotsRes.data ?? []) {
    if (latestByPlatform.has(row.platform)) continue;
    latestByPlatform.set(row.platform, {
      platform: row.platform,
      handle: handles.get(row.platform) ?? DEFAULT_HANDLES[row.platform] ?? null,
      followers: row.followers ?? 0,
      engagementRate: row.engagement_rate ?? null,
      avgImpressionsPerPost: row.avg_impressions_per_post ?? null,
    });
  }

  for (const [platform, handle] of Object.entries(DEFAULT_HANDLES)) {
    if (!latestByPlatform.has(platform)) {
      latestByPlatform.set(platform, {
        platform,
        handle: handles.get(platform) ?? handle,
        followers: 0,
        engagementRate: null,
        avgImpressionsPerPost: null,
      });
    }
  }

  const platforms = [...latestByPlatform.values()]
    .sort((a, b) => b.followers - a.followers)
    .filter((item) => item.followers > 0 || item.handle);

  const totalFollowers = platforms.reduce((sum, platform) => sum + platform.followers, 0);

  return {
    creatorName: "Tyler Young",
    creatorTier: inferCreatorTier(totalFollowers),
    totalFollowers,
    platforms,
    niches: [
      "running and endurance",
      "fitness and strength",
      "travel and food",
      "NYC lifestyle",
      "building in public",
    ],
    positioning:
      "NYC-based runner, builder, and lifestyle creator documenting training, software, travel, and everyday city life with a positive, high-trust tone.",
  };
}

function inferCreatorTier(totalFollowers: number): string {
  if (totalFollowers >= 250_000) return "mid-size creator";
  if (totalFollowers >= 50_000) return "micro-to-mid creator";
  if (totalFollowers >= 10_000) return "micro creator";
  if (totalFollowers >= 2_000) return "emerging micro creator";
  return "early-stage creator";
}

function buildScoutPrompt(profile: CreatorBrandProfile, mode: BrandScoutMode): string {
  const platformLines = profile.platforms.map((platform) => {
    const metrics = [
      `${platform.platform} ${platform.handle ? `@${platform.handle}` : ""}`.trim(),
      `${platform.followers.toLocaleString()} followers`,
      platform.engagementRate != null
        ? `${(platform.engagementRate * 100).toFixed(1)}% engagement`
        : null,
      platform.avgImpressionsPerPost != null
        ? `${Math.round(platform.avgImpressionsPerPost).toLocaleString()} avg impressions/post`
        : null,
    ].filter(Boolean);
    return `- ${metrics.join(" | ")}`;
  });

  const modeInstruction =
    mode === "pipeline"
      ? "Bias aggressively toward brands that are most likely to close soon for a creator of this size, niche, and credibility."
      : "Surface the strongest realistic sponsor targets, not broad aspirational lists.";

  return `Creator profile:
- Name: ${profile.creatorName}
- Positioning: ${profile.positioning}
- Creator tier: ${profile.creatorTier}
- Total follower footprint: ${profile.totalFollowers.toLocaleString()}
- Niches: ${profile.niches.join(", ")}

Platform snapshot:
${platformLines.join("\n")}

Task:
Find exactly 3 brands that are the best partnership targets right now.
${modeInstruction}

Scoring guidance:
- deal_likelihood_score: how likely this brand is to say yes soon based on creator-program evidence, ambassador history, affiliate openness, and fit for Tyler's current size.
- creator_fit_score: how tightly the brand fits Tyler's audience, content pillars, and public persona.

Contact rules:
- The contact_method_url must be a public page that directly shows or leads to the partnership method.
- The contact_method_value can be an email, application CTA, or the exact name of the partnership path shown publicly.
- The contact_validation_note should briefly say why the method is credible.

Return JSON only.`;
}

async function runOpenAIScout(
  profile: CreatorBrandProfile,
  mode: BrandScoutMode,
): Promise<{ searched: boolean; results: BrandScoutOpportunity[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: SHARED_SCOUT_SYSTEM,
      max_output_tokens: 2200,
      tools: [
        {
          type: "web_search",
          user_location: {
            type: "approximate",
            country: "US",
            city: "New York",
            region: "New York",
          },
        },
      ],
      input: buildScoutPrompt(profile, mode),
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `OpenAI scout failed (${res.status})`);
  }

  const text = extractOpenAIText(data);
  const searched = JSON.stringify(data.output ?? []).includes("web_search");
  const fallbackSources = extractOpenAISources(data);
  const parsed = parseProviderResults(text, "chatgpt", fallbackSources);
  const validated = await validateOpportunities(parsed, "chatgpt");

  return { searched, results: validated };
}

async function runClaudeScout(
  profile: CreatorBrandProfile,
  mode: BrandScoutMode,
): Promise<{ searched: boolean; results: BrandScoutOpportunity[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2200,
      system: SHARED_SCOUT_SYSTEM,
      messages: [{ role: "user", content: buildScoutPrompt(profile, mode) }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
          user_location: {
            type: "approximate",
            country: "US",
            city: "New York",
            region: "New York",
            timezone: "America/New_York",
          },
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Claude scout failed (${res.status})`);
  }

  const text = extractClaudeText(data);
  const searched = JSON.stringify(data.content ?? []).includes("web_search");
  const parsed = parseProviderResults(text, "claude");
  const validated = await validateOpportunities(parsed, "claude");

  return { searched, results: validated };
}

function extractOpenAIText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const output = (data as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }).output;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      if (item.type !== "message" || !Array.isArray(item.content)) return [];
      return item.content
        .filter((content) => content.type === "output_text" && typeof content.text === "string")
        .map((content) => content.text as string);
    })
    .join("\n")
    .trim();
}

function extractClaudeText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const content = (data as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();
}

function parseProviderResults(
  text: string,
  provider: Provider,
  fallbackSources: BrandScoutSource[] = [],
): BrandScoutOpportunity[] {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`${provider} did not return JSON`);
  }

  const parsed = providerPayloadSchema.parse(JSON.parse(jsonMatch[0]));

  return parsed.results.map((result) => ({
    id: `${provider}:${slugify(result.brand)}`,
    brand: result.brand,
    category: result.category,
    whyMatch: result.why_match,
    partnershipEvidence: result.partnership_evidence,
    recommendedAngle: result.recommended_angle,
    dealLikelihoodScore: result.deal_likelihood_score,
    creatorFitScore: result.creator_fit_score,
    contactMethodType: result.contact_method_type,
    contactMethodValue: result.contact_method_value,
    contactMethodUrl: result.contact_method_url,
    contactValidated: false,
    validationNote: result.contact_validation_note,
    sources: dedupeSources([...(result.sources ?? []).filter(isUrlLikeSource), ...fallbackSources]),
    providers: [provider],
  }));
}

function extractOpenAISources(data: unknown): BrandScoutSource[] {
  if (!data || typeof data !== "object") return [];
  const output = (data as { output?: Array<{ type?: string; action?: { url?: string; query?: string; queries?: string[] } }> }).output;
  if (!Array.isArray(output)) return [];

  const sources: BrandScoutSource[] = [];

  for (const item of output) {
    if (item.type !== "web_search_call" || !item.action) continue;

    if (item.action.url && isProbablyUrl(item.action.url)) {
      sources.push({ url: item.action.url, note: `OpenAI web search call on ${VALIDATION_DATE}` });
    }
  }

  return dedupeSources(sources);
}

async function validateOpportunities(
  results: BrandScoutOpportunity[],
  provider: Provider,
): Promise<BrandScoutOpportunity[]> {
  const validated = await Promise.all(
    results.map(async (result) => {
      const reachable = await isPublicUrlReachable(result.contactMethodUrl);
      if (!reachable) {
        return {
          ...result,
          contactValidated: false,
          validationNote: `Public contact path could not be confirmed live on ${VALIDATION_DATE}. ${result.validationNote}`,
        };
      }

      return {
        ...result,
        contactValidated: true,
        validationNote: `Validated live on ${VALIDATION_DATE}. ${result.validationNote}`,
      };
    }),
  );

  return validated
    .filter((result) => result.contactValidated)
    .sort((a, b) => combinedScore(b) - combinedScore(a))
    .slice(0, 3)
    .map((result) => ({ ...result, providers: [provider] }));
}

function settleProviderResult(
  provider: Provider,
  model: string,
  settled: PromiseSettledResult<{ searched: boolean; results: BrandScoutOpportunity[] }>,
): ScoutProviderResponse {
  if (settled.status === "rejected") {
    logError(`brand-scout.${provider}`, settled.reason);
    return {
      provider,
      model,
      searched: false,
      results: [],
      error: settled.reason instanceof Error ? settled.reason.message : "Scout failed",
    };
  }

  return {
    provider,
    model,
    searched: settled.value.searched,
    results: settled.value.results,
  };
}

function buildCombinedTop(results: BrandScoutOpportunity[]): BrandScoutOpportunity[] {
  const deduped = new Map<string, BrandScoutOpportunity>();

  for (const result of results) {
    if (!result.contactValidated) continue;

    const key = normalizeBrand(result.brand);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, {
        ...result,
        sources: dedupeSources(result.sources),
      });
      continue;
    }

    deduped.set(key, {
      ...existing,
      category: existing.category.length >= result.category.length ? existing.category : result.category,
      whyMatch: existing.whyMatch.length >= result.whyMatch.length ? existing.whyMatch : result.whyMatch,
      partnershipEvidence:
        existing.partnershipEvidence.length >= result.partnershipEvidence.length
          ? existing.partnershipEvidence
          : result.partnershipEvidence,
      recommendedAngle:
        existing.recommendedAngle.length >= result.recommendedAngle.length
          ? existing.recommendedAngle
          : result.recommendedAngle,
      dealLikelihoodScore: Math.max(existing.dealLikelihoodScore, result.dealLikelihoodScore),
      creatorFitScore: Math.max(existing.creatorFitScore, result.creatorFitScore),
      validationNote:
        existing.validationNote.length >= result.validationNote.length
          ? existing.validationNote
          : result.validationNote,
      sources: dedupeSources([...existing.sources, ...result.sources]),
      providers: [...new Set([...existing.providers, ...result.providers])],
    });
  }

  return [...deduped.values()]
    .sort((a, b) => combinedScore(b) - combinedScore(a))
    .slice(0, 3);
}

function combinedScore(result: BrandScoutOpportunity): number {
  const providerBonus = result.providers.length > 1 ? 8 : 0;
  const validationBonus = result.contactValidated ? 5 : -50;
  return result.dealLikelihoodScore * 0.65 + result.creatorFitScore * 0.35 + providerBonus + validationBonus;
}

async function isPublicUrlReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ruhrohhalp-brand-scout/1.0)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function dedupeSources(sources: BrandScoutSource[]): BrandScoutSource[] {
  const seen = new Set<string>();
  const output: BrandScoutSource[] = [];

  for (const source of sources) {
    if (!source.url || seen.has(source.url)) continue;
    seen.add(source.url);
    output.push(source);
  }

  return output.slice(0, 5);
}

function isUrlLikeSource(source: BrandScoutSource): boolean {
  return isProbablyUrl(source.url);
}

function isProbablyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeBrand(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
