import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import {
  parseRunBlocks,
  parseDateFromBlock,
  parseHaresFromBlock,
  parseLocationFromBlock,
  parseTimeFromBlock,
  parseTitleFromBlock,
  parseLH3DetailPage,
  mergeLH3DetailIntoEvent,
  extractStationOnly,
} from "./london-hash";
import type { LH3DetailPageData } from "./london-hash";
import type { RawEventData } from "../types";
import { LondonHashAdapter } from "./london-hash";

/** Helper to call parseLH3DetailPage with cheerio loaded from HTML string. */
function parseDetail(html: string, url: string) {
  return parseLH3DetailPage(cheerio.load(html), html, url);
}

describe("parseDateFromBlock", () => {
  it("parses DD/MM/YYYY format", () => {
    expect(parseDateFromBlock("Saturday 21/02/2026")).toBe("2026-02-21");
  });

  it("parses ordinal with 'of' and year", () => {
    expect(parseDateFromBlock("Saturday 21st of February 2026")).toBe("2026-02-21");
  });

  it("parses ordinal with 'of' without year (uses reference date)", () => {
    expect(
      parseDateFromBlock("Saturday 21st of February", new Date(Date.UTC(2026, 0, 1))),
    ).toBe("2026-02-21");
  });

  it("parses ordinal without 'of'", () => {
    expect(parseDateFromBlock("Monday 22nd June 2026")).toBe("2026-06-22");
  });

  it("parses 1st", () => {
    expect(parseDateFromBlock("Saturday 1st March 2026")).toBe("2026-03-01");
  });

  it("parses 3rd", () => {
    expect(parseDateFromBlock("Saturday 3rd April 2026")).toBe("2026-04-03");
  });

  it("parses plain day number", () => {
    expect(parseDateFromBlock("15 January 2026")).toBe("2026-01-15");
  });

  it("returns null for invalid month", () => {
    expect(parseDateFromBlock("21st of Flibber 2026")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(parseDateFromBlock("")).toBeNull();
  });

  it("resolves year-less dates forward of reference date (live runlist behavior)", () => {
    // Live runlist rows omit the year — chrono must pick the next-future
    // occurrence (forwardDate semantics). Reference Jan 1 2026 + "6th of June"
    // → June 6 2026, not June 6 2025.
    const refJan2026 = new Date(Date.UTC(2026, 0, 1));
    expect(parseDateFromBlock("Saturday 6th of June", refJan2026)).toBe("2026-06-06");
    expect(parseDateFromBlock("Saturday 14th of February", refJan2026)).toBe("2026-02-14");
  });

  it("rolls year-less January date forward when scraped in late December", () => {
    // Year-end regression (Gemini + CodeRabbit reviews on PR #1682): a
    // December 2026 scrape sees "Saturday 10th of January" on runlist and
    // must resolve it to *next* January (2027), not the current-year past.
    const refLateDec = new Date(Date.UTC(2026, 11, 28)); // Dec 28 2026
    expect(parseDateFromBlock("Saturday 10th of January", refLateDec)).toBe(
      "2027-01-10",
    );
  });
});

describe("parseHaresFromBlock", () => {
  it("parses 'Hared by' with single hare", () => {
    expect(parseHaresFromBlock("Hared by Tuna Melt")).toBe("Tuna Melt");
  });

  it("parses 'Hared by' with multiple hares", () => {
    expect(parseHaresFromBlock("Hared by Tuna Melt and Opee")).toBe("Tuna Melt and Opee");
  });

  it("parses 'Hare:' format", () => {
    expect(parseHaresFromBlock("Hare: John Smith")).toBe("John Smith");
  });

  it("returns null for 'Hare required'", () => {
    expect(parseHaresFromBlock("Hared by Hare required")).toBeNull();
  });

  it("returns null for 'TBA'", () => {
    expect(parseHaresFromBlock("Hared by TBA")).toBeNull();
  });

  it("returns null when no hare info", () => {
    expect(parseHaresFromBlock("Some random text")).toBeNull();
  });

  it("trims text after asterisks", () => {
    expect(parseHaresFromBlock("Hared by Alice**extra notes")).toBe("Alice");
  });

  it("normalizes multiple consecutive spaces from inline element spacing", () => {
    // When inline elements produce extra spaces via .after(" ")
    expect(parseHaresFromBlock("Hared by Alice  Bob")).toBe("Alice Bob");
  });

  it("truncates boilerplate text concatenated with hare name", () => {
    expect(parseHaresFromBlock(
      "Hared by MouthwashUnlike hashes in other parts of the world, there is no need to pre-register for trails. Just turn up at the pub.open in Google Maps",
    )).toBe("Mouthwash");
  });

  it("truncates 'open in Google Maps' suffix", () => {
    expect(parseHaresFromBlock("Hared by Tuna Melt open in Google Maps")).toBe("Tuna Melt");
  });
});

describe("parseLocationFromBlock", () => {
  it("parses P-trail format with station and pub", () => {
    const result = parseLocationFromBlock(
      "Follow the P trail from Sydenham station to The Dolphin",
    );
    expect(result.station).toBe("Sydenham");
    expect(result.location).toBe("The Dolphin");
  });

  it("parses P trail format without 'station' keyword", () => {
    const result = parseLocationFromBlock(
      "Follow the P trail from Vauxhall to The Old Dairy",
    );
    expect(result.station).toBe("Vauxhall");
    expect(result.location).toBe("The Old Dairy");
  });

  it("parses Start: format", () => {
    const result = parseLocationFromBlock("Start: Victoria Park");
    expect(result.location).toBe("Victoria Park");
    expect(result.station).toBeUndefined();
  });

  it("returns empty for no location info", () => {
    const result = parseLocationFromBlock("Some random text");
    expect(result.location).toBeUndefined();
    expect(result.station).toBeUndefined();
  });

  it("filters 'to be announced' from P-trail pattern", () => {
    const result = parseLocationFromBlock(
      "Follow the P trail from Sydenham station to be announced",
    );
    expect(result.location).toBeUndefined();
    expect(result.station).toBe("Sydenham");
  });

  it("filters TBA location from P-trail pattern", () => {
    const result = parseLocationFromBlock(
      "Follow the P trail from Vauxhall to TBA",
    );
    expect(result.location).toBeUndefined();
    expect(result.station).toBe("Vauxhall");
  });

  it("filters TBA from Start: pattern", () => {
    const result = parseLocationFromBlock("Start: TBA");
    expect(result.location).toBeUndefined();
  });

  it("strips trailing description text from location", () => {
    const result = parseLocationFromBlock(
      "Follow the P trail from Clapham station to The Red Lion followed by dinner at the curry house",
    );
    expect(result.location).toBe("The Red Lion");
    expect(result.station).toBe("Clapham");
  });

  it("extracts station-only when no destination is given (live layout)", () => {
    // Live runlist `.runlistLoc` for a TBA-destination row contains just
    // "Follow the P trail from Rotherhithe station" — no "to PUB" clause.
    const result = parseLocationFromBlock(
      "Follow the P trail from Rotherhithe station",
    );
    expect(result.station).toBe("Rotherhithe");
    expect(result.location).toBeUndefined();
  });
});

describe("extractStationOnly (procedural fallback)", () => {
  it("captures the station name from `from X station`", () => {
    expect(extractStationOnly("Follow the P trail from Sydenham station")).toBe(
      "Sydenham",
    );
  });

  it("returns undefined when there's no `station` keyword", () => {
    expect(extractStationOnly("Follow the P trail from somewhere")).toBeUndefined();
  });

  it("returns undefined when the prefix is missing", () => {
    expect(extractStationOnly("Sydenham station is closed")).toBeUndefined();
  });

  it("rejects multi-line / star-polluted captures", () => {
    expect(extractStationOnly("from Some\nstation station")).toBeUndefined();
    expect(extractStationOnly("from *theme* station")).toBeUndefined();
  });
});

describe("parseTimeFromBlock", () => {
  it("parses '12 Noon for 12:30'", () => {
    expect(parseTimeFromBlock("12 Noon for 12:30")).toBe("12:00");
  });

  it("parses 'Noon'", () => {
    expect(parseTimeFromBlock("Noon")).toBe("12:00");
  });

  it("parses '7pm'", () => {
    expect(parseTimeFromBlock("7pm for 7:15")).toBe("19:00");
  });

  it("parses '7:00 PM'", () => {
    expect(parseTimeFromBlock("7:00 PM")).toBe("19:00");
  });

  it("parses '10:30 AM'", () => {
    expect(parseTimeFromBlock("10:30 AM")).toBe("10:30");
  });

  it("returns null for no time", () => {
    expect(parseTimeFromBlock("Some text")).toBeNull();
  });
});

describe("parseTitleFromBlock", () => {
  it("uses plain location heading as title", () => {
    expect(parseTitleFromBlock("Bromley South", 2834)).toBe("Bromley South");
  });

  it("strips ** wrappers from themed-run titles", () => {
    expect(
      parseTitleFromBlock("**Sweetheart's 4th of July Hash**", 2839),
    ).toBe("Sweetheart's 4th of July Hash");
  });

  it("strips stray leading ** on placeholders", () => {
    // Live source ships `"**To Be Announced"` (unmatched markdown) — the
    // sanitizer should strip the ** and recognize TBA → fall back to default.
    expect(parseTitleFromBlock("**To Be Announced", 2838)).toBe("London Hash Run #2838");
  });

  it("strips all ** markers and collapses spaces in combined location+theme headings", () => {
    expect(
      parseTitleFromBlock("Hampstead Heath **Sweetheart's 4th of July Hash**", 2839),
    ).toBe("Hampstead Heath Sweetheart's 4th of July Hash");
  });

  it.each([
    ["To Be Announced"],
    ["TBA"],
    ["tba"],
    ["TBD"],
    ["details to be announced"],
  ])("falls back to default for placeholder %s", (placeholder) => {
    expect(parseTitleFromBlock(placeholder, 2837)).toBe("London Hash Run #2837");
  });

  it("falls back to default for empty title", () => {
    expect(parseTitleFromBlock("", 2820)).toBe("London Hash Run #2820");
    expect(parseTitleFromBlock("   ", 2821)).toBe("London Hash Run #2821");
  });
});

// Sample HTML matching the actual londonhash.org/runlist.php structure
const SAMPLE_HTML = `
<html><body>
<div id="runListHolder">
  <div class="runListDetails">
    <div class="runlistRow titleRow">Sydneham</div>
    <div class="runlistRow">
      <div class="runlistCat runlistNo"><a href="nextrun.php?run=3840">2820</a></div>
      <div class="runlistDate">Saturday 21st of February 2026<br />12 Noon for 12:30 (3 days time)</div>
      <div class="runlistLoc">Follow the P trail from<br /> Sydenham station <br />to <a href="https://camra.org.uk/pubs/dolphin" target="_blank">The Dolphin</a></div>
      <div class="runlistHare">Hared by Tuna Melt and Opee</div>
    </div>
    <div class="runlistRow"><div class="runlistNote">** 50th Anniversary Special **</div></div>
  </div>
  <div class="runListDetails">
    <div class="runlistRow titleRow">Finsbury Park</div>
    <div class="runlistRow">
      <div class="runlistCat runlistNo"><a href="nextrun.php?run=3841">2821</a></div>
      <div class="runlistDate">Saturday 28th of February 2026<br />12 Noon for 12:30</div>
      <div class="runlistLoc">Follow the P trail from<br /> Finsbury Park <br />to The World's End</div>
      <div class="runlistHare">Hared by Captain Adventures</div>
    </div>
  </div>
  <div class="runListDetails">
    <div class="runlistRow titleRow">**To Be Announced</div>
    <div class="runlistRow">
      <div class="runlistCat runlistNo"><a href="nextrun.php?run=3842">2822</a></div>
      <div class="runlistDate">Saturday 7th March 2026<br />12 Noon for 12:30</div>
      <div class="runlistLoc">details to be announced</div>
      <div class="runlistHare">Hare required</div>
    </div>
  </div>
  <div class="runListDetails">
    <div class="runlistRow titleRow">Ealing Broadway</div>
    <div class="runlistRow">
      <div class="runlistCat runlistNo"><a href="nextrun.php?run=3843">2823</a></div>
      <div class="runlistDate">Monday 22nd June 2026<br />7pm for 7:15</div>
      <div class="runlistLoc">Follow the P trail from<br /> Ealing Broadway <br />to The Red Lion</div>
      <div class="runlistHare">Hared by Summer Runner</div>
    </div>
  </div>
</div>
</body></html>
`;

// Sample detail page mirroring the live nextrun.php structure — labels in
// `.runlistCat`, values in `.runlistDetail`. Includes the "What Else"
// section that historically bled into the hares field (issue #1606).
const SAMPLE_LH3_DETAIL_HTML = `
<html><head>
<script>
async function initMap() {
  const { Map } = await google.maps.importLibrary("maps");
  map = new Map(document.getElementById("mapId"), {
    center: { lat: 51.546173, lng: -0.178557 },
    zoom: 16,
  });
  const marker2 = new google.maps.Marker({
    position: { lat: 51.546173, lng: -0.178557 },
    title: "On Inn to The North Star",
  });
}
</script>
</head><body>
<div id="titleHolder">
  <h2 id="title">Finchley Road<br />Saturday 14th of March</h2>
</div>
<div id="nextRunDetailsHolder">
  <div class="nextRunlistRow"><div class="runlistCat">What</div><div class="runlistDetail">London hash number <span class="bold">2823</span></div></div>
  <div class="nextRunlistRow"><div class="runlistCat">Where</div><div class="runlistDetail">Follow the P trail from<br /> Finchley Road station <br />to The North Star</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">When</div><div class="runlistDetail">Saturday 14th of March at 12 Noon for 12:30 (5 days time)</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">How Far</div><div class="runlistDetail">The North Star is 113 meters from Finchley Road station as the Skylark flies</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">Who</div><div class="runlistDetail">Hared by Not Out and Big In Japan</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">What Else</div><div class="runlistDetail">Bring your hash cups as there may be a DS.</div></div>
</div>
<div id="mapOpenPrompt"><a href="http://maps.google.com/?q=51.546173,-0.178557">open in Google Maps</a></div>
</body></html>
`;

// Detail page for run #2820 (matches first run list block) — same structured layout.
const SAMPLE_LH3_DETAIL_HTML_2820 = `
<html><head>
<script>
async function initMap() {
  const { Map } = await google.maps.importLibrary("maps");
  map = new Map(document.getElementById("mapId"), {
    center: { lat: 51.427391, lng: -0.054509 },
  });
  const marker2 = new google.maps.Marker({
    position: { lat: 51.427391, lng: -0.054509 },
    title: "On Inn to The Dolphin",
  });
}
</script>
</head><body>
<div id="titleHolder"><h2 id="title">Sydenham<br />Saturday 21st of February</h2></div>
<div id="nextRunDetailsHolder">
  <div class="nextRunlistRow"><div class="runlistCat">What</div><div class="runlistDetail">London hash number <span class="bold">2820</span></div></div>
  <div class="nextRunlistRow"><div class="runlistCat">Where</div><div class="runlistDetail">Follow the P trail from Sydenham station to The Dolphin</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">When</div><div class="runlistDetail">Saturday 21st of February at 12 Noon for 12:30</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">How Far</div><div class="runlistDetail">The Dolphin is 85 metres from Sydenham station as the Skylark flies</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">Who</div><div class="runlistDetail">Hared by Tuna Melt and Opee</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">What Else</div><div class="runlistDetail">** 50th Anniversary Special **</div></div>
</div>
<div id="mapOpenPrompt"><a href="http://maps.google.com/?q=51.427391,-0.054509">open in Google Maps</a></div>
</body></html>
`;

// Placeholder detail page (TBA, default London center coords)
const SAMPLE_LH3_PLACEHOLDER_HTML = `
<html><head>
<script>
async function initMap() {
  const { Map } = await google.maps.importLibrary("maps");
  map = new Map(document.getElementById("mapId"), {
    center: { lat: 51.50797968105403, lng: -0.12793975804379443 },
    zoom: 13,
    mapTypeId: google.maps.MapTypeId.ROADMAP,
  });
}
</script>
</head><body>
<h1>Next Run to be Announced</h1>
<div id="mapId"></div>
</body></html>
`;

describe("parseRunBlocks", () => {
  it("splits page into structured per-field blocks", () => {
    const blocks = parseRunBlocks(SAMPLE_HTML);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(blocks[0].runNumber).toBe(2820);
    expect(blocks[0].runId).toBe("3840");
    expect(blocks[1].runNumber).toBe(2821);
    expect(blocks[2].runNumber).toBe(2822);
    expect(blocks[3].runNumber).toBe(2823);
  });

  it("extracts .titleRow content into titleText (per-field, not block-text)", () => {
    const blocks = parseRunBlocks(SAMPLE_HTML);
    expect(blocks[0].titleText).toBe("Sydneham");
    expect(blocks[1].titleText).toBe("Finsbury Park");
    expect(blocks[2].titleText).toBe("**To Be Announced");
    expect(blocks[3].titleText).toBe("Ealing Broadway");
  });

  it("extracts .runlistHare without bleeding into adjacent notes", () => {
    const blocks = parseRunBlocks(SAMPLE_HTML);
    expect(blocks[0].hareText).toContain("Tuna Melt and Opee");
    expect(blocks[0].hareText).not.toMatch(/anniversary|special|note/i);
    expect(blocks[1].hareText).toContain("Captain Adventures");
  });

  it("captures .runlistDate and .runlistLoc fields independently", () => {
    const blocks = parseRunBlocks(SAMPLE_HTML);
    expect(blocks[0].dateText).toContain("February");
    expect(blocks[0].locText).toContain("Sydenham");
    expect(blocks[0].locText).toContain("Dolphin");
  });

  it("captures .runlistNote paragraphs into noteTexts", () => {
    const blocks = parseRunBlocks(SAMPLE_HTML);
    // Sydenham block ships a single note "** 50th Anniversary Special **".
    expect(blocks[0].noteTexts.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0].noteTexts[0]).toContain("Anniversary");
  });
});

describe("parseLH3DetailPage", () => {
  it("extracts all fields from a structured detail page", () => {
    const detail = parseDetail(SAMPLE_LH3_DETAIL_HTML, "https://www.londonhash.org/nextrun.php?run=4092");
    expect(detail).not.toBeNull();
    expect(detail!.runNumber).toBe(2823);
    expect(detail!.title).toBe("Finchley Road");
    expect(detail!.latitude).toBeCloseTo(51.546173, 4);
    expect(detail!.longitude).toBeCloseTo(-0.178557, 4);
    expect(detail!.locationUrl).toBe("http://maps.google.com/?q=51.546173,-0.178557");
    expect(detail!.location).toBe("The North Star");
    expect(detail!.station).toBe("Finchley Road");
    expect(detail!.hares).toBe("Not Out and Big In Japan");
    expect(detail!.distance).toBe("113 meters from Finchley Road station as the Skylark flies");
    expect(detail!.onOn).toBe("The North Star");
    expect(detail!.sourceUrl).toBe("https://www.londonhash.org/nextrun.php?run=4092");
  });

  it("does NOT bleed 'What Else' label into hares (#1606)", () => {
    // Regression test: with the prior body-text-regex parser, the `Hared by K4`
    // value would over-consume into the next "What Else" section because divs
    // are siblings with no whitespace separator in the source HTML.
    const html = `
<html><body>
<div id="nextRunDetailsHolder">
  <div class="nextRunlistRow"><div class="runlistCat">What</div><div class="runlistDetail">London hash number 2833</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">Who</div><div class="runlistDetail">Hared by K4</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">What Else</div><div class="runlistDetail">Travel info: see TfL.</div></div>
</div>
</body></html>`;
    const detail = parseDetail(html, "https://www.londonhash.org/nextrun.php?run=4106");
    expect(detail).not.toBeNull();
    expect(detail!.hares).toBe("K4");
    expect(detail!.hares).not.toContain("What Else");
  });

  it("does NOT bleed travel-line into hares when 'What Else' section is absent (#1606)", () => {
    const html = `
<html><body>
<div id="nextRunDetailsHolder">
  <div class="nextRunlistRow"><div class="runlistCat">Who</div><div class="runlistDetail">Hared by Knickers</div></div>
</div>
<p>Travel details are yet to be announced</p>
</body></html>`;
    const detail = parseDetail(html, "https://www.londonhash.org/nextrun.php?run=4106");
    expect(detail).not.toBeNull();
    expect(detail!.hares).toBe("Knickers");
    expect(detail!.hares).not.toContain("Travel");
  });

  it("captures 'What Else' label content into detail.notes (#1606)", () => {
    // Source ships event-specific notes in the "What Else" section
    // (travel info, theme, anniversary marker). They should surface on
    // the detail object instead of being silently dropped.
    const html = `
<html><body>
<div id="nextRunDetailsHolder">
  <div class="nextRunlistRow"><div class="runlistCat">Who</div><div class="runlistDetail">Hared by Sweetheart</div></div>
  <div class="nextRunlistRow"><div class="runlistCat">What Else</div><div class="runlistDetail">Bring your hash cups as there may be a DS.</div></div>
</div>
</body></html>`;
    const detail = parseDetail(html, "https://www.londonhash.org/nextrun.php?run=4112");
    expect(detail).not.toBeNull();
    expect(detail!.notes).toBe("Bring your hash cups as there may be a DS.");
  });

  it("tolerates the live-site class typo (`runlistRow` missing the `next` prefix)", () => {
    // Verified on https://www.londonhash.org/nextrun.php?run=4108 — one row
    // ships `class="runlistRow"` instead of `class="nextRunlistRow"`.
    const html = `
<html><body>
<div id="nextRunDetailsHolder">
  <div class="nextRunlistRow"><div class="runlistCat">Who</div><div class="runlistDetail">Hared by Boy Blunder</div></div>
  <div class="runlistRow"><div class="runlistCat">What Else</div><div class="runlistDetail">Trail will be A to B</div></div>
</div>
</body></html>`;
    const detail = parseDetail(html, "https://www.londonhash.org/nextrun.php?run=4108");
    expect(detail).not.toBeNull();
    expect(detail!.hares).toBe("Boy Blunder");
  });

  it("returns null for placeholder/TBA pages", () => {
    const detail = parseDetail(SAMPLE_LH3_PLACEHOLDER_HTML, "https://www.londonhash.org/nextrun.php?run=4090");
    expect(detail).toBeNull();
  });

  it("filters default London center coordinates from JS", () => {
    // Page with JS coords at London center but no Maps link
    const html = `<html><head><script>
      map = new Map(el, { center: { lat: 51.508, lng: -0.128 }, zoom: 13 });
    </script></head><body>
    <div id="titleHolder"><h2 id="title">Some Run</h2></div>
    <div id="nextRunDetailsHolder">
      <div class="nextRunlistRow"><div class="runlistCat">What</div><div class="runlistDetail">London hash number 2825</div></div>
      <div class="nextRunlistRow"><div class="runlistCat">Where</div><div class="runlistDetail">Follow the P trail from Ealing Broadway station to The Red Lion</div></div>
      <div class="nextRunlistRow"><div class="runlistCat">Who</div><div class="runlistDetail">Hared by Pope</div></div>
    </div>
    </body></html>`;
    const detail = parseDetail(html, "https://www.londonhash.org/nextrun.php?run=4097");
    expect(detail).not.toBeNull();
    expect(detail!.latitude).toBeUndefined();
    expect(detail!.longitude).toBeUndefined();
    expect(detail!.locationUrl).toBeUndefined();
    // Other fields should still parse
    expect(detail!.runNumber).toBe(2825);
    expect(detail!.location).toBe("The Red Lion");
    expect(detail!.station).toBe("Ealing Broadway");
  });

  it("handles missing sections gracefully", () => {
    const html = `<html><body>
    <div id="titleHolder"><h2 id="title">Partial Run</h2></div>
    <p>London hash number 2830</p>
    </body></html>`;
    const detail = parseDetail(html, "https://www.londonhash.org/nextrun.php?run=9999");
    expect(detail).not.toBeNull();
    expect(detail!.runNumber).toBe(2830);
    expect(detail!.location).toBeUndefined();
    expect(detail!.hares).toBeUndefined();
    expect(detail!.latitude).toBeUndefined();
    expect(detail!.onOn).toBeUndefined();
  });

  it("extracts coords from JS marker when no Maps link present", () => {
    const html = `<html><head><script>
      const marker = new google.maps.Marker({
        position: { lat: 51.6, lng: -0.2 },
        title: "On Inn to The Crown",
      });
    </script></head><body>
    <div id="titleHolder"><h2 id="title">Test Run</h2></div>
    <p>London hash number 2840</p>
    </body></html>`;
    const detail = parseDetail(html, "https://www.londonhash.org/nextrun.php?run=5000");
    expect(detail).not.toBeNull();
    expect(detail!.latitude).toBeCloseTo(51.6, 4);
    expect(detail!.longitude).toBeCloseTo(-0.2, 4);
    expect(detail!.onOn).toBe("The Crown");
  });
});

describe("mergeLH3DetailIntoEvent", () => {
  const baseEvent: RawEventData = {
    date: "2026-03-14",
    kennelTags: ["lh3"],
    runNumber: 2823,
    title: "London Hash Run #2823",
    hares: "Run List Hare",
    location: "Run List Pub",
    startTime: "12:00",
    sourceUrl: "https://www.londonhash.org/nextrun.php?run=4092",
    description: "Nearest station: Some Station",
  };

  it("merges all detail fields into event", () => {
    const detail: LH3DetailPageData = {
      runNumber: 2823,
      latitude: 51.546173,
      longitude: -0.178557,
      location: "The North Star",
      station: "Finchley Road",
      hares: "Not Out and Big In Japan",
      distance: "113 meters from Finchley Road station as the Skylark flies",
      onOn: "The North Star",
      locationUrl: "http://maps.google.com/?q=51.546173,-0.178557",
      sourceUrl: "https://www.londonhash.org/nextrun.php?run=4092",
    };
    const merged = mergeLH3DetailIntoEvent(baseEvent, detail);
    expect(merged.latitude).toBeCloseTo(51.546173, 4);
    expect(merged.longitude).toBeCloseTo(-0.178557, 4);
    expect(merged.locationUrl).toBe("http://maps.google.com/?q=51.546173,-0.178557");
    expect(merged.location).toBe("The North Star");
    expect(merged.hares).toBe("Not Out and Big In Japan");
    expect(merged.description).toContain("Nearest station: Finchley Road");
    expect(merged.description).toContain("On-On: The North Star");
    expect(merged.description).toContain("Distance: 113 meters from Finchley Road station as the Skylark flies");
    // Preserved base fields
    expect(merged.date).toBe("2026-03-14");
    expect(merged.kennelTags[0]).toBe("lh3");
    expect(merged.startTime).toBe("12:00");
  });

  it("partial merge preserves base fields", () => {
    const detail: LH3DetailPageData = {
      location: "Detail Pub",
      sourceUrl: "https://www.londonhash.org/nextrun.php?run=4092",
    };
    const merged = mergeLH3DetailIntoEvent(baseEvent, detail);
    expect(merged.location).toBe("Detail Pub");
    expect(merged.hares).toBe("Run List Hare"); // preserved
    expect(merged.latitude).toBeUndefined(); // not in detail
    expect(merged.sourceUrl).toBe("https://www.londonhash.org/nextrun.php?run=4092");
  });

  it("does not set coords if only one is present", () => {
    const detail: LH3DetailPageData = {
      latitude: 51.5,
      sourceUrl: "https://www.londonhash.org/nextrun.php?run=4092",
    };
    const merged = mergeLH3DetailIntoEvent(baseEvent, detail);
    expect(merged.latitude).toBeUndefined();
    expect(merged.longitude).toBeUndefined();
  });

  it("preserves base station in description when detail lacks station", () => {
    const detail: LH3DetailPageData = {
      onOn: "The Crown",
      sourceUrl: "https://www.londonhash.org/nextrun.php?run=4092",
    };
    const merged = mergeLH3DetailIntoEvent(baseEvent, detail);
    expect(merged.description).toContain("Nearest station: Some Station");
    expect(merged.description).toContain("On-On: The Crown");
  });

  it("upgrades synthesized default title to detail-page title", () => {
    const detail: LH3DetailPageData = {
      title: "Finchley Road",
      sourceUrl: "https://www.londonhash.org/nextrun.php?run=4092",
    };
    const merged = mergeLH3DetailIntoEvent(baseEvent, detail);
    expect(merged.title).toBe("Finchley Road");
  });

  it("does NOT overwrite a real run-list title with detail-page title", () => {
    const detail: LH3DetailPageData = {
      title: "Different Title From Detail",
      sourceUrl: "https://www.londonhash.org/nextrun.php?run=4092",
    };
    const merged = mergeLH3DetailIntoEvent(
      { ...baseEvent, title: "Bromley South" }, // real title from run list
      detail,
    );
    expect(merged.title).toBe("Bromley South");
  });
});

describe("LondonHashAdapter.fetch", () => {
  it("parses sample HTML and emits per-block titles from .titleRow (no synthesized defaults)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }));
    fetchSpy.mockResolvedValue(new Response(SAMPLE_LH3_PLACEHOLDER_HTML, { status: 200 }));

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    expect(result.events.length).toBeGreaterThanOrEqual(3);
    expect(result.structureHash).toBeDefined();

    const first = result.events.find((e) => e.runNumber === 2820);
    expect(first).toBeDefined();
    expect(first!.title).toBe("Sydneham"); // from .titleRow, NOT synthesized "London Hash Run #2820"
    expect(first!.date).toBe("2026-02-21");
    expect(first!.kennelTags[0]).toBe("lh3");
    expect(first!.hares).toBe("Tuna Melt and Opee");
    expect(first!.location).toBe("The Dolphin");
    expect(first!.startTime).toBe("12:00");
    expect(first!.description).toContain("Nearest station: Sydenham");
    // Runlist `.runlistNote` content is now propagated into description
    // (per CodeRabbit review on PR #1682 — was previously discarded).
    expect(first!.description).toContain("Anniversary");
    expect(first!.sourceUrl).toContain("nextrun.php?run=3840");

    // Placeholder `**To Be Announced` title falls back to synthesized default.
    const placeholder = result.events.find((e) => e.runNumber === 2822);
    expect(placeholder).toBeDefined();
    expect(placeholder!.title).toBe("London Hash Run #2822");

    vi.restoreAllMocks();
  });

  it("enriches events from detail pages", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }));
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_LH3_DETAIL_HTML_2820, { status: 200 }));
    fetchSpy.mockResolvedValue(new Response(SAMPLE_LH3_PLACEHOLDER_HTML, { status: 200 }));

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    const enriched = result.events.find((e) => e.runNumber === 2820);
    expect(enriched).toBeDefined();
    expect(enriched!.latitude).toBeCloseTo(51.427391, 4);
    expect(enriched!.longitude).toBeCloseTo(-0.054509, 4);
    expect(enriched!.locationUrl).toBe("http://maps.google.com/?q=51.427391,-0.054509");
    expect(enriched!.description).toContain("On-On: The Dolphin");
    // Run-list title "Sydneham" preserved over detail "Sydenham" (different spelling — keep authoritative run-list copy)
    expect(enriched!.title).toBe("Sydneham");

    expect(result.diagnosticContext?.detailPagesEnriched).toBeGreaterThanOrEqual(1);

    vi.restoreAllMocks();
  });

  it("handles detail page fetch failures gracefully", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }));
    fetchSpy.mockRejectedValue(new Error("Detail fetch failed"));

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    expect(result.events.length).toBeGreaterThanOrEqual(3);
    expect(result.diagnosticContext?.detailPagesEnriched).toBe(0);

    vi.restoreAllMocks();
  });

  it("parses summer evening run with 7pm start", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }));
    fetchSpy.mockResolvedValue(new Response(SAMPLE_LH3_PLACEHOLDER_HTML, { status: 200 }));

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    const summer = result.events.find((e) => e.runNumber === 2823);
    expect(summer).toBeDefined();
    expect(summer!.startTime).toBe("19:00");
    expect(summer!.date).toBe("2026-06-22");

    vi.restoreAllMocks();
  });

  it("handles 'Hare required' gracefully", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }));
    fetchSpy.mockResolvedValue(new Response(SAMPLE_LH3_PLACEHOLDER_HTML, { status: 200 }));

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    const noHare = result.events.find((e) => e.runNumber === 2822);
    expect(noHare).toBeDefined();
    expect(noHare!.hares).toBeUndefined();

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("returns diagnostic context with detail page counts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }));
    fetchSpy.mockResolvedValue(new Response(SAMPLE_LH3_PLACEHOLDER_HTML, { status: 200 }));

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    expect(result.diagnosticContext).toHaveProperty("blocksFound");
    expect(result.diagnosticContext).toHaveProperty("eventsParsed");
    expect(result.diagnosticContext).toHaveProperty("fetchDurationMs");
    expect(result.diagnosticContext).toHaveProperty("detailPagesFetched");
    expect(result.diagnosticContext).toHaveProperty("detailPagesEnriched");

    vi.restoreAllMocks();
  });
});

// ── Inline element concatenation fix ──

describe("parseRunBlocks — inline element spacing", () => {
  it("inserts space between adjacent span elements to prevent concatenation", () => {
    const html = `
      <html><body>
      <div id="runListHolder">
        <div class="runListDetails">
          <div class="runlistRow titleRow">Test Heading</div>
          <div class="runlistRow">
            <div class="runlistCat runlistNo"><a href="nextrun.php?run=2285">2285</a></div>
            <div class="runlistDate">Saturday 22nd of February 2026<br />12 Noon</div>
            <div class="runlistHare">Hared by <span>Not Out and Big In Japan</span><span>What Else</span></div>
          </div>
        </div>
      </div>
      </body></html>
    `;
    const blocks = parseRunBlocks(html);
    expect(blocks).toHaveLength(1);
    // Hare names should be separated by space, not concatenated.
    expect(blocks[0].hareText).toContain("Not Out and Big In Japan");
    expect(blocks[0].hareText).not.toContain("JapanWhat");
  });
});
