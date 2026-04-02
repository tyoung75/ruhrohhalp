/**
 * Semantic text chunker — splits by paragraph then sentence boundaries.
 * Targets ~500 tokens per chunk (≈2 000 chars using the ~4 chars/token heuristic).
 */

const MAX_CHUNK_CHARS = 2000; // ~500 tokens
const MIN_CHUNK_CHARS = 40; // skip trivially small trailing fragments

/** Approximate token count (English text averages ~4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split `text` into semantically meaningful chunks.
 *
 * Strategy:
 *  1. Split on double-newlines (paragraphs).
 *  2. Greedily merge paragraphs that fit within the budget.
 *  3. If a single paragraph exceeds the budget, split it by sentences.
 *  4. If a sentence still exceeds the budget, hard-split at the limit.
 */
export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= MAX_CHUNK_CHARS) return [trimmed];

  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = "";

  for (const para of paragraphs) {
    // If adding this paragraph still fits, accumulate.
    if (buffer.length + para.length + 2 <= MAX_CHUNK_CHARS) {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
      continue;
    }

    // Flush the buffer before processing the oversized paragraph.
    if (buffer) {
      chunks.push(buffer);
      buffer = "";
    }

    // Paragraph fits on its own — just use it directly.
    if (para.length <= MAX_CHUNK_CHARS) {
      buffer = para;
      continue;
    }

    // Paragraph is oversized — split by sentences.
    const sentences = splitSentences(para);
    for (const sentence of sentences) {
      if (buffer.length + sentence.length + 1 <= MAX_CHUNK_CHARS) {
        buffer = buffer ? `${buffer} ${sentence}` : sentence;
      } else {
        if (buffer) chunks.push(buffer);

        if (sentence.length <= MAX_CHUNK_CHARS) {
          buffer = sentence;
        } else {
          // Sentence itself is huge — hard-split.
          chunks.push(...hardSplit(sentence));
          buffer = "";
        }
      }
    }
  }

  if (buffer && buffer.length >= MIN_CHUNK_CHARS) {
    chunks.push(buffer);
  } else if (buffer && chunks.length > 0) {
    // Merge tiny trailing fragment into the last chunk.
    chunks[chunks.length - 1] += `\n\n${buffer}`;
  } else if (buffer) {
    chunks.push(buffer);
  }

  return chunks;
}

/** Split a block of text into sentences. */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace.
  // Handles ". ", "! ", "? " while avoiding false splits on "Dr.", "U.S.", decimals, etc.
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** Hard-split a string that exceeds MAX_CHUNK_CHARS at word boundaries. */
function hardSplit(text: string): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let line = "";

  for (const word of words) {
    if (word.length > MAX_CHUNK_CHARS) {
      if (line) {
        chunks.push(line);
        line = "";
      }
      for (let i = 0; i < word.length; i += MAX_CHUNK_CHARS) {
        chunks.push(word.slice(i, i + MAX_CHUNK_CHARS));
      }
      continue;
    }

    if (line.length + word.length + 1 <= MAX_CHUNK_CHARS) {
      line = line ? `${line} ${word}` : word;
    } else {
      if (line) chunks.push(line);
      line = word;
    }
  }
  if (line) chunks.push(line);
  return chunks;
}
