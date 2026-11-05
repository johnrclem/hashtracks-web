import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  LarnacaHashAdapter,
  parseFutureLine,
  parseLarnacaDate,
  parseLarnacaPage,
  splitHares,
} from "./larnaca-hash";

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return { ...actual, fetchHTMLPage: vi.fn() };
});
import { fetchHTMLPage } from "../utils";
import * as cheerio from "cheerio";

const URL = "https://sites.google.com/view/larnaca-hash-house-harriers/next-run";
// Trimmed from the live NEXT RUN page (2026-11-05): current-run block + 4 of the
// 18 "Future Hares" lines (style attributes stripped, tab spans kept).
const LIVE_HTML = readFileSync(
  path.join(__dirname, "fixtures/larnaca-hash-next-run-2026-11-05.html.fixture"),
  "utf-8",
);

function mockPage(html: string) {
  vi.mocked(fetchHTMLPage).mockResolvedValue({
    ok: true,
    html,
    $: cheerio.load(html),
    structureHash: "h",
    fetchDurationMs: 1,
  });
}

describe("parseLarnacaDate", () => {
  it.each([
    ["09th Nov 26", "2026-11-09"],
    ["22nd Feb27", "2027-02-22"],
    ["07th Sept 26", "2026-09-07"],
    ["09th Nov 2026", "2026-11-09"],
    ["31st August 2026", "2026-08-31"],
  ])("%s → %s", (input, expected) => {
    expect(parseLarnacaDate(input)).toBe(expected);
  });
  it("rejects garbage", () => {
    expect(parseLarnacaDate("TBA")).toBeNull();
    expect(parseLarnacaDate("31st Feb 27")).toBeNull();
  });
});

describe("splitHares", () => {
  it("joins split cells and sorts", () => {
    expect(splitHares(["Sian the Sheep", "+", "Open Wide"])).toBe("Open Wide, Sian the Sheep");
    expect(splitHares(["Wet Dream and Doggy Style"])).toBe("Doggy Style, Wet Dream");
    expect(splitHares(["TBA"])).toBeUndefined();
  });
});

describe("parseFutureLine", () => {
  it("parses a tab-delimited run line with TBA venue", () => {
    expect(parseFutureLine("2092\t\t16th Nov 26\tBlow Job and Dora the Explorer\t\t\tTBA\t\tTBA", URL)).toEqual({
      date: "2026-11-16",
      kennelTags: ["lh3-cy"],
      runNumber: 2092,
      hares: "Blow Job, Dora the Explorer",
      location: undefined,
      sourceUrl: URL,
    });
  });
  it("ignores non-run lines and throws on a bad date", () => {
    expect(parseFutureLine("Google Sites", URL)).toBeNull();
    expect(() => parseFutureLine("2092\t\tsoon\tX\tTBA\tTBA", URL)).toThrow(/unparseable date/);
  });
});

describe("parseLarnacaPage", () => {
  it("parses the list and enriches the current run from the block", () => {
    const { events, foundList, parseErrors } = parseLarnacaPage(LIVE_HTML, URL);
    expect(foundList).toBe(true);
    expect(parseErrors).toEqual([]);
    expect(events.map((e) => [e.runNumber, e.date])).toEqual([
      [2091, "2026-11-09"],
      [2092, "2026-11-16"],
      [2106, "2027-02-22"],
      [2108, "2027-03-08"],
    ]);
    expect(events[0]).toMatchObject({
      hares: "Open Wide, Sian the Sheep",
      location: "Agia Napa Nature Reserve",
      startTime: "16:00",
      locationUrl: "https://what3words.com/bedbugs.differing.overcomes",
    });
    expect(events[1].location).toBeUndefined();
    expect(events[1].startTime).toBeUndefined();
    expect(events.every((e) => e.title === undefined)).toBe(true);
  });
});

describe("LarnacaHashAdapter.fetch", () => {
  const source = { url: URL, scrapeDays: 180 } as Source;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("returns windowed runs with no errors", async () => {
    mockPage(LIVE_HTML);
    const result = await new LarnacaHashAdapter().fetch(source, { days: 180 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(4);
  });

  it("fails loud when the Future Hares heading disappears", async () => {
    mockPage("<html><body><p>Page moved</p></body></html>");
    const result = await new LarnacaHashAdapter().fetch(source, { days: 180 });
    expect(result.errors[0]).toContain("heading not found");
  });

  it("fails loud on an empty list", async () => {
    mockPage("<html><body><p>Future Hares:-\tLocation</p><p>Google Sites</p></body></html>");
    const result = await new LarnacaHashAdapter().fetch(source, { days: 180 });
    expect(result.errors[0]).toContain("no runs parsed");
  });
});
