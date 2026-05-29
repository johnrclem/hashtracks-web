import { describe, it, expect } from "vitest";
import { parseCdxRows, extractBodyDate } from "./backfill-lbh-phx-history-completion";

const CDX = [
  "https://www.phoenixhhh.org/?event=lbh-511-krummy-wineburgers 20220405115701 200",
  "https://www.phoenixhhh.org/?event=lbh-512-chi-chi-fucked-up-my-hambone 20220220151554 200",
  // newer snapshot of the same slug — should win over the older one below
  "https://www.phoenixhhh.org/?event=lbh-512-chi-chi-fucked-up-my-hambone 20220101000000 200",
  "https://www.phoenixhhh.org/?event=lbh-637-its-all-coming-up-bi-holer 20230110120000 200",
  // non-numbered / meeting slugs must be dropped
  "https://www.phoenixhhh.org/?event=lbh-special-event 20220321154944 200",
  "https://www.phoenixhhh.org/?event=lbh3-mm-meeting 20220326174511 200",
  "https://www.phoenixhhh.org/?event=hump-d-hash-9 20220423053706 200",
].join("\n");

describe("parseCdxRows", () => {
  const snaps = parseCdxRows(CDX);

  it("keeps only real lbh-<N> slugs, deduped to the latest snapshot", () => {
    expect(snaps.map((s) => s.runNumber).sort((a, b) => a - b)).toEqual([511, 512, 637]);
  });

  it("picks the latest timestamp per slug", () => {
    const s512 = snaps.find((s) => s.runNumber === 512)!;
    expect(s512.timestamp).toBe("20220220151554");
  });

  it("derives the canonical phoenixhhh.org sourceUrl from the slug", () => {
    const s511 = snaps.find((s) => s.runNumber === 511)!;
    expect(s511.original).toBe("https://www.phoenixhhh.org/?event=lbh-511-krummy-wineburgers");
  });
});

describe("extractBodyDate", () => {
  it("reads the first MM/DD/YYYY from entry-content as UTC-noon date", () => {
    const html = `<article><div class="entry-content">
      <p>Date(s) - Monday - 05/25/20266:30 pm - 9:30 pm Location Backyards</p></div></article>`;
    expect(extractBodyDate(html)).toBe("2026-05-25");
  });

  it("returns null when no date is present (skip, never guess from snapshot ts)", () => {
    expect(extractBodyDate(`<div class="entry-content">no date here</div>`)).toBeNull();
  });

  it("rejects an out-of-range month", () => {
    expect(extractBodyDate(`<div class="entry-content">13/40/2026</div>`)).toBeNull();
  });
});
