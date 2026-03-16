/**
 * Shared project slug → project_id resolution.
 *
 * Tyler's ventures use known slugs. Processors call resolveProjectId()
 * to look up the Supabase UUID from a slug or keyword.
 */

import { createAdminClient } from "@/lib/supabase/admin";

/** Known project slug aliases. Keys are lowercased for matching. */
const PROJECT_ALIASES: Record<string, string> = {
  motus: "motus",
  "ruhroh": "ruhrohhalp",
  ruhrohhalp: "ruhrohhalp",
  rntlx: "ruhrohhalp",
  "iron passport": "iron-passport",
  ironpassport: "iron-passport",
  caliber: "caliber",
  thestayed: "thestayed",
  stayed: "thestayed",
  personal: "personal",
};

/**
 * Resolve a slug/keyword to a Supabase project UUID.
 * Returns undefined if no match found.
 */
export async function resolveProjectId(userId: string, slugOrKeyword: string): Promise<string | undefined> {
  const normalized = slugOrKeyword.toLowerCase().trim();
  const slug = PROJECT_ALIASES[normalized] ?? normalized;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", slug)
    .maybeSingle();

  return data?.id ?? undefined;
}

/**
 * Try to detect a project from free-form text by scanning for known venture keywords.
 * Returns the matched slug or undefined.
 */
export function detectProjectSlug(text: string): string | undefined {
  const lower = text.toLowerCase();
  const keywords: [string, string][] = [
    ["motus", "motus"],
    ["ruhrohhalp", "ruhrohhalp"],
    ["rntlx", "ruhrohhalp"],
    ["iron passport", "iron-passport"],
    ["ironpassport", "iron-passport"],
    ["caliber", "caliber"],
    ["thestayed", "thestayed"],
    ["the stayed", "thestayed"],
  ];

  for (const [keyword, slug] of keywords) {
    if (lower.includes(keyword)) return slug;
  }
  return undefined;
}
