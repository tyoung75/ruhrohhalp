import { describe, expect, it } from "vitest";
import { buildContextMessage } from "@/lib/query/rag";
import type { RetrievedChunk } from "@/lib/query/rag";

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    content: "Tyler decided to prioritize Motus launch over Iron Passport.",
    summary: "Tyler decided to prioritize Motus launch…",
    source: "manual",
    sourceId: null,
    category: "work",
    similarity: 0.92,
    createdAt: "2025-12-15T10:00:00Z",
    ...overrides,
  };
}

describe("buildContextMessage", () => {
  it("returns a no-context message when chunks are empty", () => {
    const msg = buildContextMessage([], "What is Motus?");
    expect(msg).toContain("No relevant memories");
    expect(msg).toContain("What is Motus?");
    expect(msg).not.toContain("<context>");
  });

  it("includes context block and question for non-empty chunks", () => {
    const chunks = [makeChunk()];
    const msg = buildContextMessage(chunks, "What did Tyler decide?");

    expect(msg).toContain("<context>");
    expect(msg).toContain("</context>");
    expect(msg).toContain("Tyler decided to prioritize Motus");
    expect(msg).toContain("Question: What did Tyler decide?");
  });

  it("includes metadata in each chunk header", () => {
    const chunks = [makeChunk({ source: "meeting", category: "work", similarity: 0.85 })];
    const msg = buildContextMessage(chunks, "test");

    expect(msg).toContain("source: meeting");
    expect(msg).toContain("category: work");
    expect(msg).toContain("85.0%");
    expect(msg).toContain("2025-12-15");
  });

  it("omits category when it is general", () => {
    const chunks = [makeChunk({ category: "general" })];
    const msg = buildContextMessage(chunks, "test");

    expect(msg).not.toContain("category: general");
  });

  it("numbers multiple chunks sequentially", () => {
    const chunks = [
      makeChunk({ id: "a", content: "First memory" }),
      makeChunk({ id: "b", content: "Second memory" }),
      makeChunk({ id: "c", content: "Third memory" }),
    ];
    const msg = buildContextMessage(chunks, "test");

    expect(msg).toContain("[1]");
    expect(msg).toContain("[2]");
    expect(msg).toContain("[3]");
    expect(msg).toContain("First memory");
    expect(msg).toContain("Second memory");
    expect(msg).toContain("Third memory");
  });

  it("separates chunks with dividers", () => {
    const chunks = [
      makeChunk({ content: "Alpha" }),
      makeChunk({ content: "Beta" }),
    ];
    const msg = buildContextMessage(chunks, "test");

    expect(msg).toContain("---");
  });
});
