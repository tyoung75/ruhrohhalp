/**
 * Thin wrapper around the OpenAI embeddings endpoint.
 * Uses raw fetch to stay consistent with the rest of the codebase (no SDK).
 */

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

export type EmbeddingResult = { embedding: number[]; index: number };

/**
 * Generate embeddings for one or more text inputs in a single API call.
 * OpenAI supports batched input — pass an array to reduce round-trips.
 */
export async function generateEmbeddings(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `OpenAI embeddings call failed (${res.status})`);
  }

  // Sort by index to guarantee ordering matches input.
  const sorted = (data.data as EmbeddingResult[]).sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}
