import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  BaselHashAdapter,
  parseHarelineRow,
  parseDetailPage,
  parseRssNextRun,
  splitListHares,
  scrubContacts,
  buildBaselEvent,
} from "./basel-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({ generateStructureHash: vi.fn(() => "mock-hash-basel") }));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const fx = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
// Real pages curl'd 2026-11-18 from basel.harrier.eu.org (Maps API key redacted).
const HARELINE = fx("basel-hareline-2026-11-18.html.fixture");
const RUN_396 = fx("basel-run-396-2026-11-18.html.fixture");
const RUN_397 = fx("basel-run-397-2026-11-18.html.fixture");
const RUN_354 = fx("basel-run-354-2026-11-18.html.fixture");
const RSS = fx("basel-rss-2026-11-18.xml.fixture");

function source(): Source {
  return {
    id: "src-basel",
    name: "Basel-Stadt H3 Hareline",
    url: "https://basel.harrier.eu.org/hareline.php",
    type: "HTML_SCRAPER",
    config: { upcomingOnly: true, kennelTag: "bsh3-ch" },
    scrapeDays: 365,
  } as unknown as Source;
}

const ok = (body: string) =>
  ({ ok: true, status: 200, statusText: "OK", text: () => Promise.resolve(body) }) as Response;

function detail(html: string) {
  return parseDetailPage(html, cheerio.load(html));
}

describe("parseHarelineRow", () => {
  it("parses a plain row with two hares", () => {
    expect(parseHarelineRow("Run #396: 15/11/2026 Münchenstein Train Station (Chunder Woman/Against Nature)")).toEqual({
      runNumber: 396,
      date: "2026-11-15",
      location: "Münchenstein Train Station",
      hares: "Chunder Woman, Against Nature",
    });
  });

  it("takes the LAST parenthesised group as hares", () => {
    const r = parseHarelineRow("Run #385: 26/12/2025 Restaurant Alte Post (Basel) (LOskar)");
    expect(r?.location).toBe("Restaurant Alte Post (Basel)");
    expect(r?.hares).toBe("LOskar");
  });

  it("drops TBD venue and TBD hares", () => {
    const r = parseHarelineRow("Run #340: 19/06/2022 TBD (TBD)");
    expect(r).toEqual({ runNumber: 340, date: "2022-06-19", location: undefined, hares: undefined });
  });

  it("keeps ' / ' inside a single hare name", () => {
    expect(splitListHares("Out of Africa / Mausi/Meryl Strip")).toBe("Out of Africa / Mausi, Meryl Strip");
  });

  it("rejects impossible dates and non-run text", () => {
    expect(parseHarelineRow("Run #1: 31/02/1996 X (Y)")).toBeNull();
    expect(parseHarelineRow("12th Swiss Nash Hash")).toBeNull();
  });
});

describe("parseDetailPage", () => {
  it("reads time, hares (no write_mail leak) and description from #396", () => {
    const d = detail(RUN_396);
    expect(d.startTime).toBe("14:00");
    expect(d.hares).toBe("Chunder Woman, Against Nature");
    expect(d.description).toContain("Meeting Point: Münchenstein Train Station at 2pm");
    expect(d.description).not.toContain("Hares:");
    expect(d.latitude).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain("write_mail");
  });

  it("reads coordinates when present (#354)", () => {
    const d = detail(RUN_354);
    expect(d.latitude).toBeCloseTo(47.46771, 5);
    expect(d.longitude).toBeCloseTo(7.602961, 5);
    expect(d.startTime).toBe("15:00");
  });

  it("drops the placeholder hare and 'No run details available.' (#397)", () => {
    const d = detail(RUN_397);
    expect(d.hares).toBeUndefined();
    expect(d.description).toBeUndefined();
    expect(d.startTime).toBe("15:00");
  });
});

describe("scrubContacts", () => {
  it("removes e-mails and phone numbers in several formats", () => {
    const text = "Call 079 123 45 67 or 254-681-7657 or (254) 681-7657 or 5042311566 or a@b.ch now";
    const out = scrubContacts(text);
    expect(out).not.toMatch(/\d{4}/);
    expect(out).not.toContain("@");
  });
});

describe("parseRssNextRun", () => {
  it("parses the single feed item", () => {
    expect(parseRssNextRun(RSS)).toEqual({ runNumber: 397, date: "2026-12-13" });
  });
  it("returns null for a feed without a run title", () => {
    expect(parseRssNextRun("<rss><channel><item><title>Hello</title></item></channel></rss>")).toBeNull();
  });
});

describe("buildBaselEvent", () => {
  it("prefers detail hares and never sets title", () => {
    const e = buildBaselEvent({ runNumber: 5, date: "1996-03-01", hares: "A" }, { hares: "A, B", startTime: "14:00" });
    expect(e.hares).toBe("A, B");
    expect(e.title).toBeUndefined();
    expect(e.kennelTags).toEqual(["bsh3-ch"]);
  });
});

describe("BaselHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    mockedSafeFetch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  function route(map: Record<string, string>) {
    mockedSafeFetch.mockImplementation(async (url) => {
      const key = String(url);
      const body = map[key];
      if (body === undefined) throw new Error(`unexpected ${key}`);
      return ok(body);
    });
  }

  it("emits the recent window plus the RSS next-run placeholder", async () => {
    route({
      "https://basel.harrier.eu.org/hareline.php": HARELINE,
      "https://basel.harrier.eu.org/rss.php": RSS,
      "https://basel.harrier.eu.org/runs.php?run=394": RUN_396,
      "https://basel.harrier.eu.org/runs.php?run=395": RUN_396,
      "https://basel.harrier.eu.org/runs.php?run=396": RUN_396,
      "https://basel.harrier.eu.org/runs.php?run=397": RUN_397,
    });
    const result = await new BaselHashAdapter().fetch(source(), { days: 365 });
    expect(result.errors).toEqual([]);
    const runs = result.events.map((e) => e.runNumber).sort();
    expect(runs).toEqual([394, 395, 396, 397]);
    const next = result.events.find((e) => e.runNumber === 397)!;
    expect(next.date).toBe("2026-12-13");
    expect(next.startTime).toBe("15:00");
    expect(next.location).toBeUndefined();
    expect(next.hares).toBeUndefined();
    const e396 = result.events.find((e) => e.runNumber === 396)!;
    expect(e396.location).toBe("Münchenstein Train Station");
    expect(e396.sourceUrl).toBe("https://basel.harrier.eu.org/runs.php?run=396");
  });

  it("keeps list events when the RSS feed fails", async () => {
    mockedSafeFetch.mockImplementation(async (url) => {
      const key = String(url);
      if (key.endsWith("hareline.php")) return ok(HARELINE);
      if (key.endsWith("rss.php")) throw new Error("boom");
      return ok(RUN_396);
    });
    const result = await new BaselHashAdapter().fetch(source(), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events.length).toBe(3);
  });

  it("fails loud when the list collapses", async () => {
    route({ "https://basel.harrier.eu.org/hareline.php": "<ul><li><a title=\"Run #1\">Run #1: 13/01/1996 X (Y)</a></ul>" });
    const result = await new BaselHashAdapter().fetch(source(), { days: 365 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/markup drift/);
  });
});
