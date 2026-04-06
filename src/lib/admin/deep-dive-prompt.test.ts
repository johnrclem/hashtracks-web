import { describe, it, expect } from "vitest";
import { buildDeepDivePrompt } from "./deep-dive-prompt";
import type { DeepDiveCandidate } from "@/app/admin/audit/actions";

const FIXTURE: DeepDiveCandidate = {
  kennelCode: "nych3",
  shortName: "NYCH3",
  slug: "nych3",
  region: "New York City, NY",
  lastDeepDiveAt: null,
  eventCount90d: 47,
  sources: [
    { type: "HTML_SCRAPER", url: "https://hashnyc.com", name: "hashnyc.com" },
    { type: "HASHREGO", url: "https://hashrego.com/nych3", name: "Hash Rego (NYCH3)" },
  ],
};

describe("buildDeepDivePrompt", () => {
  it("includes kennel name, region, and HashTracks URL", () => {
    const prompt = buildDeepDivePrompt(FIXTURE);
    expect(prompt).toContain("NYCH3");
    expect(prompt).toContain("New York City, NY");
    expect(prompt).toContain("https://www.hashtracks.xyz/kennels/nych3");
  });

  it("lists every source with type and URL", () => {
    const prompt = buildDeepDivePrompt(FIXTURE);
    expect(prompt).toContain("hashnyc.com");
    expect(prompt).toContain("HTML_SCRAPER");
    expect(prompt).toContain("https://hashnyc.com");
    expect(prompt).toContain("Hash Rego (NYCH3)");
    expect(prompt).toContain("HASHREGO");
  });

  it("shows 'never' when there's no prior deep dive", () => {
    const prompt = buildDeepDivePrompt(FIXTURE);
    expect(prompt).toContain("Last deep dive:** never");
  });

  it("formats prior deep dive date as ISO date", () => {
    const prompt = buildDeepDivePrompt({
      ...FIXTURE,
      lastDeepDiveAt: new Date("2026-03-15T12:00:00Z"),
    });
    expect(prompt).toContain("Last deep dive:** 2026-03-15");
  });

  it("includes the 'What to check' and filing instructions", () => {
    const prompt = buildDeepDivePrompt(FIXTURE);
    expect(prompt).toContain("## What to check");
    expect(prompt).toContain("## Filing findings");
    expect(prompt).toContain("audit,alert");
  });

  it("ends with the 'mark deep dive complete' instruction", () => {
    const prompt = buildDeepDivePrompt(FIXTURE);
    expect(prompt).toMatch(/Mark deep dive complete/);
  });

  it("notes when a kennel has no enabled sources", () => {
    const prompt = buildDeepDivePrompt({ ...FIXTURE, sources: [] });
    expect(prompt).toContain("no enabled sources");
  });
});
