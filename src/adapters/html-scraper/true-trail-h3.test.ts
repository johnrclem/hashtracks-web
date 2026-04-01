import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseTrueTrailHeading, extractHares } from "./true-trail-h3";
import type { Source } from "@/generated/prisma/client";

// ── Unit tests for parseTrueTrailHeading ──

describe("parseTrueTrailHeading", () => {
  it("parses '#170 – Get Green'd Up Hash'", () => {
    const result = parseTrueTrailHeading("#170 – Get Green'd Up Hash");
    expect(result).toEqual({ runNumber: 170, title: "Get Green'd Up Hash" });
  });

  it("parses '#171 – Jesus Hash'", () => {
    const result = parseTrueTrailHeading("#171 – Jesus Hash");
    expect(result).toEqual({ runNumber: 171, title: "Jesus Hash" });
  });

  it("parses '#172 – 7th Analversary'", () => {
    const result = parseTrueTrailHeading("#172 – 7th Analversary");
    expect(result).toEqual({ runNumber: 172, title: "7th Analversary" });
  });

  it("parses heading with regular dash", () => {
    const result = parseTrueTrailHeading("#175 - Some Title");
    expect(result).toEqual({ runNumber: 175, title: "Some Title" });
  });

  it("returns null for Hare Line compact entries", () => {
    expect(parseTrueTrailHeading("Hare Line:")).toBeNull();
  });

  it("returns null for non-matching text", () => {
    expect(parseTrueTrailHeading("Random text")).toBeNull();
  });
});

// ── Unit tests for extractHares ──

describe("extractHares", () => {
  it("extracts 'Hares: Peppermint Meatrod, Tinder Tits'", () => {
    expect(extractHares("Hares: Peppermint Meatrod, Tinder Tits")).toBe("Peppermint Meatrod, Tinder Tits");
  });

  it("extracts singular 'Hare: Someone'", () => {
    expect(extractHares("Hare: Someone")).toBe("Someone");
  });

  it("returns undefined for 'Sexy Hares Needed'", () => {
    expect(extractHares("Hares: Sexy Hares Needed")).toBeUndefined();
  });

  it("returns undefined for non-hare text", () => {
    expect(extractHares("Some random text")).toBeUndefined();
  });
});

// ── Integration test with HTML fixture ──

// Fixture HTML must be defined before vi.mock factory references it
const FIXTURE_HTML = `
<div class="wp-block-group is-layout-constrained wp-block-group-is-layout-constrained">
<h2 class="nfd-text-xl nfd-text-balance wp-block-heading" style="font-style:normal;font-weight:600"><strong>Hare Line:</strong></h2>
<p class="">3/26 #170 &#8211; Get Green'd Up Hash</p>
<p class="">4/09 #171 &#8211; Jesus Hash</p>
<p class="">4/23 #172 &#8211; 7th Analversary</p>
<p class="">5/07 #173 &#8211; Dolly Parton Hash</p>

<div class="wp-block-group is-content-justification-left is-layout-constrained wp-container-core-group-is-layout-12dd3699 wp-block-group-is-layout-constrained">
<div class="wp-block-gutenverse-divider guten-element guten-divider guten-cJjlfz"><div class="guten-divider-wrapper"><div class="guten-divider-default guten-divider-line guten-divider-regular"></div></div></div>

<h2 class="nfd-text-xl nfd-text-balance wp-block-heading has-large-font-size" style="font-style:normal;font-weight:600"><strong>#1</strong>70 &#8211; Get Green&#8217;d Up Hash</h2>

<p class="has-text-align-left">March 26, 2026</p>
<p class="">Sherlock Holmes Pub Campus</p>
<p class="">8519 112 St</p>
<p class="">Hares: Peppermint Meatrod, Tinder Tits</p>
<p class="">St Patricks may be over but if you don't stop drinking did it ever really end?</p>
<p class="">Bring: Green clothing, Roach Clip</p>
<p class="">Shiggy: 1.69</p>
<p class="">Trail: A-A'</p>
<p class="has-text-align-left">Pack Gathers: 6:30<br>Hare Off: 6:45<br>On Out: 7:00<br>Hash Cash: $8<br>Pay Hash Cash by e-transfer to: Truetrailh3@gmail.com</p>

<div class="wp-block-gutenverse-divider guten-element guten-divider guten-QFWrXn"><div class="guten-divider-wrapper"><div class="guten-divider-default guten-divider-line guten-divider-regular"></div></div></div>

<h2 class="nfd-text-xl nfd-text-balance wp-block-heading has-large-font-size" style="font-style:normal;font-weight:600"><strong>#1</strong>71 &#8211; Jesus Hash</h2>

<p class="has-text-align-left">April 9, 2026</p>
<p class="">Hares: Cumming Of Christ</p>
<p class="">More Detrails to Cum!</p>
<p class="has-text-align-left">Pack Gathers: 6:30<br>Hare Off: 6:45<br>On Out: 7:00<br>Hash Cash: $8</p>

<div class="wp-block-gutenverse-divider guten-element guten-divider guten-26XL6O"><div class="guten-divider-wrapper"><div class="guten-divider-default guten-divider-line guten-divider-regular"></div></div></div>

<h2 class="nfd-text-xl nfd-text-balance wp-block-heading has-large-font-size" style="font-style:normal;font-weight:600"><strong>#1</strong>72 &#8211; 7th Analversary</h2>

<p class="has-text-align-left">April 23, 2026</p>
<p class="">Hares: Peppermint Meatrod</p>
<p class="">More Detrails to Cum!</p>
<p class="has-text-align-left">Pack Gathers: 6:30<br>Hare Off: 6:45<br>On Out: 7:00<br>Hash Cash: $8</p>

<div class="wp-block-gutenverse-divider guten-element guten-divider guten-sIYunK"><div class="guten-divider-wrapper"><div class="guten-divider-default guten-divider-line guten-divider-regular"></div></div></div>

<h2 class="nfd-text-xl nfd-text-balance wp-block-heading has-large-font-size" style="font-style:normal;font-weight:600"><strong>#1</strong>73 &#8211; Dolly Parton Hash </h2>

<p class="has-text-align-left">May 7, 2026</p>
<p class="">Hares: Screaming Wet Hole</p>
<p class="">More Detrails to Cum!</p>
<p class="has-text-align-left">Pack Gathers: 6:30<br>Hare Off: 6:45<br>On Out: 7:00<br>Hash Cash: $8</p>

</div>
</div>
`;

vi.mock("../utils", async () => {
  const actual = await vi.importActual("../utils");
  return {
    ...actual,
    fetchHTMLPage: vi.fn(),
  };
});

describe("TrueTrailH3Adapter", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const { fetchHTMLPage } = await import("../utils");
    const cheerio = await import("cheerio");
    vi.mocked(fetchHTMLPage).mockResolvedValue({
      ok: true,
      html: FIXTURE_HTML,
      $: cheerio.load(FIXTURE_HTML),
      structureHash: "test-hash",
      fetchDurationMs: 100,
    });
  });

  it("parses events from fixture HTML", async () => {
    const { TrueTrailH3Adapter } = await import("./true-trail-h3");
    const adapter = new TrueTrailH3Adapter();
    const source = {
      id: "test",
      url: "https://truetrailh3.com/",
      scrapeDays: 365,
    } as Source;

    const result = await adapter.fetch(source);

    expect(result.errors).toHaveLength(0);
    expect(result.events.length).toBeGreaterThanOrEqual(3);

    // First detailed event: #170
    const ev170 = result.events.find((e) => e.runNumber === 170);
    expect(ev170).toBeDefined();
    expect(ev170!.kennelTag).toBe("tth3-ab");
    expect(ev170!.title).toBe("Get Green\u2019d Up Hash");
    expect(ev170!.date).toBe("2026-03-26");
    expect(ev170!.hares).toBe("Peppermint Meatrod, Tinder Tits");
    expect(ev170!.location).toContain("Sherlock Holmes Pub Campus");
    expect(ev170!.locationStreet).toBe("8519 112 St");
    expect(ev170!.startTime).toBe("18:30");

    // #171 — Jesus Hash (minimal details)
    const ev171 = result.events.find((e) => e.runNumber === 171);
    expect(ev171).toBeDefined();
    expect(ev171!.title).toBe("Jesus Hash");
    expect(ev171!.date).toBe("2026-04-09");
    expect(ev171!.hares).toBe("Cumming Of Christ");

    // #172 — 7th Analversary
    const ev172 = result.events.find((e) => e.runNumber === 172);
    expect(ev172).toBeDefined();
    expect(ev172!.date).toBe("2026-04-23");
    expect(ev172!.hares).toBe("Peppermint Meatrod");
  });

  it("skips Hare Line summary (compact entries)", async () => {
    const { TrueTrailH3Adapter } = await import("./true-trail-h3");
    const adapter = new TrueTrailH3Adapter();
    const source = { id: "test", url: "https://truetrailh3.com/", scrapeDays: 365 } as Source;

    const result = await adapter.fetch(source);

    // Should not have duplicate events from the Hare Line summary
    const runNumbers = result.events.map((e) => e.runNumber);
    const unique = new Set(runNumbers);
    expect(runNumbers.length).toBe(unique.size);
  });
});
