import { describe, expect, it } from "vitest";
import { cleanTranscript, detectIsIdea } from "@/lib/processors/whisper";
import { mapPriority } from "@/lib/processors/linear";
import { parseProjectPrefix } from "@/lib/processors/reminder";
import { detectMeetingType } from "@/lib/processors/calendar";
import { detectProjectSlug } from "@/lib/processors/projects";

describe("whisper: cleanTranscript", () => {
  it("removes filler words", () => {
    const result = cleanTranscript("So um I was thinking uh about the product");
    expect(result).not.toMatch(/\bum\b/i);
    expect(result).not.toMatch(/\buh\b/i);
    expect(result).toContain("thinking");
    expect(result).toContain("product");
  });

  it("collapses extra whitespace", () => {
    const result = cleanTranscript("hello    world\n\n\n\nfoo");
    expect(result).toBe("Hello world\n\nFoo");
  });
});

describe("whisper: detectIsIdea", () => {
  it("detects idea-like content", () => {
    expect(detectIsIdea("What if we built a dashboard for Motus?")).toBe(true);
    expect(detectIsIdea("We should explore a new pricing model")).toBe(true);
    expect(detectIsIdea("Idea: subscription tiers for Iron Passport")).toBe(true);
  });

  it("detects note-like content", () => {
    expect(detectIsIdea("Remember to send the invoice to Brett")).toBe(false);
    expect(detectIsIdea("Meeting with Jill at 3pm tomorrow")).toBe(false);
    expect(detectIsIdea("Todo: update the Linear board")).toBe(false);
  });
});

describe("linear: mapPriority", () => {
  it("maps Linear priorities to TylerOS importance", () => {
    expect(mapPriority(1)).toBe(9);  // Urgent
    expect(mapPriority(2)).toBe(7);  // High
    expect(mapPriority(3)).toBe(5);  // Normal
    expect(mapPriority(4)).toBe(3);  // Low
    expect(mapPriority(0)).toBe(5);  // No priority
  });

  it("defaults to 5 for null/undefined", () => {
    expect(mapPriority(null)).toBe(5);
    expect(mapPriority(undefined)).toBe(5);
  });
});

describe("reminder: parseProjectPrefix", () => {
  it("extracts known project prefixes", () => {
    expect(parseProjectPrefix("MOTUS: Fix onboarding flow")).toEqual({
      cleanTitle: "Fix onboarding flow",
      slug: "motus",
    });
    expect(parseProjectPrefix("Caliber: Update workout plans")).toEqual({
      cleanTitle: "Update workout plans",
      slug: "caliber",
    });
    expect(parseProjectPrefix("RNTLX: Deploy staging")).toEqual({
      cleanTitle: "Deploy staging",
      slug: "ruhrohhalp",
    });
    expect(parseProjectPrefix("Iron Passport: Review ID flow")).toEqual({
      cleanTitle: "Review ID flow",
      slug: "iron-passport",
    });
  });

  it("returns original title for unknown prefixes", () => {
    expect(parseProjectPrefix("Random: some task")).toEqual({
      cleanTitle: "Random: some task",
    });
  });

  it("returns original title when no prefix found", () => {
    expect(parseProjectPrefix("Just a plain reminder")).toEqual({
      cleanTitle: "Just a plain reminder",
    });
  });
});

describe("calendar: detectMeetingType", () => {
  it("detects solo meeting", () => {
    expect(detectMeetingType([])).toBe("solo");
  });

  it("detects 1:1 meeting", () => {
    expect(detectMeetingType(["jill@motus.com"])).toBe("one_on_one");
  });

  it("detects internal group meeting", () => {
    expect(detectMeetingType(["a@motus.com", "b@motus.com"])).toBe("group");
  });

  it("detects external meeting", () => {
    expect(detectMeetingType(["a@motus.com", "partner@external.com"])).toBe("external");
  });
});

describe("projects: detectProjectSlug", () => {
  it("detects project keywords in text", () => {
    expect(detectProjectSlug("We need to update the Motus dashboard")).toBe("motus");
    expect(detectProjectSlug("thestayed content calendar")).toBe("thestayed");
    expect(detectProjectSlug("Iron Passport identity verification")).toBe("iron-passport");
    expect(detectProjectSlug("Caliber workout tracker")).toBe("caliber");
  });

  it("returns undefined for no match", () => {
    expect(detectProjectSlug("generic task without project context")).toBeUndefined();
  });
});
