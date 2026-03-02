import { vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn().mockResolvedValue({ id: "admin-1" }) }));

import { prisma } from "@/lib/db";
import { extractMeetupGroupUrlname, buildGeminiSuggestion } from "./suggest-source-config-action";
import type { RawEventData } from "@/adapters/types";

const mockKennelFindMany = vi.mocked(prisma.kennel.findMany);

describe("extractMeetupGroupUrlname", () => {
  it.each([
    ["standard meetup URL with path", "https://www.meetup.com/savannah-hash-house-harriers/events/", "savannah-hash-house-harriers"],
    ["URL without trailing path", "https://meetup.com/brooklyn-hash-house-harriers", "brooklyn-hash-house-harriers"],
    ["subdomain URL", "https://www.meetup.com/some-group/", "some-group"],
  ])("extracts group name from %s", async (_, url, expected) => {
    expect(await extractMeetupGroupUrlname(url)).toBe(expected);
  });

  it.each([
    ["non-meetup URL", "https://example.com/some-path"],
    ["bare meetup.com with no path", "https://meetup.com/"],
    ["invalid URL", "not-a-url"],
    ["empty string", ""],
    ["lookalike domain notmeetup.com", "https://notmeetup.com/some-group"],
    ["meetup.com.evil domain", "https://meetup.com.evil/some-group"],
  ])("returns null for %s", async (_, url) => {
    expect(await extractMeetupGroupUrlname(url)).toBeNull();
  });
});

// ─── buildGeminiSuggestion — suggestedNewKennel ──────────────────────────────

function makeSampleEvents(kennelTag: string, count = 3): RawEventData[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-03-${String(i + 1).padStart(2, "0")}`,
    kennelTag,
    title: `Trail #${i + 1} — Test Run`,
  }));
}

function makeGeminiClient(responseJson: Record<string, unknown>) {
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({
        text: JSON.stringify(responseJson),
      }),
    },
  } as never;
}

const KNOWN_KENNELS = [
  { shortName: "NYCH3", fullName: "New York City Hash House Harriers" },
  { shortName: "BFM", fullName: "Ben Franklin Mob" },
];

describe("buildGeminiSuggestion — suggestedNewKennel", () => {
  beforeEach(() => {
    mockKennelFindMany.mockResolvedValue(KNOWN_KENNELS as never);
  });

  it("includes suggestedNewKennel when kennelTag is not in known kennels", async () => {
    const client = makeGeminiClient({
      suggestedConfig: { kennelTag: "SavH3" },
      suggestedKennelTags: [],
      explanation: "Derived from Savannah Hash group.",
      confidence: "high",
      suggestedNewKennel: {
        shortName: "SavH3",
        fullName: "Savannah Hash House Harriers",
        region: "Savannah, GA",
      },
    });

    const result = await buildGeminiSuggestion(
      "https://meetup.com/savannah-hash", "MEETUP", makeSampleEvents("savannah-hash"), client,
    );

    expect("suggestion" in result).toBe(true);
    if ("suggestion" in result) {
      expect(result.suggestion.suggestedNewKennel).toEqual({
        shortName: "SavH3",
        fullName: "Savannah Hash House Harriers",
        region: "Savannah, GA",
      });
    }
  });

  it("omits suggestedNewKennel when kennelTag matches a known kennel", async () => {
    const client = makeGeminiClient({
      suggestedConfig: { kennelTag: "NYCH3" },
      suggestedKennelTags: ["NYCH3"],
      explanation: "Matched to NYCH3.",
      confidence: "high",
      suggestedNewKennel: {
        shortName: "NYCH3",
        fullName: "New York City Hash House Harriers",
        region: "New York, NY",
      },
    });

    const result = await buildGeminiSuggestion(
      "https://meetup.com/nyc-hash", "MEETUP", makeSampleEvents("nyc-hash"), client,
    );

    expect("suggestion" in result).toBe(true);
    if ("suggestion" in result) {
      expect(result.suggestion.suggestedNewKennel).toBeNull();
    }
  });

  it("omits suggestedNewKennel when Gemini returns invalid shape", async () => {
    const client = makeGeminiClient({
      suggestedConfig: { kennelTag: "SavH3" },
      suggestedKennelTags: [],
      explanation: "Test.",
      confidence: "medium",
      suggestedNewKennel: { shortName: "SavH3" }, // missing fullName and region
    });

    const result = await buildGeminiSuggestion(
      "https://meetup.com/savannah-hash", "MEETUP", makeSampleEvents("savannah-hash"), client,
    );

    expect("suggestion" in result).toBe(true);
    if ("suggestion" in result) {
      expect(result.suggestion.suggestedNewKennel).toBeNull();
    }
  });

  it("handles case-insensitive kennel matching for cross-check", async () => {
    const client = makeGeminiClient({
      suggestedConfig: { kennelTag: "nych3" },
      suggestedKennelTags: ["NYCH3"],
      explanation: "Matched.",
      confidence: "high",
      suggestedNewKennel: {
        shortName: "nych3",
        fullName: "NYC H3",
        region: "New York, NY",
      },
    });

    const result = await buildGeminiSuggestion(
      "https://meetup.com/nyc-hash", "MEETUP", makeSampleEvents("nyc-hash"), client,
    );

    expect("suggestion" in result).toBe(true);
    if ("suggestion" in result) {
      expect(result.suggestion.suggestedNewKennel).toBeNull();
    }
  });

  it("returns null suggestedNewKennel when Gemini omits the field", async () => {
    const client = makeGeminiClient({
      suggestedConfig: { kennelTag: "SavH3" },
      suggestedKennelTags: [],
      explanation: "Test.",
      confidence: "medium",
    });

    const result = await buildGeminiSuggestion(
      "https://meetup.com/savannah-hash", "MEETUP", makeSampleEvents("savannah-hash"), client,
    );

    expect("suggestion" in result).toBe(true);
    if ("suggestion" in result) {
      expect(result.suggestion.suggestedNewKennel).toBeNull();
    }
  });
});
