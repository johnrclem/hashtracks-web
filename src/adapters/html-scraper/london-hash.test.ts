import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import {
  parseRunBlocks,
  parseDateFromBlock,
  parseHaresFromBlock,
  parseLocationFromBlock,
  parseTimeFromBlock,
  parseLH3DetailPage,
  mergeLH3DetailIntoEvent,
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

  it("parses ordinal with 'of' without year (uses reference)", () => {
    expect(parseDateFromBlock("Saturday 21st of February", 2026)).toBe("2026-02-21");
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

// Sample detail page HTML (realistic, based on actual londonhash.org/nextrun.php structure)
const SAMPLE_LH3_DETAIL_HTML = `
<html><head>
<script>
async function initMap() {
  const { Map } = await google.maps.importLibrary("maps");
  map = new Map(document.getElementById("mapId"), {
    center: { lat: 51.546173, lng: -0.178557 },
    zoom: 16,
    mapTypeId: google.maps.MapTypeId.ROADMAP,
  });
  const marker1 = new google.maps.Marker({
    position: { lat: 51.546826, lng: -0.179815 },
    icon: "./images/train.png",
    title: "P trail from Finchley Road",
  });
  const marker2 = new google.maps.Marker({
    position: { lat: 51.546173, lng: -0.178557 },
    icon: "./images/beerbottle.png",
    title: "On Inn to The North Star",
  });
}
</script>
</head><body>
<h1>Finchley Road</h1>
<hr />
<p>London hash number 2823</p>
<hr />
<p>Follow the P trail from Finchley Road station to The North Star</p>
<hr />
<p>Saturday 14th of March at 12 Noon for 12:30 (5 days time)</p>
<hr />
<p>The North Star is 113 meters from Finchley Road station as the Skylark flies</p>
<hr />
<p>Hared by Not Out and Big In Japan</p>
<hr />
<p>Bring your hash cups as there may be a DS. Dogs welcome but must be kept on the lead.</p>
<hr />
<p><a href="http://maps.google.com/?q=51.546173,-0.178557">open in Google Maps</a></p>
<div id="mapId"></div>
</body></html>
`;

// Detail page with run number 2820 (matches first run list block)
const SAMPLE_LH3_DETAIL_HTML_2820 = `
<html><head>
<script>
async function initMap() {
  const { Map } = await google.maps.importLibrary("maps");
  map = new Map(document.getElementById("mapId"), {
    center: { lat: 51.427391, lng: -0.054509 },
    zoom: 16,
    mapTypeId: google.maps.MapTypeId.ROADMAP,
  });
  const marker1 = new google.maps.Marker({
    position: { lat: 51.427121, lng: -0.055213 },
    icon: "./images/train.png",
    title: "P trail from Sydenham",
  });
  const marker2 = new google.maps.Marker({
    position: { lat: 51.427391, lng: -0.054509 },
    icon: "./images/beerbottle.png",
    title: "On Inn to The Dolphin",
  });
}
</script>
</head><body>
<h1>Sydenham</h1>
<hr />
<p>London hash number 2820</p>
<hr />
<p>Follow the P trail from Sydenham station to The Dolphin</p>
<hr />
<p>Saturday 21st of February at 12 Noon for 12:30 (5 days time)</p>
<hr />
<p>The Dolphin is 85 metres from Sydenham station as the Skylark flies</p>
<hr />
<p>Hared by Tuna Melt and Opee</p>
<hr />
<p>** 50th Anniversary Special **</p>
<hr />
<p><a href="http://maps.google.com/?q=51.427391,-0.054509">open in Google Maps</a></p>
<div id="mapId"></div>
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
  it("splits page into run blocks", () => {
    const blocks = parseRunBlocks(SAMPLE_HTML);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(blocks[0].runNumber).toBe(2820);
    expect(blocks[0].runId).toBe("3840");
    expect(blocks[1].runNumber).toBe(2821);
    expect(blocks[2].runNumber).toBe(2822);
    expect(blocks[3].runNumber).toBe(2823);
  });

  it("captures text content for each block", () => {
    const blocks = parseRunBlocks(SAMPLE_HTML);
    expect(blocks[0].text).toContain("Sydenham");
    expect(blocks[0].text).toContain("Tuna Melt");
    expect(blocks[0].text).toContain("February");
  });
});

describe("parseLH3DetailPage", () => {
  it("extracts all fields from a full detail page", () => {
    const detail = parseDetail(SAMPLE_LH3_DETAIL_HTML, "https://www.londonhash.org/nextrun.php?run=4092");
    expect(detail).not.toBeNull();
    expect(detail!.runNumber).toBe(2823);
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

  it("returns null for placeholder/TBA pages", () => {
    const detail = parseDetail(SAMPLE_LH3_PLACEHOLDER_HTML, "https://www.londonhash.org/nextrun.php?run=4090");
    expect(detail).toBeNull();
  });

  it("filters default London center coordinates from JS", () => {
    // Page with JS coords at London center but no Maps link
    const html = `<html><head><script>
      map = new Map(el, { center: { lat: 51.508, lng: -0.128 }, zoom: 13 });
    </script></head><body>
    <h1>Some Run</h1>
    <p>London hash number 2825</p>
    <p>Follow the P trail from Ealing Broadway station to The Red Lion</p>
    <p>Hared by Pope</p>
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
    <h1>Partial Run</h1>
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

  it("extracts coords from JS when no Maps link present", () => {
    const html = `<html><head><script>
      const marker = new google.maps.Marker({
        position: { lat: 51.6, lng: -0.2 },
        title: "On Inn to The Crown",
      });
    </script></head><body>
    <h1>Test Run</h1>
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
    kennelTag: "LH3",
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
    expect(merged.kennelTag).toBe("LH3");
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
});

describe("LondonHashAdapter.fetch", () => {
  it("parses sample HTML and returns events", async () => {
    // Run list + 3 detail page fetches (first 3 blocks)
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }));
    // Detail pages return placeholder HTML for simplicity
    fetchSpy.mockResolvedValue(new Response(SAMPLE_LH3_PLACEHOLDER_HTML, { status: 200 }));

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    expect(result.events.length).toBeGreaterThanOrEqual(3);
    expect(result.structureHash).toBeDefined();

    // Check first event
    const first = result.events.find((e) => e.runNumber === 2820);
    expect(first).toBeDefined();
    expect(first!.date).toBe("2026-02-21");
    expect(first!.kennelTag).toBe("LH3");
    expect(first!.hares).toBe("Tuna Melt and Opee");
    expect(first!.location).toBe("The Dolphin");
    expect(first!.startTime).toBe("12:00");
    expect(first!.description).toContain("Nearest station: Sydenham");
    expect(first!.sourceUrl).toContain("nextrun.php?run=3840");

    vi.restoreAllMocks();
  });

  it("enriches events from detail pages", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // Run list page
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }));
    // First detail page (run 3840 → run number 2820) — enriched with matching fixture
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_LH3_DETAIL_HTML_2820, { status: 200 }));
    // Remaining detail pages — placeholder
    fetchSpy.mockResolvedValue(new Response(SAMPLE_LH3_PLACEHOLDER_HTML, { status: 200 }));

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    // The first event (2820) should be enriched from the detail page
    const enriched = result.events.find((e) => e.runNumber === 2820);
    expect(enriched).toBeDefined();
    expect(enriched!.latitude).toBeCloseTo(51.427391, 4);
    expect(enriched!.longitude).toBeCloseTo(-0.054509, 4);
    expect(enriched!.locationUrl).toBe("http://maps.google.com/?q=51.427391,-0.054509");
    expect(enriched!.description).toContain("On-On: The Dolphin");

    expect(result.diagnosticContext?.detailPagesEnriched).toBeGreaterThanOrEqual(1);

    vi.restoreAllMocks();
  });

  it("handles detail page fetch failures gracefully", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // Run list succeeds
    fetchSpy.mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }));
    // All detail pages fail
    fetchSpy.mockRejectedValue(new Error("Detail fetch failed"));

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    // Events from run list should still be present
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
    // Hare names should be separated by space, not concatenated
    expect(blocks[0].text).toContain("Not Out and Big In Japan");
    expect(blocks[0].text).not.toContain("JapanWhat");
  });
});
