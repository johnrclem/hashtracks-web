import { describe, it, expect } from "vitest";
import { parseRecedingHareline } from "./backfill-upstate-h3-history";

// Mirrors the real Squarespace summary markup: each run is an <a> whose text is
// "M/D/YY #NNN Title", and every run renders twice (thumbnail link + title link).
const FIXTURE = `
<div class="summary-item">
  <a class="summary-thumbnail-container" href="/122-red-dress-2008">
    <img src="x.jpg">
    2/17/08 #122 Red Dress 2008
  </a>
  <a class="summary-title-link" href="/122-red-dress-2008">
    2/17/08 #122 Red Dress 2008
  </a>
</div>
<h2>2008 Photos</h2>
<div class="summary-item">
  <a class="summary-title-link" href="/123-cant-wait">
    3/2/08 #123 Can't Wait Til Summer Hash
  </a>
</div>
<div class="summary-item">
  <a class="summary-title-link" href="/334-lbd">
    5/22/16 #334 Little Black Dress
  </a>
</div>
<a href="/about">About Us</a>
`;

describe("parseRecedingHareline", () => {
  it("parses M/D/YY #NNN Title rows into RawEventData (UTC-noon date string, run#, title)", () => {
    const events = parseRecedingHareline(FIXTURE);
    expect(events).toEqual([
      { date: "2008-02-17", runNumber: 122, title: "Red Dress 2008", kennelTags: ["uh3"] },
      { date: "2008-03-02", runNumber: 123, title: "Can't Wait Til Summer Hash", kennelTags: ["uh3"] },
      { date: "2016-05-22", runNumber: 334, title: "Little Black Dress", kennelTags: ["uh3"] },
    ]);
  });

  it("dedups the twice-rendered run (thumbnail + title link) by run number", () => {
    const events = parseRecedingHareline(FIXTURE);
    expect(events.filter((e) => e.runNumber === 122)).toHaveLength(1);
  });

  it("ignores non-run links and section headers", () => {
    const events = parseRecedingHareline(FIXTURE);
    expect(events.every((e) => typeof e.runNumber === "number")).toBe(true);
    expect(events.map((e) => e.title)).not.toContain("About Us");
  });

  it("maps two-digit years to 2008–2016 (20YY)", () => {
    const events = parseRecedingHareline(FIXTURE);
    expect(events[0].date.startsWith("2008-")).toBe(true);
    expect(events[2].date.startsWith("2016-")).toBe(true);
  });
});
