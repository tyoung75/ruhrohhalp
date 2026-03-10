import { describe, expect, it } from "vitest";
import { routeItem, detectType } from "@/lib/ai/routing";

describe("routing", () => {
  it("routes calendar to gemini", () => {
    const result = routeItem("schedule meeting next tuesday");
    expect(result.ai).toBe("gemini");
  });

  it("routes code to chatgpt", () => {
    const result = routeItem("debug this API integration error");
    expect(result.ai).toBe("chatgpt");
  });

  it("defaults to claude", () => {
    const result = routeItem("organize my product strategy thoughts");
    expect(result.ai).toBe("claude");
  });

  it("detects reminder type", () => {
    expect(detectType("remind me to send invoice")).toBe("reminder");
  });
});
