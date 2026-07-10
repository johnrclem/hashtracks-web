import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import {
  parseMaconEntry,
  parseMaconTime,
  parseMaconLocation,
  parseMaconHares,
  MaconHashAdapter,
} from "./macon-hash";
import { fetchHTMLPage } from "../utils";
import type { Source } from "@/generated/prisma/client";

// Keep every real util helper; only stub the network fetch.
vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return { ...actual, fetchHTMLPage: vi.fn() };
});

const SOURCE = {
  id: "s",
  name: "MGH4 & W3H3 Next Hash",
  url: "https://mgh4.com/page/next-hash",
  type: "HTML_SCRAPER",
} as unknown as Source;

const SRC = "https://mgh4.com/page/next-hash";

// Real paragraph text as cheerio's .text() yields it (NBSP =  ).
const W3H3_TEXT =
  "W3H3 Wednesday,  October 29, 2025, Weedeater is laying a trail starting at Washington Park, Macon.  In at 6:30, out at 7.  Bring the usual stuff.  ";
const MGH4_TEXT =
  "MGH4, Saturday, July 19, 2025.  Weedeater's birthday trail.  Meet at 5650 Arkwright Rd.  Congregate at 1:30, out at 2.  Bring a chair and a bathing suit.";
const INTRO_TEXT =
  "Note: We are having trouble getting people to hare trails. The second someone steps up, the details will be posted here, so please check back often.";

describe("parseMaconTime", () => {
  it("prefers pack-off (out at) over gather and PM-normalizes", () => {
    expect(parseMaconTime("In at 6:30, out at 7")).toBe("19:00");
    expect(parseMaconTime("Congregate at 1:30, out at 2")).toBe("14:00");
  });
  it("falls back to gather time when there is no out time", () => {
    expect(parseMaconTime("In at 6:30. Bring stuff.")).toBe("18:30");
  });
});

describe("parseMaconLocation", () => {
  it("extracts the place after starting-at / meet-at", () => {
    expect(parseMaconLocation("starting at Washington Park, Macon. In at 6")).toBe(
      "Washington Park, Macon",
    );
    expect(parseMaconLocation("Meet at 5650 Arkwright Rd. Congregate at 1:30")).toBe(
      "5650 Arkwright Rd",
    );
  });
  it("does not truncate a mid-string abbreviation (St. / Rd.)", () => {
    expect(parseMaconLocation("Meet at St. Andrews Park. In at 6")).toBe(
      "St. Andrews Park",
    );
  });
  it("returns null for a placeholder phrase (clear stale venue) and undefined when absent", () => {
    expect(parseMaconLocation("Meet at TBA. In at 6")).toBeNull();
    expect(parseMaconLocation("Weedeater is laying a trail")).toBeUndefined();
  });
});

describe("parseMaconHares", () => {
  it("reads 'X is laying' and a leading possessive", () => {
    expect(parseMaconHares("Weedeater is laying a trail")).toBe("Weedeater");
    expect(parseMaconHares("Weedeater's birthday trail")).toBe("Weedeater");
  });
  it("captures a multi-hare list before 'are laying'", () => {
    expect(parseMaconHares("Weedeater and Hash Trash are laying a trail")).toBe(
      "Weedeater and Hash Trash",
    );
  });
});

describe("parseMaconEntry", () => {
  it("routes a W3H3 paragraph to w3h3-ga with full fields", () => {
    expect(parseMaconEntry(W3H3_TEXT, SRC)).toMatchObject({
      date: "2025-10-29",
      kennelTags: ["w3h3-ga"],
      startTime: "19:00",
      location: "Washington Park, Macon",
      hares: "Weedeater",
      sourceUrl: SRC,
    });
  });

  it("routes an MGH4 paragraph to mgh4 with full fields", () => {
    expect(parseMaconEntry(MGH4_TEXT, SRC)).toMatchObject({
      date: "2025-07-19",
      kennelTags: ["mgh4"],
      startTime: "14:00",
      location: "5650 Arkwright Rd",
      hares: "Weedeater",
    });
  });

  it("returns null for the non-run intro paragraph", () => {
    expect(parseMaconEntry(INTRO_TEXT, SRC)).toBeNull();
  });

  it("returns null for a labeled paragraph with no parseable date", () => {
    expect(parseMaconEntry("W3H3 hareline: when we have hares", SRC)).toBeNull();
  });
});

describe("MaconHashAdapter.fetch", () => {
  const okPage = (html: string) => ({
    ok: true as const,
    html,
    $: cheerio.load(html),
    structureHash: "hash123",
    fetchDurationMs: 5,
  });

  it("parses run paragraphs and ignores the intro, reporting diagnostics", async () => {
    const html = `
      <p>Note: we are having trouble getting hares.</p>
      <p><strong>W3H3 Wednesday, October 29, 2025,</strong> Weedeater is laying a trail starting at Washington Park, Macon. In at 6:30, out at 7.</p>
      <p><strong>MGH4, Saturday, July 19, 2025.</strong> Meet at 5650 Arkwright Rd. Congregate at 1:30, out at 2.</p>`;
    vi.mocked(fetchHTMLPage).mockResolvedValue(okPage(html));

    const res = await new MaconHashAdapter().fetch(SOURCE);

    expect(res.errors).toEqual([]);
    expect(res.events).toHaveLength(2);
    expect(res.events.map((e) => e.kennelTags[0])).toEqual(["w3h3-ga", "mgh4"]);
    expect(res.diagnosticContext).toMatchObject({
      fetchMethod: "cheerio",
      paragraphs: 3,
      eventsParsed: 2,
    });
  });

  it("returns the fetch failure result when the page fetch fails", async () => {
    const failure = {
      ok: false as const,
      result: {
        events: [],
        errors: ["fetch boom"],
        errorDetails: {},
        diagnosticContext: { fetchMethod: "cheerio" },
      },
    };
    vi.mocked(fetchHTMLPage).mockResolvedValue(failure);

    const res = await new MaconHashAdapter().fetch(SOURCE);
    expect(res).toBe(failure.result);
    expect(res.errors).toEqual(["fetch boom"]);
  });
});
