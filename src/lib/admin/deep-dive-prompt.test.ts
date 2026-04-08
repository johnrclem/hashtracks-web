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

  it("calls out kennel-page improvements (founded year, social links, etc.)", () => {
    const prompt = buildDeepDivePrompt(FIXTURE);
    expect(prompt).toContain("Kennel page completeness");
    expect(prompt).toContain("Founded year");
    expect(prompt).toContain("Facebook");
    expect(prompt).toContain("Hash Cash");
  });

  it("tells the auditor to verify current HashTracks state before filing", () => {
    // Guards against false-positive "missing data" findings where the auditor
    // inspected only the source and never checked the HashTracks side.
    const prompt = buildDeepDivePrompt(FIXTURE);
    expect(prompt).toContain("Verify current state before flagging");
    expect(prompt).toContain("spot-check 2-3 of the highest run-numbered events");
  });

  it("routes historical backfill by source type (wide-window scrape vs one-shot insert)", () => {
    // Wide-window scrapes trigger the reconcile step, which cancels sole-source
    // events the adapter didn't return. That's safe for complete-enumeration
    // APIs (Google Calendar, iCal, Meetup) but unsafe for partial-enumeration
    // sources (HTML scrapers, Sheets). The prompt must distinguish.
    const prompt = buildDeepDivePrompt(FIXTURE);
    expect(prompt).toContain("Historical events");
    expect(prompt).toContain("Google Calendar, iCal, and Meetup");
    expect(prompt).toContain("HTML scrapers, Google Sheets");
    expect(prompt).toContain("wider scrape window is **unsafe**");
    // The "one-shot DB insert" phrase still appears as the partial-enumeration fallback
    expect(prompt).toContain("one-shot DB insert");
    // The prompt must not instruct the auditor to hit the cron endpoint directly —
    // it's auth-protected and an admin-initiated operation.
    expect(prompt).toContain("auth-protected");
  });

  it("tags schema-gap fields using event-card visibility, not a hardcoded column list", () => {
    // Prevents filing "missing extraction" issues for fields like shiggy
    // level, trail type, beer meister that have no user-visible slot.
    // Uses visible-evidence anchoring instead of a schema list that would
    // drift when the Event model changes (e.g. haresText vs hares).
    const prompt = buildDeepDivePrompt(FIXTURE);
    expect(prompt).toContain("schema gap");
    expect(prompt).toContain("visible home on a HashTracks event card");
    expect(prompt).toContain("shiggy level");
  });

  it("requires verbatim source text in the Expected Value filing line", () => {
    // Earlier audits synthesized expected values ("2FC" from "2FC Takes Fenton",
    // "1992-06-21" from "1992") that the adapter couldn't realistically emit.
    const prompt = buildDeepDivePrompt(FIXTURE);
    expect(prompt).toContain("verbatim text from the source");
    expect(prompt).toContain("not** a synthesized cleanup");
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
