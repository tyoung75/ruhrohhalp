import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StylePattern } from "@/lib/blog/types";

function diffSummary(originalMd: string, editedMd: string): string {
  if (originalMd === editedMd) return "No edits.";
  const originalLines = originalMd.split("\n").length;
  const editedLines = editedMd.split("\n").length;
  return `Edited from ${originalLines} lines to ${editedLines} lines.`;
}

async function extractPatterns(originalMd: string, editedMd: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const anthropic = new Anthropic({ apiKey });
  const result = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 600,
    system:
      "Extract reusable writing-style patterns from edits. Return JSON array of short pattern strings. No prose.",
    messages: [
      {
        role: "user",
        content: `Original:\n${originalMd}\n\nEdited:\n${editedMd}`,
      },
    ],
  });

  const text = result.content.filter((c: Record<string, unknown>) => c.type === "text").map((c: Record<string, unknown>) => c.text as string).join("\n");
  try {
    const parsed = JSON.parse(text) as string[];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

export async function loadStyleMemory(): Promise<StylePattern[]> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("blog_style_memory").select("patterns").eq("id", true).maybeSingle();
  return ((data?.patterns as StylePattern[] | null) ?? []).filter(Boolean);
}

export async function recordEditLearning(draftId: string, originalMd: string, editedMd: string): Promise<void> {
  const supabase = createAdminClient();
  const existing = await loadStyleMemory();
  const extracted = await extractPatterns(originalMd, editedMd);

  const now = new Date();
  const eightWeeksAgo = new Date(now);
  eightWeeksAgo.setUTCDate(now.getUTCDate() - 56);

  const merged = new Map(existing.map((p) => [p.pattern, p]));
  for (const pattern of extracted) {
    const prev = merged.get(pattern);
    if (prev) {
      prev.confidence = Math.min(1, prev.confidence + 0.15);
      prev.reinforcedCount += 1;
      prev.lastSeenAt = now.toISOString();
    } else {
      merged.set(pattern, {
        pattern,
        confidence: 0.3,
        reinforcedCount: 1,
        lastSeenAt: now.toISOString(),
      });
    }
  }

  for (const value of merged.values()) {
    if (new Date(value.lastSeenAt) < eightWeeksAgo) {
      value.confidence = Math.max(0.1, value.confidence - 0.15);
    }
  }

  const updatedPatterns = Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence).slice(0, 40);

  await supabase.from("blog_edit_log").insert({
    draft_id: draftId,
    original_markdown: originalMd,
    edited_markdown: editedMd,
    diff_summary: diffSummary(originalMd, editedMd),
    extracted_patterns: extracted,
  });

  await supabase.from("blog_style_memory").upsert({
    id: true,
    patterns: updatedPatterns,
    last_updated_at: now.toISOString(),
    updated_from_draft_id: draftId,
  });
}
