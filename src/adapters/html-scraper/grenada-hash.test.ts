import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  GrenadaHashAdapter,
  applyNextHash,
  parseGrenadaDate,
  parseGrenadaSchedule,
  parseNextHash,
  splitHares,
} from "./grenada-hash";

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return { ...actual, fetchHTMLPage: vi.fn() };
});
import { fetchHTMLPage } from "../utils";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
// Trimmed from the live grenadahash.com pages (2026-11-05).
const SCHEDULE = fixture("grenada-hash-schedule-2026-11-05.html.fixture");
const NEXT_HASH = fixture("grenada-hash-next-hash-2026-11-05.html.fixture");

const page = (html: string) => ({ ok: true as const, html, $: cheerio.load(html), structureHash: "h", fetchDurationMs: 1 });

describe("helpers", () => {
  it("parses dates", () => {
    expect(parseGrenadaDate("29 Aug 2026")).toBe("2026-08-29");
    expect(parseGrenadaDate("7th November 2026")).toBe("2026-11-07");
    expect(parseGrenadaDate("31 Feb 2027")).toBeNull();
  });
  it("splits hares and drops quotes/placeholders", () => {
    expect(splitHares("Bag o Shit, Feckless Father & Poke ma hole")).toBe("Bag o Shit, Feckless Father, Poke ma hole");
    expect(splitHares("“Bling Ting”")).toBe("Bling Ting");
    expect(splitHares("")).toBeNull();
  });
});

describe("parseGrenadaSchedule", () => {
  it("parses rows, themes as titles, and TBA/blank as explicit clears", () => {
    const { events, parseErrors, tableFound } = parseGrenadaSchedule(SCHEDULE);
    expect(tableFound).toBe(true);
    expect(parseErrors).toEqual([]);
    expect(events.map((e) => [e.runNumber, e.date])).toEqual([
      [1414, "2026-08-29"], [1419, "2026-10-03"], [1423, "2026-10-31"],
      [1424, "2026-11-07"], [1427, "2026-11-28"], [1440, "2027-02-27"],
    ]);
    expect(events[1]).toMatchObject({ title: "Carriacou Hash", location: "Carriacou" });
    expect(events[2].title).toBe("Halloween Hash");
    expect(events[4]).toMatchObject({ location: null, hares: "No Split" });
    expect(events[5]).toMatchObject({ location: null, hares: null, title: undefined });
  });
});

describe("parseNextHash", () => {
  it("reads the labelled block, the plain-text maps link and the On On time", () => {
    expect(parseNextHash(NEXT_HASH)).toEqual({
      runNumber: 1424,
      location: "Grand Mal Playing Field, St George",
      locationUrl: "https://maps.app.goo.gl/2PGL9GPmfQsNVdZp9",
      date: "2026-11-07",
      startTime: "15:30",
      hares: "Bling Ting",
    });
  });
  it("overlays onto the matching schedule row", () => {
    const { events } = parseGrenadaSchedule(SCHEDULE);
    applyNextHash(events, parseNextHash(NEXT_HASH));
    expect(events[3]).toMatchObject({ location: "Grand Mal Playing Field, St George", startTime: "15:30" });
    expect(events[2].startTime).toBeUndefined();
  });
});

describe("GrenadaHashAdapter.fetch", () => {
  const source = { url: "https://grenadahash.com/schedule/" } as Source;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("sends a browser UA and keeps schedule rows when next-hash fails", async () => {
    vi.mocked(fetchHTMLPage)
      .mockResolvedValueOnce(page(SCHEDULE))
      .mockResolvedValueOnce({ ok: false, result: { events: [], errors: ["HTTP 500"] } });
    const result = await new GrenadaHashAdapter().fetch(source, { days: 180 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(6);
    expect(vi.mocked(fetchHTMLPage).mock.calls[0][1]?.userAgent).toContain("Mozilla/5.0 (Macintosh");
  });

  it("fails loud when the table is gone", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue(page("<div class='entry-content'><p>Moved</p></div>"));
    const result = await new GrenadaHashAdapter().fetch(source, { days: 180 });
    expect(result.errors[0]).toContain("schedule table not found");
  });
});
