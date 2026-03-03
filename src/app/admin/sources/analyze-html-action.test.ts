import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import { findCandidateContainers } from "./analyze-html-action";
import type { ContainerCandidate } from "./analyze-html-action";

// We test findCandidateContainers directly (pure function, no auth/fetch needed)

const TABLE_WITH_DATES = `
<html><body>
<table id="hareline">
  <thead><tr><th>Date</th><th>Hares</th><th>Location</th></tr></thead>
  <tbody>
    <tr><td>March 15, 2026</td><td>Salty Dog</td><td>Central Park</td></tr>
    <tr><td>March 22, 2026</td><td>Beer Me</td><td>Times Square</td></tr>
    <tr><td>March 29, 2026</td><td>Hash Flash</td><td>Brooklyn Bridge</td></tr>
    <tr><td>April 5, 2026</td><td>TBD</td><td>TBD</td></tr>
  </tbody>
</table>
</body></html>
`;

const TABLE_WITHOUT_DATES = `
<html><body>
<table>
  <tr><td>Name</td><td>Email</td></tr>
  <tr><td>John</td><td>john@example.com</td></tr>
  <tr><td>Jane</td><td>jane@example.com</td></tr>
  <tr><td>Bob</td><td>bob@example.com</td></tr>
</table>
</body></html>
`;

const EMPTY_PAGE = `<html><body><p>Nothing here</p></body></html>`;

const UK_TABLE = `
<html><body>
<table class="runs">
  <tr><td>1234</td><td>Wednesday 19th February 2026</td><td>Salty Dog</td><td>The Rusty Bucket, SW18 2SS</td></tr>
  <tr><td>1235</td><td>Wednesday 26th February 2026</td><td>Beer Me</td><td>The Fox, SE11 5JA</td></tr>
  <tr><td>1236</td><td>Wednesday 5th March 2026</td><td>Flash</td><td>The Swan, N1 9AA</td></tr>
</table>
</body></html>
`;

const DIV_CARDS = `
<html><body>
  <div class="event-card"><span class="date">March 15, 2026</span><span class="hare">Salty Dog</span></div>
  <div class="event-card"><span class="date">March 22, 2026</span><span class="hare">Beer Me</span></div>
  <div class="event-card"><span class="date">March 29, 2026</span><span class="hare">Flash</span></div>
  <div class="event-card"><span class="date">April 5, 2026</span><span class="hare">TBD</span></div>
</body></html>
`;

describe("findCandidateContainers", () => {
  it("finds a table with date-containing rows", () => {
    const $ = cheerio.load(TABLE_WITH_DATES);
    const candidates = findCandidateContainers($);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0].layoutType).toBe("table");
    expect(candidates[0].rowCount).toBeGreaterThanOrEqual(4);
    expect(candidates[0].sampleRows.length).toBeGreaterThanOrEqual(3);
  });

  it("uses table ID for containerSelector when available", () => {
    const $ = cheerio.load(TABLE_WITH_DATES);
    const candidates = findCandidateContainers($);
    expect(candidates[0].containerSelector).toBe("#hareline");
  });

  it("uses table class for containerSelector when no ID", () => {
    const $ = cheerio.load(UK_TABLE);
    const candidates = findCandidateContainers($);
    expect(candidates[0].containerSelector).toBe("table.runs");
  });

  it("detects tbody and uses 'tbody tr' row selector", () => {
    const $ = cheerio.load(TABLE_WITH_DATES);
    const candidates = findCandidateContainers($);
    expect(candidates[0].rowSelector).toBe("tbody tr");
  });

  it("uses 'tbody tr' row selector (Cheerio auto-inserts tbody)", () => {
    // Note: Cheerio auto-inserts <tbody> during parsing even when source HTML lacks it
    const $ = cheerio.load(UK_TABLE);
    const candidates = findCandidateContainers($);
    expect(candidates[0].rowSelector).toBe("tbody tr");
  });

  it("skips tables without date-like content", () => {
    const $ = cheerio.load(TABLE_WITHOUT_DATES);
    const candidates = findCandidateContainers($);
    expect(candidates).toHaveLength(0);
  });

  it("returns empty for pages with no containers", () => {
    const $ = cheerio.load(EMPTY_PAGE);
    const candidates = findCandidateContainers($);
    expect(candidates).toHaveLength(0);
  });

  it("finds repeating div cards with dates", () => {
    const $ = cheerio.load(DIV_CARDS);
    const candidates = findCandidateContainers($);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const divCandidate = candidates.find((c) => c.layoutType === "div-list");
    expect(divCandidate).toBeDefined();
    expect(divCandidate!.rowSelector).toContain("event-card");
  });

  it("limits candidates to 5", () => {
    // Build a page with many tables
    const tables = Array.from({ length: 10 }, (_, i) =>
      `<table id="t${i}"><tr><td>March ${i + 1}, 2026</td></tr><tr><td>April ${i + 1}, 2026</td></tr><tr><td>May ${i + 1}, 2026</td></tr></table>`,
    ).join("");
    const $ = cheerio.load(`<html><body>${tables}</body></html>`);
    const candidates = findCandidateContainers($);
    expect(candidates.length).toBeLessThanOrEqual(5);
  });

  it("recognizes UK ordinal date formats", () => {
    const $ = cheerio.load(UK_TABLE);
    const candidates = findCandidateContainers($);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
  });

  it("includes sample rows in candidate output", () => {
    const $ = cheerio.load(TABLE_WITH_DATES);
    const candidates = findCandidateContainers($);
    expect(candidates[0].sampleRows.length).toBeGreaterThan(0);
    // First sample row should have cell texts
    expect(candidates[0].sampleRows[0].length).toBeGreaterThan(0);
  });
});

// Test examples formatting
import { formatExamplesForPrompt, getExamplesForLayout, ADAPTER_EXAMPLES } from "@/adapters/html-scraper/examples";

describe("adapter examples", () => {
  it("has at least 5 examples", () => {
    expect(ADAPTER_EXAMPLES.length).toBeGreaterThanOrEqual(5);
  });

  it("includes all layout types", () => {
    const types = new Set(ADAPTER_EXAMPLES.map((e) => e.layoutType));
    expect(types.has("table")).toBe(true);
    expect(types.has("div-cards")).toBe(true);
    expect(types.has("article")).toBe(true);
  });

  it("getExamplesForLayout returns matching examples for table", () => {
    const examples = getExamplesForLayout("table");
    expect(examples.length).toBeGreaterThanOrEqual(2);
    expect(examples.every((e) => e.layoutType === "table")).toBe(true);
  });

  it("getExamplesForLayout falls back to mixed examples for unknown type", () => {
    const examples = getExamplesForLayout("unknown-type");
    expect(examples.length).toBeGreaterThanOrEqual(2);
  });

  it("formatExamplesForPrompt produces readable text", () => {
    const text = formatExamplesForPrompt(ADAPTER_EXAMPLES.slice(0, 2));
    expect(text).toContain("Example 1");
    expect(text).toContain("Example 2");
    expect(text).toContain("Container:");
    expect(text).toContain("Columns:");
  });
});
