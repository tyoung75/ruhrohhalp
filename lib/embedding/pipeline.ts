/**
 * TYOS-278 — Reusable embedding pipeline.
 *
 * Single entry point: `embedAndStore(content, metadata)`
 *
 * 1. Chunks text by semantic boundaries (~500 tokens per chunk).
 * 2. Calls OpenAI text-embedding-3-small for each chunk (batched).
 * 3. Upserts every chunk to the `memories` table with full metadata.
 * 4. Routes to a source-specific table when applicable
 *    (voice_memo → ideas, meeting → meetings, document → documents).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { chunkText } from "@/lib/embedding/chunker";
import { generateEmbeddings } from "@/lib/embedding/openai";
import { logError } from "@/lib/logger";
import type { MemoryCategory, MemorySource } from "@/lib/types/domain";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EmbedMetadata {
  userId: string;
  source: MemorySource;
  sourceId?: string;
  projectId?: string;
  category?: MemoryCategory;
  importance?: number;
  tags?: string[];
  /** Extra fields forwarded to the source-specific table upsert. */
  extra?: Record<string, unknown>;
}

export interface EmbedResult {
  /** IDs of rows written to the memories table. */
  memoryIds: string[];
  /** IDs of rows written to the source-specific table (if any). */
  sourceIds: string[];
  /** Number of chunks produced. */
  chunkCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OPENAI_API_KEY env var for embedding pipeline");
  return key;
}

/** Batch an array into groups of `size`. */
function batch<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

// OpenAI allows up to 2048 inputs per call; keep batches reasonable.
const EMBED_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

export async function embedAndStore(
  content: string,
  metadata: EmbedMetadata,
): Promise<EmbedResult> {
  const { userId, source, sourceId, projectId, category, importance, tags, extra } = metadata;

  // 1. Chunk
  const chunks = chunkText(content);
  if (chunks.length === 0) {
    return { memoryIds: [], sourceIds: [], chunkCount: 0 };
  }

  // 2. Embed (batched)
  const apiKey = getOpenAIKey();
  const allEmbeddings: number[][] = [];
  for (const group of batch(chunks, EMBED_BATCH_SIZE)) {
    const embeddings = await generateEmbeddings(group, apiKey);
    allEmbeddings.push(...embeddings);
  }

  // 3. Upsert to memories
  const supabase = createAdminClient();

  const memoryRows = chunks.map((chunk, i) => ({
    user_id: userId,
    content: chunk,
    summary: chunk.length > 200 ? chunk.slice(0, 200) + "…" : chunk,
    source,
    source_id: sourceId ?? null,
    category: category ?? "general",
    importance: importance ?? 5,
    tags: tags ?? [],
    embedding: JSON.stringify(allEmbeddings[i]),
  }));

  const { data: memoryData, error: memoryError } = await supabase
    .from("memories")
    .insert(memoryRows)
    .select("id");

  if (memoryError) {
    logError("embedding.memories_insert", memoryError, { userId, source });
    throw new Error(`Failed to insert memories: ${memoryError.message}`);
  }

  const memoryIds = (memoryData ?? []).map((r: { id: string }) => r.id);

  // 4. Route to source-specific table
  const sourceIds = await routeToSourceTable({
    supabase,
    source,
    userId,
    projectId,
    tags,
    chunks,
    embeddings: allEmbeddings,
    extra,
  });

  return { memoryIds, sourceIds, chunkCount: chunks.length };
}

// ---------------------------------------------------------------------------
// Source-specific routing
// ---------------------------------------------------------------------------

interface RouteParams {
  supabase: ReturnType<typeof createAdminClient>;
  source: MemorySource;
  userId: string;
  projectId?: string;
  tags?: string[];
  chunks: string[];
  embeddings: number[][];
  extra?: Record<string, unknown>;
}

async function routeToSourceTable(params: RouteParams): Promise<string[]> {
  const { supabase, source, userId, projectId, tags, chunks, embeddings, extra } = params;

  // voice_memo / manual idea capture → ideas table
  if (source === "manual") {
    // Only route to ideas if caller explicitly signals it via extra.asIdea
    if (!extra?.asIdea) return [];
    return upsertIdeas({ supabase, userId, projectId, tags, chunks, embeddings, extra });
  }

  if (source === "meeting") {
    return upsertMeetings({ supabase, userId, projectId, tags, chunks, embeddings, extra });
  }

  if (source === "document") {
    return upsertDocuments({ supabase, userId, projectId, tags, chunks, embeddings, extra });
  }

  // conversation, task, and other sources → memories only (already stored above)
  return [];
}

// --- Ideas (voice_memo / note captures) -----------------------------------

async function upsertIdeas(params: Omit<RouteParams, "source">): Promise<string[]> {
  const { supabase, userId, projectId, tags, chunks, embeddings, extra } = params;

  const rows = chunks.map((chunk, i) => ({
    user_id: userId,
    title: (extra?.title as string) ?? chunk.slice(0, 80),
    description: chunk,
    source_type: (extra?.sourceType as string) ?? "typed",
    category: (extra?.ideaCategory as string) ?? "general",
    project_id: projectId ?? null,
    tags: tags ?? [],
    embedding: JSON.stringify(embeddings[i]),
  }));

  const { data, error } = await supabase.from("ideas").insert(rows).select("id");
  if (error) {
    logError("embedding.ideas_insert", error, { userId });
    return [];
  }
  return (data ?? []).map((r: { id: string }) => r.id);
}

// --- Meetings -------------------------------------------------------------

async function upsertMeetings(params: Omit<RouteParams, "source">): Promise<string[]> {
  const { supabase, userId, projectId, tags, chunks, embeddings, extra } = params;

  // For meetings we consolidate all chunks into a single meeting row.
  const fullText = chunks.join("\n\n");
  const row = {
    user_id: userId,
    title: (extra?.title as string) ?? fullText.slice(0, 80),
    summary: (extra?.summary as string) ?? "",
    notes: fullText,
    project_id: projectId ?? null,
    calendar_event_id: (extra?.calendarEventId as string) ?? null,
    meeting_at: (extra?.meetingAt as string) ?? new Date().toISOString(),
    duration_minutes: (extra?.durationMinutes as number) ?? null,
    location: (extra?.location as string) ?? "",
    action_items: (extra?.actionItems as string[]) ?? [],
    attendee_ids: (extra?.attendeeIds as string[]) ?? [],
    tags: tags ?? [],
    // Use the first chunk's embedding as the meeting embedding.
    embedding: JSON.stringify(embeddings[0]),
  };

  const { data, error } = await supabase.from("meetings").insert([row]).select("id");
  if (error) {
    logError("embedding.meetings_insert", error, { userId });
    return [];
  }
  return (data ?? []).map((r: { id: string }) => r.id);
}

// --- Documents (Google Drive chunks, etc.) --------------------------------

async function upsertDocuments(params: Omit<RouteParams, "source">): Promise<string[]> {
  const { supabase, userId, projectId, tags, chunks, embeddings, extra } = params;

  const rows = chunks.map((chunk, i) => ({
    user_id: userId,
    title: (extra?.title as string) ?? chunk.slice(0, 80),
    content: chunk,
    doc_type: (extra?.docType as string) ?? "note",
    drive_file_id: (extra?.driveFileId as string) ?? null,
    chunk_index: i,
    parent_doc_id: (extra?.parentDocId as string) ?? null,
    project_id: projectId ?? null,
    tags: tags ?? [],
    embedding: JSON.stringify(embeddings[i]),
  }));

  const { data, error } = await supabase.from("documents").insert(rows).select("id");
  if (error) {
    logError("embedding.documents_insert", error, { userId });
    return [];
  }
  return (data ?? []).map((r: { id: string }) => r.id);
}
