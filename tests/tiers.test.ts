import { describe, expect, it } from "vitest";
import { isModelAllowedForTier } from "@/lib/tiers";

describe("tier model access", () => {
  it("free tier does not allow gpt-4o", () => {
    expect(isModelAllowedForTier("free", "gpt-4o")).toBe(false);
  });

  it("starter allows gpt-4o", () => {
    expect(isModelAllowedForTier("starter", "gpt-4o")).toBe(true);
  });

  it("byok allows all models", () => {
    expect(isModelAllowedForTier("byok", "claude-opus-4-5")).toBe(true);
  });
});
