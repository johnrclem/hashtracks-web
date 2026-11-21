import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import { BarbadosBikeHashAdapter, parseHareline, parseLine, readYearAnchor } from "./barbados-bike-hash";

vi.mock("../utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils")>()),
  fetchHTMLPage: vi.fn(),
}));
import { fetchHTMLPage } from "../utils";

/** Real hashcruise2020.simplesite.com/313623591 page captured 2026-11-19 (contact email redacted). */
const HTML = readFileSync(
  path.join(__dirname, "fixtures/barbados-bike-hash-hareline-2026-11-19.html.fixture"),
  "utf8",
);
const URL = "https://hashcruise2020.simplesite.com/313623591";

function wrap(lines: string[], heading = "BBH3 (BASH) 2026 - 2027"): string {
  const rows = lines.map((l) => `<p class="textnormal">${l}</p>`).join("");
  return `<div><h3 class="textheading3">${heading}</h3><p class="textnormal"><br></p>${rows}</div>`;
}

describe("parseLine", () => {
  it("reads date, hares and drops the ambiguous run number", () => {
    expect(parseLine("#106 Sunday December 20 - Slow Poke")).toEqual({
      month: 12, day: 20, weekday: 0, hares: "Slow Poke", title: undefined,
    });
  });

  it("reads a parenthetical theme as the title", () => {
    expect(parseLine("Sunday November 29 (60th Independence Ride)")).toMatchObject({
      month: 11, day: 29, title: "60th Independence Ride", hares: undefined,
    });
  });

  it("has no hares when the row ends at the date", () => {
    expect(parseLine("#107 Sunday January 31")).toMatchObject({ month: 1, day: 31, hares: undefined });
  });

  it("returns null for non-hareline lines", () => {
    expect(parseLine("Helmets are mandatory. BASH decals.")).toBeNull();
    expect(parseLine("Edited: 2026-11-02")).toBeNull();
    expect(parseLine("#106")).toBeNull();
    expect(parseLine("")).toBeNull();
  });
});

describe("Barbados Bike H3 live fixture", () => {
  const $ = cheerio.load(HTML);

  it("anchors the year on the list heading", () => {
    expect(readYearAnchor($)).toBe(2026);
  });

  it("parses all 14 rows as Sundays across the Dec→Jan roll", () => {
    const { events, errors } = parseHareline($, 2026, URL);
    expect(errors).toEqual([]);
    expect(events).toHaveLength(14);
    expect(events[0].date).toBe("2026-11-29");
    expect(events[1].date).toBe("2026-12-20");
    expect(events[2].date).toBe("2027-01-31");
    expect(events[13].date).toBe("2027-12-26");
    for (const e of events) {
      expect(new Date(`${e.date}T12:00:00Z`).getUTCDay()).toBe(0);
      expect(e.kennelTags).toEqual(["bbh3"]);
      expect(e.runNumber).toBeUndefined();
    }
  });

  it("decodes entities, keeps joint hares verbatim and only themes the special row", () => {
    const { events } = parseHareline($, 2026, URL);
    expect(events.find((e) => e.date === "2027-05-30")?.hares).toBe("Neil & John");
    expect(events[0].title).toBe("60th Independence Ride");
    expect(events.slice(1).every((e) => e.title === undefined)).toBe(true);
  });
});

describe("parseHareline edge cases", () => {
  it("skips and reports a row whose weekday does not match the date", () => {
    const $ = cheerio.load(wrap(["Sunday November 29", "#106 Sunday December 21 - X", "#107 Sunday January 31"]));
    const { events, errors } = parseHareline($, 2026, URL);
    expect(events.map((e) => e.date)).toEqual(["2026-11-29", "2027-01-31"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("does not match its printed weekday");
  });

  it("keeps a legitimate non-Sunday row whose weekday matches its date", () => {
    const $ = cheerio.load(wrap(["Sunday November 29", "Saturday December 19 - Special"]));
    const { events, errors } = parseHareline($, 2026, URL);
    expect(errors).toEqual([]);
    expect(events.map((e) => e.date)).toEqual(["2026-11-29", "2026-12-19"]);
  });

  it("does not shift the year when the skipped row has a lower month", () => {
    // Jan 4 2027 is a Monday, so the row is rejected; it must not roll the year for Dec 20.
    const $ = cheerio.load(wrap(["Sunday November 29", "Sunday January 4", "Sunday December 20"]));
    const { events, errors } = parseHareline($, 2026, URL);
    expect(errors).toHaveLength(1);
    expect(events.map((e) => e.date)).toEqual(["2026-11-29", "2026-12-20"]);
  });

  it("prefers the kennel heading over an unrelated heading year", () => {
    const $ = cheerio.load(`<h1>Hash Cruise 2020</h1><h3>BBH3 (BASH) 2026 - 2027</h3>`);
    expect(readYearAnchor($)).toBe(2026);
  });

  it("skips an impossible calendar date", () => {
    const $ = cheerio.load(wrap(["Sunday February 30"]));
    const { events, errors } = parseHareline($, 2026, URL);
    expect(events).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("applies the configured default start time", () => {
    const $ = cheerio.load(wrap(["Sunday November 29"]));
    expect(parseHareline($, 2026, URL, "06:00").events[0].startTime).toBe("06:00");
  });
});

describe("BarbadosBikeHashAdapter.fetch", () => {
  const source = { url: URL, scrapeDays: 450, config: { upcomingOnly: true, defaultStartTime: "06:00" } } as unknown as Source;

  function mockPage(html: string) {
    vi.mocked(fetchHTMLPage).mockResolvedValue({
      ok: true, $: cheerio.load(html), html, structureHash: "h", fetchDurationMs: 1,
    } as never);
  }

  it("emits the hareline inside the date window with the default start time", async () => {
    mockPage(HTML);
    const result = await new BarbadosBikeHashAdapter().fetch(source, { days: 3650 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(14);
    expect(result.events.every((e) => e.startTime === "06:00")).toBe(true);
  });

  it("ignores an invalid defaultStartTime", async () => {
    mockPage(HTML);
    const bad = { ...source, config: { defaultStartTime: "6am" } } as unknown as Source;
    const result = await new BarbadosBikeHashAdapter().fetch(bad, { days: 3650 });
    expect(result.events.every((e) => e.startTime === undefined)).toBe(true);
  });

  it("fails loud when the page has no hareline rows", async () => {
    mockPage(wrap(["Helmets are mandatory."]));
    const result = await new BarbadosBikeHashAdapter().fetch(source);
    expect(result.events).toEqual([]);
    expect(result.errors.join(" ")).toContain("no hareline rows");
  });

  it("fails loud when the year heading is missing", async () => {
    mockPage('<p class="textnormal">Sunday November 29</p>');
    const result = await new BarbadosBikeHashAdapter().fetch(source);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("no year");
  });
});
