import { describe, it, expect } from "vitest";
import {
  normalizeHares,
  parseLswArchiveBody,
} from "./backfill-lsw-h3-history";

describe("normalizeHares", () => {
  it("sorts comma-separated tokens deterministically", () => {
    expect(normalizeHares("Charlie, Alpha, Bravo")).toBe("Alpha, Bravo, Charlie");
  });

  it("preserves single-hare values verbatim", () => {
    expect(normalizeHares("Hopeless")).toBe("Hopeless");
  });

  it("returns undefined for empty / whitespace-only input", () => {
    expect(normalizeHares("")).toBeUndefined();
    expect(normalizeHares("   ")).toBeUndefined();
  });

  it("ignores trailing commas / empty tokens", () => {
    expect(normalizeHares("Hands Off The Rear, Octopussy, ")).toBe(
      "Hands Off The Rear, Octopussy",
    );
  });
});

/** Wrap rows in a minimal previousruns.htm-shaped table. */
function wrapTable(rows: string[]): string {
  return `<html><body><table><tr><td><p>DATE<td><p>RUN NO.<td><p>LOCATION<td><p>HARES<td><p>RUNNERS</tr>${rows.join("")}</table></body></html>`;
}

// Verbatim row shapes from `curl https://www.datadesignfactory.com/lsw/previousruns.htm`
// (May 2026 issue body capture).
const ROW_2598 = `<tr><td><p>20 May 26<td><p><a href="pages/LSW2598.htm">2598</a><td><p>Tiu Keng Leng<td><p>Ass Control Tower, Hand Solo<td><p>20</tr>`;
const ROW_2595 = `<tr><td><p>29 Apr 26<td><p><a href="pages/LSW2595.htm">2595</a><td><p>Anzac Day Run<td><p>Indyanus, Octopussy, Hands Off The Rear<td><p>35</tr>`;
const ROW_250_SEPT = `<tr><td><p>10 Sept 83<td><p>250</td><td><p>Frog & Toad cancelled Typhoon Ellen-Chung Hom Kok<td><p>Bob Lampard, Old Man Whithers<td><p></tr>`;
const ROW_100_FOUNDING_ERA = `<tr><td><p>17 Dec 80<td><p>100</td><td><p>Kowloon Reservoir<td><p><td><p></tr>`;
const ROW_NO_RUN_NUM = `<tr><td><p>23 Jan 91<td><p></td><td><p>Lockhart Road Playground<td><p><td><p></tr>`;
const ROW_BAD_DATE = `<tr><td><p>not a date<td><p>9999<td><p>Somewhere<td><p>Person<td><p>1</tr>`;

describe("parseLswArchiveBody", () => {
  it("parses a verbatim 2598 row with all fields", () => {
    const events = parseLswArchiveBody(wrapTable([ROW_2598]));
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.date).toBe("2026-05-20");
    expect(ev.kennelTags).toEqual(["lsw-h3"]);
    expect(ev.runNumber).toBe(2598);
    expect(ev.location).toBe("Tiu Keng Leng");
    // Hares are normalized — original "Ass Control Tower, Hand Solo" stays
    // alphabetical (Ass… before Hand…), no change.
    expect(ev.hares).toBe("Ass Control Tower, Hand Solo");
    expect(ev.description).toBe("Pack: 20");
    expect(ev.startTime).toBeUndefined();
    expect(ev.sourceUrl).toBe("https://www.datadesignfactory.com/lsw/pages/LSW2598.htm");
  });

  it("sorts hares deterministically across re-runs (fingerprint stability)", () => {
    // Row #2595 source order: "Indyanus, Octopussy, Hands Off The Rear".
    // Normalized alphabetical: "Hands Off The Rear, Indyanus, Octopussy".
    const events = parseLswArchiveBody(wrapTable([ROW_2595]));
    expect(events).toHaveLength(1);
    expect(events[0].hares).toBe("Hands Off The Rear, Indyanus, Octopussy");
  });

  it("accepts 4-char month names like 'Sept' (1983-era rows)", () => {
    const events = parseLswArchiveBody(wrapTable([ROW_250_SEPT]));
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("1983-09-10");
    expect(events[0].runNumber).toBe(250);
  });

  it("emits rows with no anchor or no hares (founding-era sparse data)", () => {
    const events = parseLswArchiveBody(wrapTable([ROW_100_FOUNDING_ERA]));
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("1980-12-17");
    expect(events[0].runNumber).toBe(100);
    expect(events[0].hares).toBeUndefined();
    // No anchor → sourceUrl falls back to the archive page.
    expect(events[0].sourceUrl).toBe("https://www.datadesignfactory.com/lsw/previousruns.htm");
    // No runner count → description undefined (not "Pack: 0").
    expect(events[0].description).toBeUndefined();
  });

  it("skips rows without a usable run number", () => {
    const events = parseLswArchiveBody(wrapTable([ROW_NO_RUN_NUM]));
    expect(events).toHaveLength(0);
  });

  it("skips rows with an unparseable date", () => {
    const events = parseLswArchiveBody(wrapTable([ROW_BAD_DATE]));
    expect(events).toHaveLength(0);
  });

  it("skips the header row (literal 'DATE' in first cell)", () => {
    const events = parseLswArchiveBody(wrapTable([])); // table has only the header row
    expect(events).toHaveLength(0);
  });

  it("partitions a mixed table — keeps good rows, drops malformed ones", () => {
    const events = parseLswArchiveBody(
      wrapTable([ROW_2598, ROW_BAD_DATE, ROW_NO_RUN_NUM, ROW_250_SEPT, ROW_100_FOUNDING_ERA]),
    );
    expect(events.map((e) => e.runNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([100, 250, 2598]);
  });
});
