import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as cheerio from "cheerio";
import { parseIH3Date, parseIH3Block, parseTrailLog } from "./ithaca-h3";

describe("parseIH3Date", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set "now" to March 14, 2026
    vi.setSystemTime(new Date(2026, 2, 14));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses Month Day format for upcoming date", () => {
    expect(parseIH3Date("March 15")).toBe("2026-03-15");
  });

  it("parses Month Day format for far future date", () => {
    expect(parseIH3Date("October 4")).toBe("2026-10-04");
  });

  it("bumps to next year when date is >30 days in the past", () => {
    expect(parseIH3Date("January 10")).toBe("2027-01-10");
  });

  it("keeps current year for recent past date (<30 days ago)", () => {
    expect(parseIH3Date("March 1")).toBe("2026-03-01");
  });

  it("returns null for unrecognized text", () => {
    expect(parseIH3Date("not a date")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseIH3Date("")).toBeNull();
  });
});

describe("parseIH3Block", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 14));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const sourceUrl = "http://ithacah3.org/hare-line/";

  it("parses a complete event block with no source title (default fallback)", () => {
    const html = `<p>
      <strong>#1119: March 15</strong><br>
      <strong>Hares:</strong> Flesh Flaps &amp; Spike<br>
      <span style="font-weight: 600;">Where</span>: <a href="https://www.google.com/maps/place/Flat+Rock/@42.44,-76.50,17z">Flat Rock</a><br>
      <span style="font-weight: 600;">When:</span> 2:00 pm<br>
      <span style="font-weight: 600;">Cost:</span> $5 (first timers free)<br>
      <span style="font-weight: 600;">Details</span>: <a href="http://ithacah3.org/trails/1119/">touch me</a>
    </p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(1119);
    expect(result!.date).toBe("2026-03-15");
    expect(result!.kennelTags[0]).toBe("ih3");
    // No source-published title → undefined; merge.ts synthesizes
    // "Ithaca H3 Trail #1119" via friendlyKennelName (#1344).
    expect(result!.title).toBeUndefined();
    expect(result!.hares).toBe("Flesh Flaps & Spike");
    expect(result!.startTime).toBe("14:00");
    expect(result!.cost).toBe("$5 (first timers free)");
    expect(result!.latitude).toBeCloseTo(42.44, 1);
    expect(result!.longitude).toBeCloseTo(-76.50, 1);
  });

  it("returns null for blocks without trail number", () => {
    const html = `<p><strong>Welcome to IH3!</strong> We run every other Sunday.</p>`;
    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);
    expect(result).toBeNull();
  });

  it("handles block without hares", () => {
    const html = `<p>
      <strong>#1120: March 29</strong><br>
      <span style="font-weight: 600;">Where</span>: Stewart Park<br>
      <span style="font-weight: 600;">When:</span> 3:00 pm<br>
    </p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(1120);
    expect(result!.date).toBe("2026-03-29");
    expect(result!.hares).toBeUndefined();
    expect(result!.startTime).toBe("15:00");
  });

  it("extracts detail page URL", () => {
    const html = `<p>
      <strong>#1121: April 12</strong><br>
      <span style="font-weight: 600;">Details</span>: <a href="http://ithacah3.org/trails/1121/">touch me</a>
    </p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.sourceUrl).toBe("http://ithacah3.org/trails/1121/");
  });

  it("splits location from concatenated labels (TBDWhen:)", () => {
    // When <br> tags are missing, labels run together in blockText:
    // "Where: TBDWhen: 2:00 pmCost: $5"
    const html = `<p>
      <strong>#1122: April 26</strong>
      <span style="font-weight: 600;">Where</span>: TBD<span style="font-weight: 600;">When:</span> 2:00 pm<span style="font-weight: 600;">Cost:</span> $5
    </p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(1122);
    expect(result!.date).toBe("2026-04-26");
    // The location should NOT contain "When:" or time data bleeding through
    // "TBDWhen: 2:00 pmCost: $5" should not be used as location
    if (result!.location) {
      expect(result!.location).not.toContain("When:");
      expect(result!.location).not.toContain("2:00");
      expect(result!.location).not.toContain("Cost:");
    }
  });

  // ---- #1123 regression: early-start trail must parse 12:00 not 2:00 ----
  it("parses 'When: 12:00 pm' when the <br> is inside the next <span> (#1123)", () => {
    vi.setSystemTime(new Date(2026, 4, 5)); // May 5, 2026 — #1123 is May 10
    const html = `<p><strong>#1123: May 10</strong> (—<em><mark>early start</mark></em>—)<br><strong>Hares:</strong> OTD<br><span style="font-weight: 600;">Where</span>: <a href="https://www.google.com/maps/place/Cayuga+Plaza/@42.482,-76.486,17z">Taco Bell, Cayuga Plaza</a><br><span style="font-weight: 600;">When:</span> 12:00 pm<span style="font-weight: 600;"><br>Cost:</span> $8 (first timers free)<span style="font-weight: 600;"><br>Details</span>: <a href="https://ithacah3.org/hash-1123/">see details</a></p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(1123);
    expect(result!.date).toBe("2026-05-10");
    expect(result!.startTime).toBe("12:00");
    expect(result!.cost).toBe("$8 (first timers free)");
    expect(result!.hares).toBe("OTD");
    expect(result!.location).toContain("Taco Bell");
  });

  // ---- #1344 regression: source-provided title must surface ----
  it("surfaces source-provided trail name from a non-label <strong> (#1344)", () => {
    vi.setSystemTime(new Date(2026, 4, 20));
    const html = `<p><strong>#1125: May 30</strong> (<em>—<mark>off-week trail</mark></em>–)<br><strong><mark>RAI</mark><mark>NB</mark><mark>OW </mark><mark>DRE</mark><mark>SS</mark> <mark>RUN</mark></strong><br><strong>Hares:</strong> Penguin<br><span style="font-weight: 600;">Where</span>: <a href="https://www.google.com/maps?q=Liquid+State">Liquid State</a><br><span style="font-weight: 600;">When:</span> 12:00 pm<span style="font-weight: 600;"><br>Cost:</span> $50<span style="font-weight: 600;"><br>Details</span>: <a href="https://hashrego.com/events/ih3-2nd-annual-rainbow-dress-run-for-charity">see details</a></p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(1125);
    expect(result!.date).toBe("2026-05-30");
    expect(result!.title).toBe("RAINBOW DRESS RUN");
    expect(result!.startTime).toBe("12:00");
    expect(result!.cost).toBe("$50");
    expect(result!.location).toBe("Liquid State");
  });

  it("leaves title undefined when only label strongs follow the header", () => {
    vi.setSystemTime(new Date(2026, 5, 1));
    const html = `<p><strong>#1126: June 7</strong><br><strong>Hares:</strong> TBD<br><span style="font-weight: 600;">Where</span>: TBD<br><span style="font-weight: 600;">When:</span> 2:00 pm<span style="font-weight: 600;"><br>Cost:</span> $7 (first timers free)<span style="font-weight: 600;"><br>Details</span>: TBD</p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.title).toBeUndefined();
    expect(result!.cost).toBe("$7 (first timers free)");
  });

  it("suppresses TBD cost", () => {
    const html = `<p><strong>#1130: July 12</strong><br><span style="font-weight: 600;">When:</span> 2:00 pm<span style="font-weight: 600;"><br>Cost:</span> TBD</p>`;
    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);
    expect(result).not.toBeNull();
    expect(result!.cost).toBeUndefined();
  });
});

describe("parseTrailLog", () => {
  const sourceUrl = "http://ithacah3.org/hair_line-trail_log/"; // NOSONAR — source has expired SSL

  it("parses a complete trail log row with title + location", () => {
    const html = `<p><strong>Hash #1097:</strong> Not at Grass Roots trail<br>2025-07-20; Mulholland Wildflower Preserve</p>`;
    const events = parseTrailLog(html, sourceUrl);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      runNumber: 1097,
      date: "2025-07-20",
      title: "Not at Grass Roots trail",
      location: "Mulholland Wildflower Preserve",
      kennelTags: ["ih3"],
      sourceUrl,
    });
  });

  it("handles rows without a title (empty between </strong> and <br>)", () => {
    const html = `<p><strong>Hash #1093:</strong> <br>2025-05-25; Hammond Hill</p>`;
    const events = parseTrailLog(html, sourceUrl);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBeUndefined();
    expect(events[0].date).toBe("2025-05-25");
    expect(events[0].location).toBe("Hammond Hill");
  });

  it("ignores the category class (event_W) but still emits the row", () => {
    const html = `<p class="event_W"><strong>Hash #1068:</strong> Fat-boy trail<br>2024-08-25; Camp Owahta</p>`;
    const events = parseTrailLog(html, sourceUrl);
    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(1068);
    expect(events[0].title).toBe("Fat-boy trail");
  });

  it("decodes HTML entities in titles and locations", () => {
    const html = `<p><strong>Hash #1086:</strong> Head&rsquo;s birthday trail!<br>2025-03-16; Lime Hollow</p>`;
    const events = parseTrailLog(html, sourceUrl);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Head’s birthday trail!");
  });

  it("emits duplicate rows verbatim (fingerprint dedup handles it)", () => {
    const html = `
      <p><strong>Hash #1083:</strong> Sledding for Groundhog Day<br>2025-02-02; Mundy Wildflower Garden, Cornell Plantations</p>
      <p><strong>Hash #1083:</strong> Sledding for Groundhog Day<br>2025-02-02; Mundy Wildflower Garden, Cornell Plantations</p>
    `;
    const events = parseTrailLog(html, sourceUrl);
    expect(events).toHaveLength(2);
  });

  it("ignores non-event paragraphs", () => {
    const html = `<p>Welcome to the Trail Log archive!</p><p><strong>Hash #1043:</strong> New Beers hash<br>2024-01-01; Lime Hollow</p>`;
    const events = parseTrailLog(html, sourceUrl);
    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(1043);
  });
});
