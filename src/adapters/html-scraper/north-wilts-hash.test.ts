import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import { NorthWiltsHashAdapter, parseRunSheet, parseSheetDate, parseSheetTime } from "./north-wilts-hash";

vi.mock("../utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils")>()),
  fetchHTMLPage: vi.fn(),
}));
import { fetchHTMLPage } from "../utils";

/** Real nwh3.net run sheets captured 2026-11-05. */
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const SUNDAY = fixture("nwh3-runsheet-2026-11-05.html.fixture");
const MOON = fixture("nwh3-moonrakers-2026-11-05.html.fixture");

describe("parseSheetDate", () => {
  it("handles both sheet formats and weekday prefixes", () => {
    expect(parseSheetDate("08 November 2026 at 11am, run 2071")).toBe("2026-11-08");
    expect(parseSheetDate("04/11/26 at 7pm, run 757")).toBe("2026-11-04");
    expect(parseSheetDate("16/07/26 THURSDAY at 7pm, run 749")).toBe("2026-07-16");
    expect(parseSheetDate("SATURDAY 14 March 2026 at 10:30am, run 2050")).toBe("2026-03-14");
    expect(parseSheetDate("TBA")).toBeNull();
  });
});

describe("parseSheetTime", () => {
  it("handles the archive's time variants", () => {
    expect(parseSheetTime("at 11am, run 1")).toBe("11:00");
    expect(parseSheetTime("at 7.30pm, run 1")).toBe("19:30");
    expect(parseSheetTime("at 10:30am, run 1")).toBe("10:30");
    expect(parseSheetTime("at 12 noon, run 1")).toBe("12:00");
    expect(parseSheetTime("at 12noon, run 1")).toBe("12:00");
    expect(parseSheetTime(", coach leaves The Wyvern at 1pm, run 2059")).toBe("13:00");
    expect(parseSheetTime("at 7:00, run 1")).toBeUndefined();
  });
});

describe("parseRunSheet", () => {
  it("parses the Sunday sheet", () => {
    const rows = parseRunSheet(cheerio.load(SUNDAY), "nwh3", "u");
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({
      date: "2026-11-08",
      kennelTags: ["nwh3"],
      runNumber: 2071,
      startTime: "11:00",
      location: "The Barrington Arms",
      locationStreet: "Shrivenham, SN6 8AN",
      hares: "Babe & Utterly Butterly",
    });
    expect(rows[0].locationUrl).toContain("!3d51.598896!4d-1.65339");
    // TBA venue/address → undefined
    expect(rows.find((r) => r.runNumber === 2075)).toMatchObject({ location: undefined, locationStreet: undefined, hares: "Cybersex" });
    // A venue cell naming a run is the theme
    expect(rows.find((r) => r.runNumber === 2077)).toMatchObject({ title: "Xmas Jumper Run", location: undefined, locationStreet: "Bath" });
  });

  it("parses the Moonrakers sheet with FREE placeholders", () => {
    const rows = parseRunSheet(cheerio.load(MOON), "nwh3-moon", "u");
    expect(rows.map((r) => r.runNumber)).toEqual([757, 758, 759, 760, 761]);
    expect(rows[0]).toMatchObject({
      date: "2026-11-04",
      startTime: "19:00",
      location: "The Roaring Donkey",
      locationStreet: "6 Albert St, Old Town, Swindon, SN1 3HJ",
      hares: "Little Big Mouth",
    });
    expect(rows[2]).toMatchObject({ location: undefined, locationStreet: undefined, hares: undefined });
  });
});

describe("NorthWiltsHashAdapter.fetch", () => {
  const page = (html: string) => ({ ok: true, $: cheerio.load(html), html, structureHash: "h", fetchDurationMs: 1 }) as never;

  it("tags events with the configured kennel", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue(page(MOON));
    const source = { url: "https://nwh3.net/moonrakers.html", scrapeDays: 365, config: { kennelTag: "nwh3-moon" } } as unknown as Source;
    const result = await new NorthWiltsHashAdapter().fetch(source, { days: 3650 });
    expect(result.errors).toEqual([]);
    expect(result.events.every((e) => e.kennelTags[0] === "nwh3-moon")).toBe(true);
  });

  it("requires config.kennelTag", async () => {
    const source = { url: "https://nwh3.net/runsheet.html", config: {} } as unknown as Source;
    const result = await new NorthWiltsHashAdapter().fetch(source);
    expect(result.errors[0]).toContain("kennelTag is required");
  });

  it("fails loud on an empty sheet", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue(page("<div></div>"));
    const source = { url: "https://nwh3.net/runsheet.html", config: { kennelTag: "nwh3" } } as unknown as Source;
    const result = await new NorthWiltsHashAdapter().fetch(source);
    expect(result.errors[0]).toContain("0 runs parsed");
  });
});
