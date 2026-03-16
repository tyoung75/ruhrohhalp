/**
 * TYOS-281 — Whisper transcript processor.
 *
 * - Cleans up transcript (filler words, formatting).
 * - Detects project context from content.
 * - Determines if content sounds like an idea vs a note → sets asIdea.
 */

import type { EmbedMetadata } from "@/lib/embedding/pipeline";
import { detectProjectSlug, resolveProjectId } from "@/lib/processors/projects";

// ---------------------------------------------------------------------------
// Filler word removal
// ---------------------------------------------------------------------------

const FILLER_PATTERNS = [
  /\b(um+|uh+|er+|ah+|hmm+|hm+|mhm+)\b/gi,
  /\b(like,?\s+){2,}/gi,               // repeated "like, like"
  /\b(you know,?\s*){2,}/gi,           // repeated "you know"
  /\b(so,?\s+){2,}/gi,                 // repeated "so, so"
  /\b(basically|literally|actually),?\s+(?=basically|literally|actually)/gi,
];

export function cleanTranscript(raw: string): string {
  let text = raw;

  for (const pattern of FILLER_PATTERNS) {
    text = text.replace(pattern, "");
  }

  // Collapse multiple spaces and trim lines
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Capitalize first letter of each sentence after cleanup
  text = text.replace(/(^|[.!?]\s+)([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());

  return text;
}

// ---------------------------------------------------------------------------
// Idea detection
// ---------------------------------------------------------------------------

const IDEA_SIGNALS = [
  /\bwhat if\b/i,
  /\bwe could\b/i,
  /\bwe should\b/i,
  /\bmaybe we\b/i,
  /\bi think we should\b/i,
  /\bidea[:\s]/i,
  /\bhow about\b/i,
  /\bwouldn'?t it be\b/i,
  /\bimagine if\b/i,
  /\bpitch[:\s]/i,
  /\bconcept[:\s]/i,
  /\bbrainstorm/i,
];

const NOTE_SIGNALS = [
  /\bremember (that|to)\b/i,
  /\bdon'?t forget\b/i,
  /\bnote to self\b/i,
  /\bfollowing up on\b/i,
  /\bmeeting with\b/i,
  /\bsummary of\b/i,
  /\btodo[:\s]/i,
  /\btask[:\s]/i,
  /\baction item/i,
];

export function detectIsIdea(text: string): boolean {
  const ideaScore = IDEA_SIGNALS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  const noteScore = NOTE_SIGNALS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  return ideaScore > noteScore && ideaScore >= 1;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WhisperPayload {
  userId: string;
  transcript: string;
  projectId?: string;
  tags?: string[];
  asIdea?: boolean;
}

export interface ProcessedWhisper {
  content: string;
  metadata: Omit<EmbedMetadata, "userId"> & { userId: string };
  detectedProject?: string;
  isIdea: boolean;
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

export async function process(payload: WhisperPayload): Promise<ProcessedWhisper> {
  const { userId, transcript, tags } = payload;

  // 1. Clean up transcript
  const content = cleanTranscript(transcript);

  // 2. Detect project context
  let projectId = payload.projectId;
  const detectedSlug = detectProjectSlug(content);
  if (!projectId && detectedSlug) {
    projectId = await resolveProjectId(userId, detectedSlug);
  }

  // 3. Determine idea vs note
  const isIdea = payload.asIdea ?? detectIsIdea(content);

  const enrichedTags = [...(tags ?? ["voice"])];
  if (detectedSlug) enrichedTags.push(detectedSlug);
  if (isIdea) enrichedTags.push("idea");

  return {
    content,
    detectedProject: detectedSlug,
    isIdea,
    metadata: {
      userId,
      source: "manual",
      projectId,
      category: "general",
      importance: isIdea ? 6 : 5,
      tags: enrichedTags,
      extra: isIdea
        ? { asIdea: true, sourceType: "voice_memo" as const, title: content.slice(0, 80) }
        : undefined,
    },
  };
}
