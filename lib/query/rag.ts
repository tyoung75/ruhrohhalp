/**
 * TYOS-279 — RAG query engine for Tyler's brain.
 *
 * Single entry point: `queryBrain(question, options?)`
 *
 * Flow:
 *  1. Embed the question via BGE-M3 (reuses lib/embedding).
 *  2. Call search_by_embedding() RPC for cosine-similarity retrieval.
 *  3. Hydrate matching memory rows (content + metadata).
 *  4. Optionally filter by project_id / category / source.
 *  5. Assemble retrieved chunks into a context block.
 *  6. Call Claude with system prompt + context + question.
 *  7. Return { answer, sources, chunks }.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { generateEmbeddings } from "@/lib/embedding/openai";
import { logError } from "@/lib/logger";
import { AI_MODELS } from "@/lib/ai-config";
import type { MemoryCategory, MemorySource } from "@/lib/types/domain";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLAUDE_MODEL = AI_MODELS.PRIMARY;
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MAX_TOKENS_DEFAULT = 2048;

/** Default number of chunks to retrieve from the vector store. */
const DEFAULT_TOP_K = 8;

/** Similarity threshold passed to the RPC. */
const DEFAULT_THRESHOLD = 0.65;

/**
 * Over-fetch multiplier when client-side filters are active so we have
 * enough candidates after filtering.
 */
const FILTER_OVERFETCH = 3;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface QueryOptions {
  userId: string;
  /** Max chunks to include in context (default 8). */
  topK?: number;
  /** Minimum cosine similarity (default 0.65). */
  threshold?: number;
  /** Only include memories linked to this project. */
  projectId?: string;
  /** Only include memories matching this category. */
  category?: MemoryCategory;
  /** Only include memories matching this source. */
  source?: MemorySource;
  /** Which table to search (default "memories"). */
  table?: string;
  /** Max tokens for Claude response (default 2048). Use higher values for long-form output like briefings. */
  maxTokens?: number;
}

export interface RetrievedChunk {
  id: string;
  content: string;
  summary: string;
  source: MemorySource;
  sourceId: string | null;
  category: MemoryCategory;
  similarity: number;
  createdAt: string;
}

export interface QueryResult {
  answer: string;
  sources: { id: string; source: MemorySource; similarity: number }[];
  chunks: RetrievedChunk[];
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const BRAIN_SYSTEM_PROMPT = `You are TylerOS — Tyler Young's personal AI brain and executive assistant.

You have access to Tyler's stored memories, decisions, meeting notes, documents, ideas, and project knowledge. When answering, draw on the retrieved context provided below. If the context doesn't contain enough information, say so honestly rather than guessing.

## Who Tyler is
Tyler Young is a founder and operator running multiple ventures simultaneously:
- **Motus** — his primary venture (movement / mobility focused).
- **RuhrohHalp** — a personal productivity orchestration app (the one you power).
- **Iron Passport** — a venture in the identity / credentialing space.
- **Caliber** — a venture in the fitness / performance space.
- **thestayed** — a media / content venture.

## How to answer
- Be direct and concise — Tyler values clarity over filler.
- Reference specific memories or documents when possible ("Based on your Dec 15 meeting notes…").
- If multiple memories conflict, surface the conflict and let Tyler decide.
- When the question involves a decision, surface prior decisions and their reasoning.
- For project-specific questions, stay scoped to that venture's context.
- Format with markdown when it aids readability.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY env var for RAG query engine");
  return key;
}

/** Build the user message that includes retrieved context + the question. */
export function buildContextMessage(chunks: RetrievedChunk[], question: string): string {
  if (chunks.length === 0) {
    return `No relevant memories were found for this question.\n\nQuestion: ${question}`;
  }

  const contextBlock = chunks
    .map((c, i) => {
      const meta = [
        `source: ${c.source}`,
        c.category !== "general" ? `category: ${c.category}` : null,
        `similarity: ${(c.similarity * 100).toFixed(1)}%`,
        `date: ${c.createdAt.slice(0, 10)}`,
      ]
        .filter(Boolean)
        .join(" | ");
      return `[${i + 1}] (${meta})\n${c.content}`;
    })
    .join("\n\n---\n\n");

  return `<context>\n${contextBlock}\n</context>\n\nQuestion: ${question}`;
}

// ---------------------------------------------------------------------------
// Core RAG function
// ---------------------------------------------------------------------------

export async function queryBrain(
  question: string,
  options: QueryOptions,
): Promise<QueryResult> {
  const {
    userId,
    topK = DEFAULT_TOP_K,
    threshold = DEFAULT_THRESHOLD,
    projectId,
    category,
    source,
    table = "memories",
    maxTokens = CLAUDE_MAX_TOKENS_DEFAULT,
  } = options;

  const hasFilters = !!(projectId || category || source);

  const supabase = createAdminClient();

  type MemoryRow = {
    id: string;
    content: string;
    summary: string;
    source: string;
    source_id: string | null;
    category: string;
    created_at: string;
  };

  let chunks: RetrievedChunk[] = [];

  // 1. Try semantic search via embeddings; fall back to recency if unavailable or broken
  const canEmbed = !!process.env.HF_API_TOKEN;
  let useRecencyFallback = !canEmbed;

  if (canEmbed && !useRecencyFallback) {
    try {
      // --- Semantic path: embed question → vector search → hydrate ---
      const [embedding] = await generateEmbeddings([question]);

      const fetchCount = hasFilters ? topK * FILTER_OVERFETCH : topK;

      const { data: matches, error: rpcError } = await supabase.rpc("search_by_embedding", {
        p_user_id: userId,
        p_table_name: table,
        p_embedding: JSON.stringify(embedding),
        p_match_count: fetchCount,
        p_match_threshold: threshold,
      });

      if (rpcError) {
        logError("rag.search_rpc", rpcError, { userId, table });
        throw new Error(`Vector search failed: ${rpcError.message}`);
      }

      const matchedIds = (matches ?? []) as { id: string; similarity: number }[];
      if (matchedIds.length === 0) {
        const answer = await callClaude(buildContextMessage([], question), maxTokens);
        return { answer, sources: [], chunks: [] };
      }

      const ids = matchedIds.map((m) => m.id);
      const similarityMap = new Map(matchedIds.map((m) => [m.id, m.similarity]));

      const { data: rows, error: fetchError } = await supabase
        .from("memories")
        .select("id, content, summary, source, source_id, category, created_at")
        .in("id", ids);

      if (fetchError) {
        logError("rag.hydrate", fetchError, { userId });
        throw new Error(`Failed to hydrate memories: ${fetchError.message}`);
      }

      chunks = ((rows ?? []) as MemoryRow[]).map((r) => ({
        id: r.id,
        content: r.content,
        summary: r.summary,
        source: r.source as MemorySource,
        sourceId: r.source_id,
        category: r.category as MemoryCategory,
        similarity: similarityMap.get(r.id) ?? 0,
        createdAt: r.created_at,
      }));
    } catch (semanticErr) {
      // Embedding or vector search failed — fall back to recency
      logError("rag.semantic_fallback", semanticErr, { userId });
      useRecencyFallback = true;
    }
  }

  if (useRecencyFallback) {
    // --- Recency fallback: no embeddings available or embedding failed ---
    let query = supabase
      .from("memories")
      .select("id, content, summary, source, source_id, category, created_at")
      .eq("user_id", userId)
      .order("importance", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(hasFilters ? topK * FILTER_OVERFETCH : topK);

    if (category) query = query.eq("category", category);
    if (source) query = query.eq("source", source);

    const { data: rows, error: fetchError } = await query;

    if (fetchError) {
      logError("rag.recency_fallback", fetchError, { userId });
      throw new Error(`Recency fallback failed: ${fetchError.message}`);
    }

    chunks = ((rows ?? []) as MemoryRow[]).map((r) => ({
      id: r.id,
      content: r.content,
      summary: r.summary,
      source: r.source as MemorySource,
      sourceId: r.source_id,
      category: r.category as MemoryCategory,
      similarity: 1, // no similarity score in recency mode
      createdAt: r.created_at,
    }));
  }

  // Apply client-side filters
  if (projectId) {
    chunks = chunks.filter((c) => c.sourceId === projectId);
  }
  if (category && canEmbed) {
    // Only filter here if we didn't already filter in the query (semantic path)
    chunks = chunks.filter((c) => c.category === category);
  }
  if (source && canEmbed) {
    chunks = chunks.filter((c) => c.source === source);
  }

  // Sort by similarity descending, take topK.
  chunks.sort((a, b) => b.similarity - a.similarity);
  chunks = chunks.slice(0, topK);

  // 5. Assemble context + call Claude
  const userMessage = buildContextMessage(chunks, question);
  const answer = await callClaude(userMessage, maxTokens);

  // 6. Return structured result
  const sources = chunks.map((c) => ({
    id: c.id,
    source: c.source,
    similarity: c.similarity,
  }));

  return { answer, sources, chunks };
}

// ---------------------------------------------------------------------------
// Claude API call (raw fetch, consistent with lib/ai/providers.ts)
// ---------------------------------------------------------------------------

async function callClaude(userMessage: string, maxTokens = CLAUDE_MAX_TOKENS_DEFAULT): Promise<string> {
  const apiKey = getAnthropicKey();

  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: BRAIN_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Claude RAG call failed (${res.status})`);
  }

  return data.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
}
