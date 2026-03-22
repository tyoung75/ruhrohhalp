/**
 * Embedding utility — BGE-M3 via Hugging Face Inference API.
 * Replaced OpenAI text-embedding-3-small with BGE-M3 (1024-dim, MIT license).
 */

import { AI_MODELS } from "@/lib/ai-config";

export type EmbeddingResult = { embedding: number[]; index: number };

async function generateEmbedding(text: string): Promise<number[]> {
  // Replaced OpenAI text-embedding-3-small with BGE-M3 (1024-dim, MIT license)
  const response = await fetch(
    `https://api-inference.huggingface.co/models/${AI_MODELS.EMBEDDING_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text }),
    }
  );
  const data = await response.json();
  return Array.isArray(data[0]) ? data[0] : data;
}

/**
 * Generate embeddings for one or more text inputs.
 * Calls BGE-M3 sequentially per input (HF Inference API doesn't batch like OpenAI).
 */
export async function generateEmbeddings(
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];
  for (const text of texts) {
    results.push(await generateEmbedding(text));
  }
  return results;
}
