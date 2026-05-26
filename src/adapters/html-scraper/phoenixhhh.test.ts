import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  fetchEventDetail,
  buildMonthFormData,
  parseEventFromItem,
  PHOENIX_HARE_PATTERNS,
  PhoenixHHHAdapter,
  extractVenueFromDescription,
} from "./phoenixhhh";
import { extractHashRunNumber } from "../utils";
import { extractHares } from "../hare-extraction";

// ── Sample HTML fixtures ──

const SAMPLE_EVENT_WITH_IMAGE = `
<div class="em-item em-event">
  <div class="em-item-image">
    <img src="/img/lbh-run.jpg" alt="Lost Boobs Hash #452 Run to the Hills" />
  </div>
  <div class="em-item-meta-line em-event-date">Monday - 03/02/2026</div>
  <div class="em-item-meta-line em-event-time">6:30 pm - 9:30 pm</div>
  <div class="em-item-meta-line em-event-location"><a href="/venues/downtown-park">Downtown Park</a></div>
  <div class="em-item-desc">
    <p>Hare: Toe Jam &amp; Earl</p>
    <p>Hash Cash: $5</p>
    <p>Trail is A to B, 4-5 miles.</p>
  </div>
  <a class="em-item-read-more" href="https://www.phoenixhhh.org/?event=lost-boobs-hash-452-run-to-the-hills">Read More</a>
</div>`;

const SAMPLE_EVENT_NO_IMAGE = `
<div class="em-item em-event">
  <div class="em-item-image has-placeholder"></div>
  <div class="em-item-meta-line em-event-date">Wednesday - 03/04/2026</div>
  <div class="em-item-meta-line em-event-time">6:30 pm - 8:30 pm</div>
  <div class="em-item-meta-line em-event-location"><a href="/venues/tempe-park">Tempe Town Lake Park</a></div>
  <div class="em-item-desc">
    <p>Hares: Quick Draw &amp; Slippery When Wet</p>
  </div>
  <a class="em-item-read-more" href="https://www.phoenixhhh.org/?event=hump-d-hash-3-4-roses-by-the-stairs">Read More</a>
</div>`;

const SAMPLE_EVENT_WRONG_WAY = `
<div class="em-item em-event">
  <div class="em-item-image">
    <img src="/img/ww.jpg" alt="Wrong Way Hash Saturday Run" />
  </div>
  <div class="em-item-meta-line em-event-date">Saturday - 03/07/2026</div>
  <div class="em-item-meta-line em-event-time">2:00 pm - 5:00 pm</div>
  <div class="em-item-meta-line em-event-location"><a href="/venues/papago">Papago Park</a></div>
  <div class="em-item-desc">
    <p>Hare: Desert Rat</p>
  </div>
  <a class="em-item-read-more" href="https://www.phoenixhhh.org/?event=wrong-way-hash-saturday-run">Read More</a>
</div>`;

const SAMPLE_EVENT_FDTDD = `
<div class="em-item em-event">
  <div class="em-item-image">
    <img src="/img/fdtdd.jpg" alt="FDTDD March Night Run" />
  </div>
  <div class="em-item-meta-line em-event-date">Friday - 03/13/2026</div>
  <div class="em-item-meta-line em-event-time">7:00 pm - 11:00 pm</div>
  <div class="em-item-meta-line em-event-location"><a href="/venues/south-mtn">South Mountain</a></div>
  <div class="em-item-desc">
    <p>This is the FDTDD monthly night hash.</p>
  </div>
  <a class="em-item-read-more" href="https://www.phoenixhhh.org/?event=fdtdd-march-night-run">Read More</a>
</div>`;

const SAMPLE_EVENT_NO_DATE = `
<div class="em-item em-event">
  <div class="em-item-image has-placeholder"></div>
  <div class="em-item-meta-line em-event-date">TBD</div>
  <div class="em-item-meta-line em-event-time">6:30 pm</div>
  <div class="em-item-desc"><p>Coming soon!</p></div>
  <a class="em-item-read-more" href="https://www.phoenixhhh.org/?event=tbd-event">Read More</a>
</div>`;

// Multi-day event with a long-form date range (#1473 — Annual Whiskey Row
// Hash Campout shape on the live calendar). The adapter must take the FIRST
// embedded MM/DD/YYYY, which is the event start date — handing the full
// range string to chrono would be ambiguous.
const SAMPLE_EVENT_MULTI_DAY = `
<div class="em-item em-event">
  <div class="em-item-image"></div>
  <div class="em-item-info">
    <div class="em-item-name"><a href="https://www.phoenixhhh.org/?event=campout">Annual Campout</a></div>
    <div class="em-item-meta">
      <div class="em-item-meta-line em-event-date">Thursday - 04/30/2026 - Sunday - 05/03/2026</div>
      <div class="em-item-meta-line em-event-time">2:00 pm</div>
    </div>
    <a class="em-item-read-more" href="https://www.phoenixhhh.org/?event=campout">Read More</a>
  </div>
</div>`;

// Live HTML captured from the Events Manager calendar (#1473). The plugin
// renders some events in the compact `D MMM YY` row form instead of the
// long `Weekday - MM/DD/YYYY` form. Prior to the fix, half of every month's
// grid failed `Could not extract date from event item` parse errors.
const SAMPLE_EVENT_COMPACT_DATE = `
<div class="em-item em-event">
  <div class="em-item-image has-placeholder">
    <div class="em-item-image-placeholder">
      <div class="date"><span class="day">27</span><span class="month">Apr</span></div>
    </div>
  </div>
  <div class="em-item-info">
    <div class="em-item-name"><a href="https://www.phoenixhhh.org/?event=lbh-741">LBH #741</a></div>
    <div class="em-item-meta">
      <div class="em-item-meta-line em-event-date em-event-meta-datetime"><span class="em-icon em-icon-calendar"></span><span>27 Apr 26</span></div>
      <div class="em-item-meta-line em-event-time"><span>6:30 pm</span></div>
      <div class="em-item-meta-line em-event-location em-event-meta-location"><a href="https://maps.google.com/?q=Groggys">Groggy's</a></div>
    </div>
    <div class="em-item-desc">Join us for the 741st running of LBH! Hare: Crayon.</div>
    <a class="em-item-read-more" href="https://www.phoenixhhh.org/?event=lbh-741">More Info</a>
  </div>
</div>`;

const DEFAULT_CONFIG = {
  kennelPatterns: [
    ["^LBH\\b|Lost Boobs", "LBH"],
    ["Hump D", "Hump D"],
    ["Wrong Way", "Wrong Way"],
    ["Dusk.*Down|FDTDD", "FDTDD"],
  ] as [string, string][],
  defaultKennelTag: "Wrong Way",
};

function makeCompiledPatterns(config: typeof DEFAULT_CONFIG) {
  return config.kennelPatterns.map(([pattern, tag]) => [
    new RegExp(pattern, "im"),
    tag,
  ] as [RegExp, string]);
}

// ── buildMonthFormData ──

describe("buildMonthFormData", () => {
  it("builds correct form data", () => {
    const params = buildMonthFormData(3, 2026, 21);
    expect(params.get("em_ajax")).toBe("1");
    expect(params.get("ajaxCalendar")).toBe("1");
    expect(params.get("full")).toBe("1");
    expect(params.get("scope")).toBe("all");
    expect(params.get("page_id")).toBe("21");
    expect(params.get("event_archetype")).toBe("event");
    expect(params.get("orderby")).toBe("event_start");
    expect(params.get("month")).toBe("3");
    expect(params.get("year")).toBe("2026");
  });

  it("uses custom pageId", () => {
    const params = buildMonthFormData(1, 2025, 42);
    expect(params.get("page_id")).toBe("42");
  });
});

// ── parseEventFromItem ──

describe("parseEventFromItem", () => {
  it("extracts title from img alt attribute", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WITH_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event).not.toBeNull();
    expect(event!.title).toBe("Lost Boobs Hash #452 Run to the Hills");
  });

  it("returns undefined title when no image (title fetched from detail page later)", () => {
    const $ = cheerio.load(SAMPLE_EVENT_NO_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event).not.toBeNull();
    expect(event!.title).toBeUndefined();
    // sourceUrl should still be set for later title fetch
    expect(event!.sourceUrl).toContain("phoenixhhh.org");
  });

  it("extracts date from MM/DD/YYYY format", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WITH_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.date).toBe("2026-03-02");
  });

  it("takes the start date from a multi-day long-form range (#1473)", () => {
    // "Thursday - 04/30/2026 - Sunday - 05/03/2026" must resolve to the
    // first embedded MM/DD/YYYY (event start), not the second.
    const $ = cheerio.load(SAMPLE_EVENT_MULTI_DAY);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.date).toBe("2026-04-30");
  });

  it("extracts date from compact `D MMM YY` Events Manager row form (#1473)", () => {
    // The Events Manager plugin renders calendar rows in two formats —
    // the long `Weekday - MM/DD/YYYY` shape and the compact `D MMM YY`
    // shape (e.g. "27 Apr 26"). Pre-fix, the latter failed the regex
    // and ~half the month's grid was dropped as "Could not extract date".
    const $ = cheerio.load(SAMPLE_EVENT_COMPACT_DATE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-27");
    expect(event!.startTime).toBe("18:30");
    expect(event!.location).toBe("Groggy's");
  });

  it("extracts start time", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WITH_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.startTime).toBe("18:30");
  });

  it("extracts location", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WITH_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.location).toBe("Downtown Park");
  });

  it("extracts hares from description", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WITH_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.hares).toBe("Toe Jam & Earl");
  });

  it("extracts description", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WITH_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.description).toContain("Hash Cash: $5");
    expect(event!.description).toContain("Trail is A to B");
  });

  it("builds source URL from read-more link", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WITH_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.sourceUrl).toBe(
      "https://www.phoenixhhh.org/?event=lost-boobs-hash-452-run-to-the-hills",
    );
  });

  it("returns null when date cannot be parsed", () => {
    const $ = cheerio.load(SAMPLE_EVENT_NO_DATE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event).toBeNull();
  });
});

// ── Kennel pattern matching ──

describe("kennel pattern matching", () => {
  it("matches Lost Boobs to LBH tag", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WITH_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.kennelTags[0]).toBe("LBH");
  });

  it("uses defaultKennelTag when no title available for pattern matching", () => {
    const $ = cheerio.load(SAMPLE_EVENT_NO_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    // No title means no pattern match — falls back to defaultKennelTag
    expect(event!.kennelTags[0]).toBe("Wrong Way");
  });

  it("matches Wrong Way from img alt", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WRONG_WAY);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.kennelTags[0]).toBe("Wrong Way");
  });

  it("matches FDTDD from title", () => {
    const $ = cheerio.load(SAMPLE_EVENT_FDTDD);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.kennelTags[0]).toBe("FDTDD");
  });

  it("falls back to defaultKennelTag for unrecognized events", () => {
    const html = SAMPLE_EVENT_WITH_IMAGE.replace(
      "Lost Boobs Hash #452 Run to the Hills",
      "Special Annual Event",
    );
    const $ = cheerio.load(html);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.kennelTags[0]).toBe("Wrong Way");
  });
});

// ── Hare extraction from description ──

describe("hare extraction", () => {
  it("extracts multiple hares with Hares: prefix", () => {
    const $ = cheerio.load(SAMPLE_EVENT_NO_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.hares).toBe("Quick Draw & Slippery When Wet");
  });

  it("extracts single hare with Hare: prefix", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WRONG_WAY);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.hares).toBe("Desert Rat");
  });

  // #1651 — Wrong Way descriptions occasionally collapse to a single line
  // with no `<p>` boundary between labeled fields. The hare-pattern
  // terminator must stop at `Bring:` (and friends), not just `Who:` /
  // `What:` etc. — otherwise haresText trails into the rest of the body.
  it("stops hare capture at Bring: in single-line description (#1651)", () => {
    const single = "Hares: Probably you! Bring: H20, a whistle, and head(!)lamp. Beer on trail is provided.";
    expect(extractHares(single, PHOENIX_HARE_PATTERNS as RegExp[])).toBe("Probably you!");
  });

  it("stops hare capture at Cost: / Hash Cash: / Location: / Start: (#1651)", () => {
    expect(extractHares("Hares: Foo Bar Hash Cash: $5", PHOENIX_HARE_PATTERNS as RegExp[])).toBe("Foo Bar");
    expect(extractHares("Hares: Foo Bar Cost: free", PHOENIX_HARE_PATTERNS as RegExp[])).toBe("Foo Bar");
    expect(extractHares("Hares: Foo Bar Location: Park", PHOENIX_HARE_PATTERNS as RegExp[])).toBe("Foo Bar");
    expect(extractHares("Hares: Foo Bar Start: 6:30pm", PHOENIX_HARE_PATTERNS as RegExp[])).toBe("Foo Bar");
    expect(extractHares("Hares: Foo Bar On On: Pub", PHOENIX_HARE_PATTERNS as RegExp[])).toBe("Foo Bar");
  });

  it("returns undefined when no hares in description", () => {
    const $ = cheerio.load(SAMPLE_EVENT_FDTDD);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.hares).toBeUndefined();
  });
});

// ── Venue extraction from description (#1651) ──

describe("extractVenueFromDescription (#1651)", () => {
  it("extracts venue from `Location: <venue>` single line", () => {
    expect(extractVenueFromDescription("Hares: Foo Bar\nLocation: Roses by the Stairs Brewing\nStart: 7pm"))
      .toBe("Roses by the Stairs Brewing");
  });

  it("extracts venue from bare `Location` label on its own line", () => {
    expect(extractVenueFromDescription("Hares: Foo Bar\nLocation\nRoses by the Stairs Brewing\n"))
      .toBe("Roses by the Stairs Brewing");
  });

  it("extracts venue from `Location:\\n<venue>` (colon on label line, value on next line)", () => {
    // Shape between Shape 1 and Shape 2: colon sits on the label line but
    // no value follows on the same line. Pre-Codex-review-fix neither
    // regex matched this; now Shape 2's optional `:?` covers it.
    expect(extractVenueFromDescription("Hares: Foo Bar\nLocation:\nRoses by the Stairs Brewing"))
      .toBe("Roses by the Stairs Brewing");
  });

  it("returns undefined when no Location label", () => {
    expect(extractVenueFromDescription("Hares: Foo Bar\nHash Cash: $5")).toBeUndefined();
  });

  it("returns undefined when Location is followed by a blank line", () => {
    // A bare `Location` label followed by a blank line (then content) has no
    // adjacent venue on the next line — Shape 2's `\n([^\n]+)` requires a
    // non-newline char immediately after the label-line newline.
    expect(extractVenueFromDescription("Location\n\nNext block")).toBeUndefined();
  });

  it("returns undefined when ONLY a `Location:` label appears with no following non-blank line", () => {
    // Trailing-only label, end of description.
    expect(extractVenueFromDescription("Hares: Foo\nLocation:")).toBeUndefined();
    expect(extractVenueFromDescription("Hares: Foo\nLocation: ")).toBeUndefined();
  });

  it("stops at next labeled section when trailing labels share the Location line (#1695 codex P1)", () => {
    // Codex P1 on PR #1695: when a scribe packs trailing sections onto
    // the same line as `Location:` (common when the prelude is `<p>`-
    // separated but the venue line concatenates `Location: X Time: Y
    // Hash Cash: Z`), the pre-fix `[^\n]+` capture absorbed the rest.
    // `parseEventFromItem` prefers `venue ?? metaLocation`, so the
    // polluted string overwrote the cleaner meta-line location value.
    expect(
      extractVenueFromDescription(
        "Hares: Probably you!\nBring: H20\nLocation: Roses by the Stairs Brewing Time: 6:30 PM Hash Cash: $5",
      ),
    ).toBe("Roses by the Stairs Brewing");
  });

  it("stops at end-of-string when no terminator label follows (single-line)", () => {
    expect(extractVenueFromDescription("Location: Roses by the Stairs Brewing")).toBe(
      "Roses by the Stairs Brewing",
    );
  });

  it("matches Location label padded with non-breaking spaces (#1702 gemini medium)", () => {
    // WordPress / TinyMCE pad bare labels with NBSP that survives
    // `stripHtmlTags`. Plain `.trim()` doesn't catch ` `.
    const nbsp = " ";
    expect(
      extractVenueFromDescription(`Hares: Foo\n${nbsp}Location${nbsp}\nRoses by the Stairs Brewing`),
    ).toBe("Roses by the Stairs Brewing");
  });
});

describe("parseEventFromItem — prefers description venue over city meta (#1651)", () => {
  it("uses Location: <venue> from description over generic city meta", () => {
    const html = `
      <div class="em-item em-event">
        <div class="em-item-image"></div>
        <div class="em-item-meta-line em-event-date">Saturday - 03/07/2026</div>
        <div class="em-item-meta-line em-event-time">2:00 pm</div>
        <div class="em-item-meta-line em-event-location">Phoenix</div>
        <div class="em-item-desc">
          <p>Hares: Probably you!</p>
          <p>Bring: H20, a whistle</p>
          <p>Location: Roses by the Stairs Brewing</p>
        </div>
        <a class="em-item-read-more" href="/?event=wrong-way">Read More</a>
      </div>`;
    const $ = cheerio.load(html);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.location).toBe("Roses by the Stairs Brewing");
    expect(event!.hares).toBe("Probably you!");
  });

  it("falls back to meta-line city when description has no Location label", () => {
    const html = `
      <div class="em-item em-event">
        <div class="em-item-meta-line em-event-date">Saturday - 03/07/2026</div>
        <div class="em-item-meta-line em-event-location">Tempe Town Lake Park</div>
        <div class="em-item-desc"><p>Hare: Foo</p></div>
      </div>`;
    const $ = cheerio.load(html);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.location).toBe("Tempe Town Lake Park");
  });
});

// ── runNumber extraction (#1211) ──

describe("extractHashRunNumber (#1211 Wrong Way URL-slug fix)", () => {
  it("extracts run number from 'Kennel #NNN: Trail' title", () => {
    expect(extractHashRunNumber("Wrong Way #1156: Master Shake n' Baker")).toBe(1156);
  });

  it("extracts run number with whitespace after #", () => {
    expect(extractHashRunNumber("Wrong Way # 1156")).toBe(1156);
  });

  it("returns undefined for ambiguous mid-token alphanumeric", () => {
    // Mirrors the GCal #1147 delimiter guard — "#30X?" is the kennel saying
    // run number unknown.
    expect(extractHashRunNumber("Wrong Way #30X?")).toBeUndefined();
  });

  it("returns undefined when no run number present", () => {
    expect(extractHashRunNumber("Wrong Way Trail")).toBeUndefined();
  });

  it("returns undefined for null/empty title", () => {
    expect(extractHashRunNumber(undefined)).toBeUndefined();
    expect(extractHashRunNumber("")).toBeUndefined();
  });
});

describe("parseEventFromItem — runNumber from img-alt title (#1211)", () => {
  it("extracts runNumber from a title containing '#NNN'", () => {
    const html = `
      <div class="em-item em-event">
        <div class="em-item-image">
          <img src="/img/x.jpg" alt="Wrong Way #1156: Master Shake n' Baker" />
        </div>
        <div class="em-item-meta-line em-event-date">Saturday - 05/02/2026</div>
        <div class="em-item-meta-line em-event-time">6:30 pm - 9:30 pm</div>
        <a class="em-item-read-more" href="/?event=wrong-way-1155-need-hares">Read More</a>
      </div>
    `;
    const $ = cheerio.load(html);
    const $item = $(".em-item").first();
    const config = {
      kennelPatterns: [["Wrong Way", "wrong-way"] as [string, string]],
      defaultKennelTag: "wrong-way",
    };
    const compiledPatterns: [RegExp, string][] = [[/Wrong Way/i, "wrong-way"]];
    const event = parseEventFromItem($item, $, config, compiledPatterns);
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(1156);
    // The sourceUrl still contains the stale slug — that's fine; we just
    // don't trust it for runNumber extraction.
    expect(event!.sourceUrl).toContain("wrong-way-1155-need-hares");
  });
});

// ── Adapter validation ──

describe("PhoenixHHHAdapter", () => {
  it("rejects missing config", async () => {
    const adapter = new PhoenixHHHAdapter();
    const source = {
      id: "test",
      url: "https://www.phoenixhhh.org/?page_id=21",
      config: null,
    } as unknown as Source;

    await expect(adapter.fetch(source)).rejects.toThrow(
      "PhoenixHHHAdapter: source.config is null",
    );
  });

  it("rejects config missing kennelPatterns", async () => {
    const adapter = new PhoenixHHHAdapter();
    const source = {
      id: "test",
      url: "https://www.phoenixhhh.org/?page_id=21",
      config: { defaultKennelTag: "Wrong Way" },
    } as unknown as Source;

    await expect(adapter.fetch(source)).rejects.toThrow(
      'missing required config field "kennelPatterns"',
    );
  });

  it("rejects config missing defaultKennelTag", async () => {
    const adapter = new PhoenixHHHAdapter();
    const source = {
      id: "test",
      url: "https://www.phoenixhhh.org/?page_id=21",
      config: { kennelPatterns: [] },
    } as unknown as Source;

    await expect(adapter.fetch(source)).rejects.toThrow(
      'missing required config field "defaultKennelTag"',
    );
  });

  it("has correct type", () => {
    const adapter = new PhoenixHHHAdapter();
    expect(adapter.type).toBe("HTML_SCRAPER");
  });
});

// ── PHOENIX_HARE_PATTERNS (#1472, #1192) ──

describe("PHOENIX_HARE_PATTERNS — list-view extraction", () => {
  it("captures `Hare(s):` after `Harriers!!! ` sentence boundary (#1472)", () => {
    // List-view excerpt: labels run together because <p> tags are collapsed.
    // The Phoenix-scoped patterns allow mid-line `Hare:` after sentence
    // punctuation. The age-restriction line ("Who: People …") must NOT
    // be returned even though the generic default `Who:` catchall would
    // have matched it.
    const desc =
      "Join us for the 744th running of the Lost Boobs Hash House Harriers!!! " +
      "Hare(s): Prostitutor, Just Rick, Just Christin " +
      "Who: People that are at least 21 years old (no exceptions).";
    expect(extractHares(desc, PHOENIX_HARE_PATTERNS as RegExp[])).toBe(
      "Prostitutor, Just Rick, Just Christin",
    );
  });

  it("returns undefined when only an age-restriction `Who:` line is present (#1472)", () => {
    // No Hare label at all — Phoenix patterns must NOT fall back to a
    // generic Who: capture. Returning undefined is the correct behavior;
    // an empty hares field is preferable to the age-restriction prose.
    const desc =
      "Join us for the 745th running. Who: People that are at least 21 years old (no exceptions).";
    expect(extractHares(desc, PHOENIX_HARE_PATTERNS as RegExp[])).toBeUndefined();
  });

  it("captures FDTDD `With your Hares:` mid-paragraph (#1192)", () => {
    const desc =
      'The From Dusk Till Down-Down Hash presents My Bloody Hashentine! ' +
      'With your Hares: Chew Oyster Cult & Cumming to Dinner "The most evil hash …"';
    expect(extractHares(desc, PHOENIX_HARE_PATTERNS as RegExp[])).toBe(
      "Chew Oyster Cult & Cumming to Dinner",
    );
  });

  it("captures FDTDD singular `With your Hare:` (#1192)", () => {
    const desc = "The From Dusk Till Down-Downs Hash presents Foo. With your Hare: Makin' Me Gay …";
    expect(extractHares(desc, PHOENIX_HARE_PATTERNS as RegExp[])).toBe("Makin' Me Gay");
  });

  it("captures literal `With your Hare(s):` parenthesized form (codex P1 follow-up to #1192)", () => {
    // The FDTDD kennel uses three label variants — singular, plural, and the
    // parenthesized `Hare(s):` literal. All three must extract.
    const desc = "The From Dusk Till Down-Downs Hash presents Bar. With your Hare(s): Spermin Williams, 1000 Cock Stare";
    expect(extractHares(desc, PHOENIX_HARE_PATTERNS as RegExp[])).toBe(
      "Spermin Williams, 1000 Cock Stare",
    );
  });

  it("captures `Hare(s):` block on its own line (detail-page <p>-separated form)", () => {
    const desc = "LBH #744\n\nHare(s): Prostitutor, Just Rick, Just Christin\n\nWho: People that are at least 21";
    expect(extractHares(desc, PHOENIX_HARE_PATTERNS as RegExp[])).toBe(
      "Prostitutor, Just Rick, Just Christin",
    );
  });
});

describe("parseEventFromItem — list-view hare fallback uses Phoenix patterns (#1472)", () => {
  it("does not capture `Who:` age-restriction line as hares", () => {
    const html = `
      <div class="em-item em-event">
        <div class="em-item-image"><img src="/img/lbh.jpg" alt="LBH #744 Hares Needed" /></div>
        <div class="em-item-meta-line em-event-date">Monday - 05/18/2026</div>
        <div class="em-item-meta-line em-event-time">6:30 pm</div>
        <div class="em-item-desc">
          <p>Join us for the 744th running of the Lost Boobs Hash House Harriers!!! Hare(s): Prostitutor, Just Rick, Just Christin Who: People that are at least 21 years old (no exceptions).</p>
        </div>
        <a class="em-item-read-more" href="/?event=lbh-744">Read More</a>
      </div>
    `;
    const $ = cheerio.load(html);
    const $item = $(".em-item").first();
    const compiled: [RegExp, string][] = [[/LBH/i, "LBH"]];
    const event = parseEventFromItem(
      $item,
      $,
      { kennelPatterns: [["LBH", "LBH"]], defaultKennelTag: "Wrong Way" },
      compiled,
    );

    expect(event).not.toBeNull();
    expect(event!.hares).toBe("Prostitutor, Just Rick, Just Christin");
    expect(event!.hares).not.toContain("Who:");
    expect(event!.hares).not.toContain("People that are");
  });
});

// ── fetchEventDetail (#1193) ──

const SAMPLE_DETAIL_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head><title>LBH #744 – HashTracks Test</title></head>
<body>
<article>
  <h1 class="entry-title">LBH #744: Hares Needed - Be the Hero We Don't Deserve</h1>
  <div class="entry-content">
    <p><strong>Hare(s):</strong> Prostitutor, Just Rick, Just Christin</p>
    <p><strong>Who:</strong> People that are at least 21 years old (no exceptions).</p>
    <p><strong>What:</strong> A 4-5 mile trail with beer stops.</p>
    <p><strong>Where:</strong> See the location field above.</p>
  </div>
</article>
</body>
</html>`;

describe("fetchEventDetail", () => {
  it("extracts title, full description, and hares from the detail page (#1193)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_DETAIL_PAGE_HTML, { status: 200 }),
    );

    const detail = await fetchEventDetail("https://www.phoenixhhh.org/?event=lbh-744");
    vi.restoreAllMocks();

    expect(detail.title).toContain("LBH #744");
    expect(detail.description).toContain("Prostitutor, Just Rick, Just Christin");
    expect(detail.description).toContain("People that are at least 21 years old");
    // The detail-page description does NOT carry the WordPress `[...]`
    // truncation marker that the list-view excerpt does.
    expect(detail.description).not.toContain("[...]");
    // The hare extraction uses Phoenix-scoped patterns, which means
    // the `Who:` age-restriction line is NOT captured as a hare.
    expect(detail.hares).toBe("Prostitutor, Just Rick, Just Christin");
  });

  it("throws on HTTP error so the post-loop can record the failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );
    await expect(fetchEventDetail("https://www.phoenixhhh.org/?event=missing")).rejects.toThrow(/HTTP 404/);
    vi.restoreAllMocks();
  });

  it("propagates network failures so the post-loop can distinguish error modes", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(fetchEventDetail("https://www.phoenixhhh.org/?event=any")).rejects.toThrow(/ECONNRESET/);
    vi.restoreAllMocks();
  });

  it("returns null content fields when the detail page lacks `.entry-content`", async () => {
    const html = `<html><body><article><h1 class="entry-title">Bare Page</h1></article></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(html, { status: 200 }));
    const detail = await fetchEventDetail("https://www.phoenixhhh.org/?event=bare");
    vi.restoreAllMocks();
    expect(detail.title).toBe("Bare Page");
    expect(detail.description).toBeNull();
    expect(detail.hares).toBeNull();
  });
});

// ── Detail-fetch failures surface in errorDetails (codex follow-up) ──

describe("PhoenixHHHAdapter.fetch — detail-fetch failures are visible", () => {
  it("records detail-fetch failures in errorDetails.fetch (bounded sample)", async () => {
    // Build a fixture with TODAY's date so it falls inside the
    // adapter's date window regardless of when the test runs.
    const now = new Date();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    const yyyy = now.getUTCFullYear();
    const sampleAjaxResponse = `
      <div class="em-calendar-wrap">
        <div class="em-item em-event">
          <div class="em-item-image">
            <img src="/img/lbh.jpg" alt="Lost Boobs Hash Test" />
          </div>
          <div class="em-item-meta-line em-event-date">Today - ${mm}/${dd}/${yyyy}</div>
          <div class="em-item-meta-line em-event-time">6:30 pm</div>
          <a class="em-item-read-more" href="https://www.phoenixhhh.org/?event=test">Read More</a>
        </div>
      </div>
    `;

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // First call: the month AJAX returns the list HTML.
    fetchSpy.mockResolvedValueOnce(new Response(sampleAjaxResponse, { status: 200 }));
    // Every detail-page fetch returns 503 (origin rate-limit / outage).
    fetchSpy.mockImplementation(async () => new Response("Service Unavailable", { status: 503 }));

    const adapter = new PhoenixHHHAdapter();
    const source = {
      id: "test",
      url: "https://www.phoenixhhh.org/?page_id=21",
      config: DEFAULT_CONFIG,
    } as unknown as Source;

    const result = await adapter.fetch(source, { days: 1 });
    vi.restoreAllMocks();

    // Events still parse (list-view fallback).
    expect(result.events.length).toBeGreaterThan(0);
    // BUT the detail-fetch failures are surfaced — fail-loud over silent
    // truncated-description regressions.
    expect(result.errorDetails?.fetch).toBeDefined();
    expect(result.errorDetails!.fetch!.length).toBeGreaterThan(0);
    expect(result.errorDetails!.fetch!.length).toBeLessThanOrEqual(5);
    expect(result.errorDetails!.fetch![0].message).toMatch(/Detail fetch/i);
    expect(result.diagnosticContext?.detailFetchFailures).toBeGreaterThan(0);
    expect(result.diagnosticContext?.detailsFetched).toBe(0);
  });
});
