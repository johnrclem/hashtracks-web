import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseMadridGps,
  cleanMadridTitle,
  extractMadridPostBody,
  parseMadridRunBody,
  resolveRunDate,
  MadridHashAdapter,
} from "./madrid-hash";
import * as wordpressApi from "../wordpress-api";
import type { Source } from "@/generated/prisma/client";

vi.mock("../wordpress-api");

/** Minimal Source for adapter.fetch() — one necessary cast, no per-callsite `as never`. */
function madridSource(overrides: Partial<Source> = {}): Source {
  return {
    url: "https://madridhhh.com/",
    scrapeDays: 365,
    ...overrides,
  } as Source;
}

/**
 * Reuse the adapter's exported transform so direct parseMadridRunBody tests
 * exercise the real shared label-extraction path (and can't drift from it).
 */
function htmlToBody(content: string): string {
  return extractMadridPostBody(content).body;
}

// ── Real run-post markup captured live from madridhhh.com ───────────────────

// Run #2713 — Sunday run, 13:00, maps.app.goo.gl link, decimal coords (current format).
const POST_2713_CONTENT = `<div class="row">
<div class="column1">
<strong>Run No.</strong>: 2713<br />
<strong><strong><i class="far fa-calendar-alt"></i></strong> Date</strong>: Sunday 7 June 2026<br />
<strong><strong><i class="far fa-clock"></i></strong> Time</strong>: 1pm &#8211; 13:00h prompt start (please)<br />
<strong><strong><i class="fas fa-coins"></i></strong> Fee</strong>: 5€ (+2€ for the driver if you get a lift), it covers all the drinks and the snacks.<br />
<strong>Location</strong>: Avda papa Negro 39,  Parque Juan Pablo II, Madrid<br />
<strong><strong><i class="fas fa-map-marker-alt"></i></strong> GPS</strong>: [40°27&#8217;15.7&#8243;N 3°37&#8217;45.7&#8243;W] or [40.454352, -3.629372]</p>
</div>
<div class="column2">
<p><strong>Google Maps</strong>: <a href="https://maps.app.goo.gl/WJGZLk4YtjP36gw29">https://maps.app.goo.gl/WJGZLk4YtjP36gw29</a></p>
<p><strong>Hares</strong>: Bush Warmer &#038; Sir Scrambled Dag</p>
</div>
</div>`;
const POST_2713_TITLE = "The “Habemus Papadam” R*n"; // he.decode'd by wordpress-api

// Run #2413 — Friday evening run, 20:00, legacy goo.gl/maps link, ordinal date.
const POST_2413_CONTENT = `<div class="row">
<div class="column1">
<p><strong>Run No.</strong>: 2413<br />
<strong><strong><i class="far fa-calendar-alt"></i></strong> Date</strong>: <span style="color: #ff0000;"><strong>Friday 3rd January 2020</strong></span><br />
<strong><strong><i class="far fa-clock"></i></strong> Time</strong>: <span style="color: #ff0000;"><strong>8pm &#8211; 20:00h !!!</strong></span><br />
<strong>Location</strong>: Snog the Goblin&#8217;s Grotto, Calle Acueducto, 3- DPDO (BLUE<br />
DOOR), 3rd floor, 28039 Madrid<br />
<strong><strong><i class="fas fa-map-marker-alt"></i></strong> GPS</strong>: [40°27&#8217;03.2&#8243;N 3°42&#8217;31.3&#8243;W] or [40.450880, -3.708695]</p>
</div>
<div class="column2">
<p><strong>Google Maps</strong>: <a href="https://goo.gl/maps/qZud3B28AZCc5Lp6A">https://goo.gl/maps/qZud3B28AZCc5Lp6A</a></p>
<p><strong>Hares</strong>: Snog The Goblin &amp; Smile Like You Like It</p>
</div>
</div>`;
const POST_2413_TITLE = "The “8pm (At Night) Live-Hare” R*n";

// A non-run announcement post (no "Run No." label).
const NON_RUN_CONTENT =
  "<p>Welcome to the Madrid Hash House Harriers! We run every Sunday.</p>";

describe("parseMadridGps", () => {
  it("extracts the decimal pair (lat, lng) from the DMS-or-decimal GPS line", () => {
    expect(
      parseMadridGps("[40°27’15.7″N 3°37’45.7″W] or [40.454352, -3.629372]"),
    ).toEqual({ lat: 40.454352, lng: -3.629372 });
  });

  it("returns undefined for a DMS-only line (no decimal bracket)", () => {
    expect(parseMadridGps("40°27’03.1″N 3°42’31.4″W")).toBeUndefined();
  });

  it("returns undefined for a bare maps link or empty line", () => {
    expect(parseMadridGps("https://goo.gl/maps/yrmpk6vLmXeM2QaP9")).toBeUndefined();
    expect(parseMadridGps(undefined)).toBeUndefined();
  });
});

describe("cleanMadridTitle", () => {
  it.each([
    ["The “Habemus Papadam” R*n", "The “Habemus Papadam” R*n"],
    ['The "Cool Meadows" R*n', 'The "Cool Meadows" R*n'],
    // og_title carries a trailing site-name suffix — stripped defensively.
    ["The “Habemus Papadam” R*n - Madrid HHH", "The “Habemus Papadam” R*n"],
    ["The “Habemus Papadam” R*n – Madrid HHH", "The “Habemus Papadam” R*n"],
  ])("returns the cleaned title for %s", (title, expected) => {
    expect(cleanMadridTitle(title)).toBe(expected);
  });

  it("returns undefined for an empty title (so merge synthesizes the placeholder)", () => {
    expect(cleanMadridTitle("   ")).toBeUndefined();
  });
});

describe("resolveRunDate", () => {
  it("trusts the body date verbatim when no publish date is given", () => {
    expect(resolveRunDate("Sunday 7 June 2026")).toBe("2026-06-07");
  });

  it("honors an explicit full body date even with a publish date", () => {
    expect(resolveRunDate("Sunday 7 June 2026", "2026-06-02T17:59:04")).toBe(
      "2026-06-07",
    );
  });

  it("infers the year for a year-less line from the publish date (#2279)", () => {
    // "Sunday 17th December" published 2017-12-14 → 2017, not chrono's default year.
    expect(resolveRunDate("Sunday 17th December", "2017-12-14T00:00:00")).toBe(
      "2017-12-17",
    );
  });

  it("recovers a month typo via the publish-anchored reference (#2468)", () => {
    expect(
      resolveRunDate("Sunday 30th Januray 2022", "2022-01-28T00:00:00"),
    ).toBe("2022-01-30");
  });

  it("re-anchors an explicit but stale copy-pasted year to the run weekday (#2688)", () => {
    // Body stamped 2024 but published 2025-12-26 → real run is Sun 2025-12-28.
    expect(
      resolveRunDate("Sunday 28 December 2024", "2025-12-26T00:00:00"),
    ).toBe("2025-12-28");
  });

  it("re-anchors a fully stale copy-pasted day+year to the run weekday (#2495)", () => {
    // "14th July 2019" on a 2022 Pool Party post published 2022-07-29 (Fri) →
    // next Sunday on/after publish = 2022-07-31.
    expect(
      resolveRunDate("Sunday 14th July 2019", "2022-07-29T00:00:00"),
    ).toBe("2022-07-31");
  });

  it("preserves a legitimately far-FUTURE date (no backward re-anchor)", () => {
    // A special announced months ahead: parsed date is far AFTER publish, which
    // is NOT the stale-copy-paste signature — it must be left untouched.
    expect(
      resolveRunDate("Saturday 12 September 2026", "2026-06-01T00:00:00"),
    ).toBe("2026-09-12");
  });
});

describe("parseMadridRunBody", () => {
  it("parses the current Sunday-run format (#2713) — date from body, sorted hares, decimal coords", () => {
    const event = parseMadridRunBody(
      htmlToBody(POST_2713_CONTENT),
      POST_2713_TITLE,
      "https://madridhhh.com/the-habemus-papadam-rn/",
    );
    expect(event).toMatchObject({
      date: "2026-06-07",
      kennelTags: ["madrid-h3"],
      runNumber: 2713,
      title: "The “Habemus Papadam” R*n", // source title, not a synthesized placeholder
      hares: "Bush Warmer, Sir Scrambled Dag", // & split + alpha sort
      startTime: "13:00",
      latitude: 40.454352,
      longitude: -3.629372,
      locationUrl: "https://maps.app.goo.gl/WJGZLk4YtjP36gw29",
      description: null, // theme no longer routed here (#2040)
      sourceUrl: "https://madridhhh.com/the-habemus-papadam-rn/",
    });
    expect(event?.location).toContain("Parque Juan Pablo II");
  });

  it("routes the source title to `title` (not `description`) — #2040 swap regression", () => {
    const event = parseMadridRunBody(
      htmlToBody(POST_2713_CONTENT),
      POST_2713_TITLE,
      "https://madridhhh.com/the-habemus-papadam-rn/",
    );
    // Pre-fix bug: title was undefined and the quoted theme ("Habemus Papadam")
    // landed in description. The real per-event title must own `title`, and
    // description must be the explicit clear so stale themes are wiped on merge.
    expect(event?.title).toBe("The “Habemus Papadam” R*n");
    expect(event?.description).toBeNull();
    expect(event?.title).not.toContain("Trail #");
  });

  it("parses the older evening-run format (#2413) — ordinal date, 20:00, legacy goo.gl/maps link", () => {
    const event = parseMadridRunBody(
      htmlToBody(POST_2413_CONTENT),
      POST_2413_TITLE,
      "https://madridhhh.com/the-8pm-at-night-live-hare-rn/",
    );
    expect(event).toMatchObject({
      date: "2020-01-03",
      runNumber: 2413,
      startTime: "20:00",
      latitude: 40.45088,
      longitude: -3.708695,
      hares: "Smile Like You Like It, Snog The Goblin",
      locationUrl: "https://goo.gl/maps/qZud3B28AZCc5Lp6A",
      title: "The “8pm (At Night) Live-Hare” R*n",
      description: null,
    });
  });

  it("returns null for a post with no 'Run No.' label", () => {
    expect(
      parseMadridRunBody(htmlToBody(NON_RUN_CONTENT), "Welcome", "https://madridhhh.com/welcome/"),
    ).toBeNull();
  });

  it("prefers the caller's anchor href over a body-scanned Maps link", () => {
    const event = parseMadridRunBody(
      htmlToBody(POST_2713_CONTENT),
      POST_2713_TITLE,
      "https://madridhhh.com/the-habemus-papadam-rn/",
      "2026-06-02T17:59:04",
      "https://maps.app.goo.gl/HREF-WINS",
    );
    expect(event?.locationUrl).toBe("https://maps.app.goo.gl/HREF-WINS");
  });

  it("strips a stray trailing ')' from a source-malformed Maps href", () => {
    const event = parseMadridRunBody(
      htmlToBody(POST_2713_CONTENT),
      POST_2713_TITLE,
      "https://madridhhh.com/x/",
      "2026-06-02T17:59:04",
      "https://goo.gl/maps/m9kQMeLyStp)",
    );
    expect(event?.locationUrl).toBe("https://goo.gl/maps/m9kQMeLyStp");
  });

  it("returns null for a malformed run number (bare dot, no digit)", () => {
    const body = htmlToBody(
      "<p><strong>Run No.</strong>: .<br /><strong>Date</strong>: Sunday 7 June 2026</p>",
    );
    expect(parseMadridRunBody(body, "x", "https://madridhhh.com/x/")).toBeNull();
  });

  it("takes the h-suffixed 24-hour time over a colon'd 12-hour prefix", () => {
    const body = htmlToBody(
      "<p><strong>Run No.</strong>: 2500<br /><strong>Date</strong>: Sunday 7 June 2026<br /><strong>Time</strong>: 7:30pm – 19:30h</p>",
    );
    expect(parseMadridRunBody(body, "x", "https://madridhhh.com/x/")?.startTime).toBe(
      "19:30",
    );
  });

  it("falls back to the first time on an irregular line that omits the 'h' marker", () => {
    // "9pm – 21:00 but PLEASE be there for 20:45..." → start is 21:00, not the
    // later-positioned 20:45 arrival time.
    const body = htmlToBody(
      "<p><strong>Run No.</strong>: 2271<br /><strong>Date</strong>: Tuesday 31 October 2017<br /><strong>Time</strong>: 9pm – 21:00 but PLEASE be there for 20:45 so we can start on time.</p>",
    );
    expect(parseMadridRunBody(body, "x", "https://madridhhh.com/x/")?.startTime).toBe(
      "21:00",
    );
  });
});

describe("MadridHashAdapter", () => {
  let adapter: MadridHashAdapter;

  beforeEach(() => {
    adapter = new MadridHashAdapter();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches via the WordPress API and parses run events, skipping non-run posts", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValueOnce({
      posts: [
        { title: POST_2713_TITLE, content: POST_2713_CONTENT, url: "https://madridhhh.com/the-habemus-papadam-rn/", date: "2026-06-02T17:59:04" },
        { title: "Welcome", content: NON_RUN_CONTENT, url: "https://madridhhh.com/welcome/", date: "2020-01-01T00:00:00" },
      ],
      fetchDurationMs: 120,
    });

    // Wide window so the assertion never depends on the wall-clock run date.
    const result = await adapter.fetch(madridSource(), { days: 36500 });

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      date: "2026-06-07",
      kennelTags: ["madrid-h3"],
      runNumber: 2713,
      startTime: "13:00",
    });
    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "wordpress-api",
      postsFound: 2,
    });
  });

  it("fails loud when posts are fetched but none parse (body-format drift)", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValueOnce({
      posts: [
        { title: "Welcome", content: NON_RUN_CONTENT, url: "https://madridhhh.com/welcome/", date: "2026-01-01T00:00:00" },
      ],
      fetchDurationMs: 80,
    });

    const result = await adapter.fetch(madridSource());
    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("parsed 0 run events");
  });

  it("fails loud (no events) when the WordPress API returns an error", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValueOnce({
      posts: [],
      error: { message: "WordPress API HTTP 503", status: 503 },
      fetchDurationMs: 50,
    });

    const result = await adapter.fetch(madridSource());
    expect(result.events).toEqual([]);
    expect(result.errors).toEqual(["WordPress API HTTP 503"]);
  });
});
