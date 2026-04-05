/**
 * Embedding utility — BGE-M3 via Hugging Face Inference API.
 * Replaced OpenAI text-embedding-3-small with BGE-M3 (1024-dim, MIT license).
 */

import { AI_MODELS } from "@/lib/ai-config";

export type EmbeddingResult = { embedding: number[]; index: number };

async function generateEmbedding(text: string): Promise<number[]> {
  if (!process.env.HF_API_TOKEN) {
    throw new Error("Missing HF_API_TOKEN env var — required for BGE-M3 embeddings");
  }

  const response = await fetch(
    `https://api-inference.huggingface.co/pipeline/feature-extraction/${AI_MODELS.EMBEDDING_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
        "Content-Type": "application/json",
        "x-wait-for-model": "true",
      },
      body: JSON.stringify({ inputs: text }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BGE-M3 embedding failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return Array.isArray(data[0]) ? data[0] : data;
}

/**
 * Generate embeddings for one or more text inputs.
 * Accepts a single string or an array of strings for convenience.
 * Calls BGE-M3 sequentially per input (HF Inference API doesn't batch like OpenAI).
 */
export async function generateEmbeddings(
  texts: string | string[],
): Promise<number[][]> {
  const input = Array.isArray(texts) ? texts : [texts];
  if (input.length === 0) return [];

  const results: number[][] = [];
  for (const text of input) {
    results.push(await generateEmbedding(text));
  }
  return results;
}
