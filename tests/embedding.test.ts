import { describe, expect, it } from "vitest";
import { chunkText, estimateTokens } from "@/lib/embedding/chunker";

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 → 3
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkText", () => {
  it("returns empty array for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns single chunk for short text", () => {
    const text = "This is a short paragraph.";
    const chunks = chunkText(text);
    expect(chunks).toEqual([text]);
  });

  it("preserves text that fits within the limit", () => {
    const text = "A".repeat(1999);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it("splits on paragraph boundaries", () => {
    const para1 = "A".repeat(1000);
    const para2 = "B".repeat(1000);
    const para3 = "C".repeat(1000);
    const text = `${para1}\n\n${para2}\n\n${para3}`;

    const chunks = chunkText(text);
    // Each paragraph is 1000 chars, two together would be 2002 (> 2000),
    // so each gets its own chunk.
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
    expect(chunks[2]).toBe(para3);
  });

  it("merges small paragraphs that fit together", () => {
    const text = "Short para one.\n\nShort para two.\n\nShort para three.";
    const chunks = chunkText(text);
    // All fit in one chunk.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text.trim());
  });

  it("splits oversized paragraphs by sentences", () => {
    // Create a paragraph with multiple sentences totaling > 2000 chars.
    const sentence = "This is a test sentence that is moderately long. ";
    const longPara = sentence.repeat(50); // ~2500 chars
    const chunks = chunkText(longPara);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    // Recombined content should match original (minus trailing whitespace).
    const recombined = chunks.join(" ");
    expect(recombined.replace(/\s+/g, " ").trim()).toBe(
      longPara.replace(/\s+/g, " ").trim(),
    );
  });

  it("hard-splits extremely long words", () => {
    const longWord = "x".repeat(3000);
    const chunks = chunkText(longWord);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps each chunk under ~500 tokens", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i + 1}: ${"word ".repeat(150)}`,
    );
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text);

    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(550); // small margin
    }
  });
});
