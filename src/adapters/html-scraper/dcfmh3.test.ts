import { parseDCFMH3Schedule, detectHostKennel, DCFMH3Adapter } from "./dcfmh3";

// Fixture mirrors the live Google Sites markup: each schedule entry is a
// <p><span>…</span></p> line. Includes a <script> JSON island (must be ignored),
// a duplicated "next trail" banner (dedup), and the real line shapes from #1399.
const SAMPLE_HTML = `
<html><head><title>DC Kennel Calendar</title></head><body>
<script type="application/json">{"July 31, 2026: Full Buck Moon - DCH3":"noise"}</script>
<div class="banner"><p dir="ltr"><span>Next Full Moon Trail</span></p>
<p dir="ltr"><span>June 27, 2026: Full Strawberry Moon - Hangover</span></p></div>
<div class="schedule">
  <p dir="ltr"><span>2026 Schedule</span></p>
  <p dir="ltr"><span>January 3, 2026: Smutty Crab H3</span></p>
  <p dir="ltr"><span>February 6, 2026: Full Snow Moon - EWH3 Hash Olympdicks Trail</span></p>
  <p dir="ltr"><span>March 6 - Worm Blood Moon OTH3</span></p>
  <p dir="ltr"><span>April 3, 2026: Full Pink Moon - White House H3</span></p>
  <p dir="ltr"><span>May 2, 2026: Full Flower Moon - Hillbilly H3</span></p>
  <p dir="ltr"><span>June 6-14: &iexcl;Tour Duh Hash!</span></p>
  <p dir="ltr"><span>June 27, 2026: Full Strawberry Moon - Hangover</span></p>
  <p dir="ltr"><span>July 31, 2026: Full Buck Moon - DCH3</span></p>
  <p dir="ltr"><span>August 28, 2026: Full Sturgeon Moon -Mount Vernon H3</span></p>
  <p dir="ltr"><span>September 26, 2026: Full Harvest Moon - Charm City</span></p>
  <p dir="ltr"><span>October 24, 2026: Full Hunter's Moon - DC Red Tent</span></p>
  <p dir="ltr"><span>November 24, 2026: Super Beaver Moon - Fredericksburg Urban H3</span></p>
  <p dir="ltr"><span>December 23, 2026: Super Cold Moon - DCH4</span></p>
  <p dir="ltr"><span>Some unrelated paragraph about hashing.</span></p>
</div>
</body></html>`;

describe("detectHostKennel (#1400)", () => {
  it.each([
    { title: "Full Buck Moon - DCH3", expected: "dch3" },
    { title: "Full Snow Moon - EWH3 Hash Olympdicks Trail", expected: "ewh3" },
    { title: "Super Cold Moon - DCH4", expected: "dch4" },
    { title: "Full Sturgeon Moon -Mount Vernon H3", expected: "mvh3" },
    { title: "Full Harvest Moon - Charm City", expected: "cch3" },
    { title: "Super Beaver Moon - Fredericksburg Urban H3", expected: "fuh3" },
    { title: "Full Strawberry Moon - Hangover", expected: "h4" },
  ])("maps '$title' → $expected", ({ title, expected }) => {
    expect(detectHostKennel(title)).toBe(expected);
  });

  it.each([
    "Smutty Crab H3",
    "Full Pink Moon - White House H3",
    "Full Flower Moon - Hillbilly H3",
    "Full Hunter's Moon - DC Red Tent",
    "¡Tour Duh Hash!",
  ])("returns undefined for unseeded host %s", (title) => {
    expect(detectHostKennel(title)).toBeUndefined();
  });

  it("does not match DCH3 inside DCFMH3", () => {
    expect(detectHostKennel("DCFMH3 Full Moon Run")).toBeUndefined();
  });
});

describe("parseDCFMH3Schedule (#1399)", () => {
  const entries = parseDCFMH3Schedule(SAMPLE_HTML, 2026);
  const byTitleStarts = (s: string) => entries.find((e) => e.title.startsWith(s));

  it("parses the published date verbatim (no lunar drift)", () => {
    expect(byTitleStarts("Full Buck Moon")?.date).toBe("2026-07-31");
    expect(byTitleStarts("Full Sturgeon Moon")?.date).toBe("2026-08-28");
    expect(byTitleStarts("Super Cold Moon")?.date).toBe("2026-12-23");
  });

  it("uses the verbatim source title (moon name + host)", () => {
    expect(byTitleStarts("Full Buck Moon")?.title).toBe("Full Buck Moon - DCH3");
  });

  it("handles the ' - ' separator + year-less row via fallback year", () => {
    const worm = byTitleStarts("Worm Blood Moon");
    expect(worm?.date).toBe("2026-03-06");
    expect(worm?.title).toBe("Worm Blood Moon OTH3");
  });

  it("takes the start date of a date range (June 6-14)", () => {
    const tour = entries.find((e) => e.title.includes("Tour Duh Hash"));
    expect(tour?.date).toBe("2026-06-06");
  });

  it("dedups the repeated banner entry", () => {
    const straw = entries.filter((e) => e.title === "Full Strawberry Moon - Hangover");
    expect(straw).toHaveLength(1);
  });

  it("ignores non-schedule paragraphs, headings, and the script island", () => {
    expect(entries.find((e) => e.title.includes("unrelated"))).toBeUndefined();
    expect(entries.find((e) => e.title === "Schedule")).toBeUndefined();
    expect(entries.find((e) => e.title === "Full Moon Trail")).toBeUndefined();
  });

  it("attaches host co-host codes where seeded", () => {
    expect(byTitleStarts("Full Buck Moon")?.hostKennelCode).toBe("dch3");
    expect(byTitleStarts("Smutty Crab")?.hostKennelCode).toBeUndefined();
  });
});

describe("DCFMH3Adapter", () => {
  it("has correct type", () => {
    expect(new DCFMH3Adapter().type).toBe("HTML_SCRAPER");
  });
});
