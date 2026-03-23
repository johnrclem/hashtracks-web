import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  fetchEventTitle,
  buildMonthFormData,
  parseEventFromItem,
  PhoenixHHHAdapter,
} from "./phoenixhhh";

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

    expect(event!.kennelTag).toBe("LBH");
  });

  it("uses defaultKennelTag when no title available for pattern matching", () => {
    const $ = cheerio.load(SAMPLE_EVENT_NO_IMAGE);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    // No title means no pattern match — falls back to defaultKennelTag
    expect(event!.kennelTag).toBe("Wrong Way");
  });

  it("matches Wrong Way from img alt", () => {
    const $ = cheerio.load(SAMPLE_EVENT_WRONG_WAY);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.kennelTag).toBe("Wrong Way");
  });

  it("matches FDTDD from title", () => {
    const $ = cheerio.load(SAMPLE_EVENT_FDTDD);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.kennelTag).toBe("FDTDD");
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

    expect(event!.kennelTag).toBe("Wrong Way");
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

  it("returns undefined when no hares in description", () => {
    const $ = cheerio.load(SAMPLE_EVENT_FDTDD);
    const $item = $(".em-item").first();
    const compiled = makeCompiledPatterns(DEFAULT_CONFIG);
    const event = parseEventFromItem($item, $, DEFAULT_CONFIG, compiled);

    expect(event!.hares).toBeUndefined();
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
