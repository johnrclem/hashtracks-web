import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Source } from "@/generated/prisma/client";
import { FacebookHostedEventsAdapter } from "./adapter";

vi.mock("../safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

const { safeFetch } = await import("../safe-fetch");
const mockedFetch = vi.mocked(safeFetch);

const FIXTURE_HTML = readFileSync(
  join(__dirname, "fixtures", "grand-strand-upcoming.html.fixture"),
  "utf-8",
);

const DETAIL_FIXTURE_HTML = readFileSync(
  join(__dirname, "fixtures", "grand-strand-event-1012210268147290.html.fixture"),
  "utf-8",
);

const HOLLYWEIRD_UPCOMING_HTML = readFileSync(
  join(__dirname, "fixtures", "hollyweird-upcoming.html.fixture"),
  "utf-8",
);

const HOLLYWEIRD_BANDOLEROS_DETAIL_HTML = readFileSync(
  join(__dirname, "fixtures", "hollyweird-event-1481362937047925.html.fixture"),
  "utf-8",
);

function makeSource(config: Record<string, unknown>): Source {
  return {
    id: "src-fb-test",
    name: "GSH3 FB hosted_events",
    url: "https://www.facebook.com/GrandStrandHashing/upcoming_hosted_events",
    type: "FACEBOOK_HOSTED_EVENTS",
    enabled: true,
    trustLevel: 8,
    scrapeFreq: "daily",
    scrapeDays: 90,
    config,
    lastScrapeAt: null,
    healthStatus: "UNKNOWN",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Source;
}

function htmlResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as Response;
}

describe("FacebookHostedEventsAdapter — fetch", () => {
  // Freeze the clock so the date-window assertions don't drift as calendar
  // time advances past the May 9 2026 fixture event. Without this, tests
  // like "honors options.days by filtering events outside the window" pass
  // for a few days then break the moment "today" crosses into the fixture's
  // ±days window.
  beforeEach(() => {
    mockedFetch.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:00:00Z"));
  });

  afterEach(() => {
    mockedFetch.mockReset();
    vi.useRealTimers();
  });

  it("rejects config missing required fields", async () => {
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(makeSource({}));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/missing required config field/);
  });

  it("rejects a reserved FB structural namespace as pageHandle (e.g. \"events\")", async () => {
    // The admin URL helper extracts the first path segment from a pasted
    // URL. A pasted event URL like https://www.facebook.com/events/{id}/
    // would yield "events" — passes the shape regex but is not a Page handle.
    const adapter = new FacebookHostedEventsAdapter();
    for (const reserved of ["events", "groups", "watch", "profile.php"]) {
      const result = await adapter.fetch(
        makeSource({
          kennelTag: "gsh3",
          pageHandle: reserved,
          timezone: "America/New_York",
          upcomingOnly: true,
        }),
      );
      expect(result.events).toHaveLength(0);
      expect(result.errors[0]).toMatch(/structural namespace/);
    }
  });

  it("rejects pageHandle that fails the regex (XSS / weird chars)", async () => {
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "Grand Strand Hashing", // space rejected
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/pageHandle/);
  });

  it("rejects config missing upcomingOnly: true (Codex pass-3: runtime invariant)", async () => {
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        // upcomingOnly intentionally absent — simulates seed drift / DB edit
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/upcomingOnly/);
  });

  it("rejects upcomingOnly: false at runtime", async () => {
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: false,
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/upcomingOnly/);
  });

  it("rejects an invalid IANA timezone", async () => {
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/Los_Angles", // typo
        upcomingOnly: true,
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/IANA timezone/);
  });

  it("constructs the correct URL from pageHandle", async () => {
    mockedFetch.mockResolvedValueOnce(htmlResponse("<html></html>"));
    const adapter = new FacebookHostedEventsAdapter();
    await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    const call = mockedFetch.mock.calls[0];
    expect(call[0]).toBe(
      "https://www.facebook.com/GrandStrandHashing/upcoming_hosted_events",
    );
  });

  it("sends a browser User-Agent (FB rejects bare requests)", async () => {
    mockedFetch.mockResolvedValueOnce(htmlResponse("<html></html>"));
    const adapter = new FacebookHostedEventsAdapter();
    await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    const headers = mockedFetch.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Mozilla|Chrome/);
  });

  it("returns parsed events from a real FB hosted_events HTML fixture", async () => {
    mockedFetch.mockResolvedValueOnce(htmlResponse(FIXTURE_HTML));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
      { days: 365 },
    );
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      kennelTags: ["gsh3"],
      date: "2026-05-09",
      startTime: "15:00",
      location: "Big Air Myrtle Beach",
    });
  });

  it("populates diagnosticContext via applyDateWindow", async () => {
    mockedFetch.mockResolvedValueOnce(htmlResponse(FIXTURE_HTML));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
      { days: 365 },
    );
    expect(result.diagnosticContext).toMatchObject({
      pageHandle: "GrandStrandHashing",
      timezone: "America/New_York",
      windowDays: 365,
      // applyDateWindow adds totalBeforeFilter; the FB adapter parses 1 event,
      // and the ±365d window keeps it.
      totalBeforeFilter: 1,
    });
  });

  it("honors options.days by filtering events outside the window", async () => {
    mockedFetch.mockResolvedValueOnce(htmlResponse(FIXTURE_HTML));
    const adapter = new FacebookHostedEventsAdapter();
    // Tiny ±1d window — the May 9 2026 event is outside this window so should drop.
    // Today is 2026-05-07 per session context; ±1 day = May 6 to May 8.
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
      { days: 1 },
    );
    expect(result.events).toHaveLength(0);
    expect(result.diagnosticContext?.totalBeforeFilter).toBe(1);
  });

  it("returns an HTTP-status error when FB responds non-2xx", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    } as Response);
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/HTTP 429/);
  });

  it("returns a fetch-error envelope when the network throws", async () => {
    mockedFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/ECONNRESET|fetch error/);
  });

  it("returns 0 events silently for an empty FB Page that ships SSR envelope markers (legit no-events case)", async () => {
    // Real-world empty FB Page: 600KB+ SSR bundle with the envelope
    // markers intact, just no Event nodes. The #1294 audit confirmed this
    // is what every empty-but-active hosted_events Page looks like.
    const emptyPageHtml =
      `<html><body>` +
      `<script type="application/json">{"require":[["RelayPrefetchedStreamCache","next",[],[]]]}</script>` +
      `<div data-bbox='{"__bbox":{"complete":true,"result":{"data":null}}}'></div>` +
      `</body></html>`;
    mockedFetch.mockResolvedValueOnce(htmlResponse(emptyPageHtml));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.diagnosticContext?.totalBeforeFilter).toBe(0);
  });

  it("enriches a listing event whose sourceUrl carries a query string (no trailing slash)", async () => {
    // Regression for the tight regex (#1292 review): a sourceUrl like
    // `.../events/1012210268147290?ref=foo` (no trailing slash before the
    // query) must still resolve to a detail-page fetch.
    const queryUrlListing = FIXTURE_HTML.replaceAll(
      "https://www.facebook.com/events/1012210268147290/",
      "https://www.facebook.com/events/1012210268147290?ref=foo",
    );
    mockedFetch
      .mockResolvedValueOnce(htmlResponse(queryUrlListing))
      .mockResolvedValueOnce(htmlResponse(DETAIL_FIXTURE_HTML));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
      { days: 365 },
    );
    expect(result.diagnosticContext).toMatchObject({
      detailFetchAttempted: 1,
      detailFetchEnriched: 1,
    });
    expect(result.events[0].description).toMatch(/Hare:/);
  });

  it("enriches each parsed event with the description from its detail page", async () => {
    // First call: listing tab. Second call: detail page for the only event.
    mockedFetch
      .mockResolvedValueOnce(htmlResponse(FIXTURE_HTML))
      .mockResolvedValueOnce(htmlResponse(DETAIL_FIXTURE_HTML));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].description).toMatch(/Hare:/);
    // Second mock call should target the detail-page URL.
    const detailCall = mockedFetch.mock.calls[1];
    expect(detailCall[0]).toBe("https://www.facebook.com/events/1012210268147290/");
    expect(result.diagnosticContext).toMatchObject({
      detailFetchAttempted: 1,
      detailFetchEnriched: 1,
      detailFetchFailed: 0,
    });
  });

  it("survives a detail-page fetch failure without dropping the listing event", async () => {
    mockedFetch
      .mockResolvedValueOnce(htmlResponse(FIXTURE_HTML))
      .mockRejectedValueOnce(new Error("ECONNRESET"));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
      { days: 365 },
    );
    // Listing event still emitted, just without description.
    expect(result.events).toHaveLength(1);
    expect(result.events[0].description).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.diagnosticContext).toMatchObject({
      detailFetchAttempted: 1,
      detailFetchEnriched: 0,
      detailFetchFailed: 1,
    });
    // Failure cause captured for operator diagnostics, bounded list.
    const sample = result.diagnosticContext?.detailFetchErrorSample;
    expect(Array.isArray(sample)).toBe(true);
    expect((sample as string[])[0]).toMatch(/ECONNRESET/);
  });

  it("survives a detail-page non-2xx response without dropping the listing event", async () => {
    mockedFetch.mockResolvedValueOnce(htmlResponse(FIXTURE_HTML)).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "not found",
    } as Response);
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
      { days: 365 },
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].description).toBeUndefined();
    expect(result.diagnosticContext).toMatchObject({
      detailFetchAttempted: 1,
      detailFetchFailed: 1,
    });
  });

  it("flags a shape-break heuristic error when SSR envelope markers are absent", async () => {
    // A 200-OK response that's missing FB's GraphQL envelope markers
    // (RelayPrefetchedStreamCache / __bbox) AND parses 0 events is an
    // actual shape rotation — surface as a non-fatal error so
    // SCRAPE_FAILURE fires before EVENT_COUNT_ANOMALY's baseline accrues.
    const noEnvelopeHtml = "<html><body>" + "x".repeat(200_001) + "</body></html>";
    mockedFetch.mockResolvedValueOnce(htmlResponse(noEnvelopeHtml));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/GraphQL shape change/i);
  });

  it("populates runNumber, hares, and locationStreet end-to-end for a Hollyweird upcoming event (#1319 regression)", async () => {
    // Hollyweird upcoming fixture captured 2026-05-10 carries 7 events. Detail
    // fetch is mocked: the May 29 H6 #308 / Bandoleros event (id 1481362937047925)
    // returns its real SSR detail page; every other event returns 404 so the
    // listing-tab data still emits but description-derived fields stay
    // undefined for those rows. Real timers — `enrichWithDetails` sleeps
    // 200ms between each detail fetch and we have 7 of them, so the
    // beforeEach's fake timers would deadlock.
    vi.useRealTimers();
    mockedFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/HollyweirdH6/upcoming_hosted_events")) {
        return Promise.resolve(htmlResponse(HOLLYWEIRD_UPCOMING_HTML));
      }
      if (u.includes("/events/1481362937047925/")) {
        return Promise.resolve(htmlResponse(HOLLYWEIRD_BANDOLEROS_DETAIL_HTML));
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        text: async () => "not found",
      } as Response);
    });

    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "h6",
        pageHandle: "HollyweirdH6",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
      { days: 365 },
    );

    expect(result.events.length).toBeGreaterThanOrEqual(7);

    // Find the well-formed runNumber events (3 of 7 titles use H6#NNN
    // without a trailing `?` placeholder marker).
    const concreteRunNumbers = result.events
      .map((e) => e.runNumber)
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => a - b);
    expect(concreteRunNumbers).toEqual([307, 308, 308]);

    // Placeholder titles ("H6#28?", "H6#31?", "H6#23?") clear runNumber to
    // null — the explicit-clear sentinel.
    const explicitNull = result.events.filter((e) => e.runNumber === null);
    expect(explicitNull.length).toBeGreaterThanOrEqual(3);

    // The Bandoleros event detail returned a real description → hares +
    // locationStreet must be populated for that row.
    const bandoleros = result.events.find((e) =>
      e.sourceUrl?.includes("/events/1481362937047925/"),
    );
    expect(bandoleros).toBeDefined();
    expect(bandoleros?.runNumber).toBe(308);
    expect(bandoleros?.hares).toBe(
      "Senorita Pink Taco and/or ¿ Going or Cumin ?",
    );
    expect(bandoleros?.locationStreet).toBe(
      "208 SW 2nd St, Fort Lauderdale, FL 33301",
    );
    expect(bandoleros?.description).toMatch(/Hare:/);
  });

  // #1496 / #1499 / #1500 — Source-coverage-gap signal: SSR envelope intact
  // but every event candidate was filtered for content reasons. Distinguishes
  // "this kennel doesn't use FB Events" / "the Page admin posted notices
  // instead of trails" from the normal "Page has nothing scheduled" case.
  it("flags a coverage-gap error when every candidate is filtered as an admin notice", async () => {
    const adminNoticeHtml =
      `<html><body>` +
      `<script type="application/json">{"require":[["RelayPrefetchedStreamCache","next",[],[]]]}</script>` +
      `<script type="application/json">{
        "rich":{"__typename":"Event","id":"123456789012345","name":"Moving to a new website site - Last day in Meetup is March 10th"},
        "time":{"id":"123456789012345","start_timestamp":1778353200}
      }</script>` +
      `</body></html>`;
    mockedFetch.mockResolvedValueOnce(htmlResponse(adminNoticeHtml));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "narwhal-h3",
        pageHandle: "HashNarwhal",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/all were content-filtered/i);
    expect(result.errors[0]).toMatch(/admin-notice=1/);
    expect(result.diagnosticContext).toMatchObject({
      parserFiltered: expect.objectContaining({ "admin-notice": 1 }),
    });
  });

  it("does NOT flag coverage-gap when the page genuinely has no events (no candidates filtered)", async () => {
    // Distinguishes #1496's "Page exists but no Hosted Events feature" case:
    // SSR intact, parser sees zero candidate bags. This is the legitimate
    // empty-page case and must not surface the coverage-gap error.
    const emptyHtml =
      `<html><body>` +
      `<script type="application/json">{"require":[["RelayPrefetchedStreamCache","next",[],[]]]}</script>` +
      `</body></html>`;
    mockedFetch.mockResolvedValueOnce(htmlResponse(emptyHtml));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "swh3",
        pageHandle: "sirwaltersh3",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("flags a coverage-gap when every candidate is a placeholder (#1497-style)", async () => {
    const placeholderOnlyHtml =
      `<html><body>` +
      `<script type="application/json">{"require":[["RelayPrefetchedStreamCache","next",[],[]]]}</script>` +
      `<script type="application/json">{
        "rich":{"__typename":"Event","id":"123456789012345","name":"Test"},
        "time":{"id":"123456789012345","start_timestamp":1778353200}
      }</script>` +
      `</body></html>`;
    mockedFetch.mockResolvedValueOnce(htmlResponse(placeholderOnlyHtml));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "swh3",
        pageHandle: "sirwaltersh3",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/placeholder=1/);
  });

  // Codex P1: cancelled / missing-half / no-title / invalid-time are NOT
  // content quality issues — they're shape drift or legitimate FB state.
  // The coverage-gap signal must NOT fire on a Page where every candidate
  // happens to be cancelled (which is a real, normal state).
  it("does NOT flag coverage-gap when every candidate is cancelled (Codex P1)", async () => {
    const allCancelledHtml =
      `<html><body>` +
      `<script type="application/json">{"require":[["RelayPrefetchedStreamCache","next",[],[]]]}</script>` +
      `<script type="application/json">{
        "rich":{"__typename":"Event","id":"100000000000001","name":"Real Trail #42","is_canceled":true},
        "time":{"id":"100000000000001","start_timestamp":1778353200}
      }</script>` +
      `</body></html>`;
    mockedFetch.mockResolvedValueOnce(htmlResponse(allCancelledHtml));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "x",
        pageHandle: "x",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toEqual([]);
    expect(result.errors.filter((e) => /content-filtered/i.test(e))).toEqual([]);
  });

  it("does NOT flag coverage-gap when every candidate is missing-half (Codex P1)", async () => {
    // Time-only nodes (no rich __typename:Event) are shape drift, not a
    // content-quality issue. EVENT_COUNT_ANOMALY + the shape-break
    // heuristic cover this — coverage-gap must not double-fire.
    const missingHalfHtml =
      `<html><body>` +
      `<script type="application/json">{"require":[["RelayPrefetchedStreamCache","next",[],[]]]}</script>` +
      `<script type="application/json">{"e":{"id":"100000000000001","start_timestamp":1778353200}}</script>` +
      `</body></html>`;
    mockedFetch.mockResolvedValueOnce(htmlResponse(missingHalfHtml));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "x",
        pageHandle: "x",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toEqual([]);
    expect(result.errors.filter((e) => /content-filtered/i.test(e))).toEqual([]);
  });

  it("does NOT flag coverage-gap when at least one real event is emitted alongside filtered ones", async () => {
    const mixedHtml =
      `<html><body>` +
      `<script type="application/json">{"require":[["RelayPrefetchedStreamCache","next",[],[]]]}</script>` +
      `<script type="application/json">{
        "rich":{"__typename":"Event","id":"100000000000001","name":"Test"},
        "time":{"id":"100000000000001","start_timestamp":1778353200}
      }</script>` +
      `<script type="application/json">{
        "rich":{"__typename":"Event","id":"100000000000002","name":"Real Trail #42","event_place":{"contextual_name":"Bar"}},
        "time":{"id":"100000000000002","start_timestamp":1778353200}
      }</script>` +
      `</body></html>`;
    // Detail-page fetches for the real event will 404 (we don't mock them) —
    // that's fine, the listing data still emits.
    mockedFetch.mockImplementation((url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/upcoming_hosted_events")) {
        return Promise.resolve(htmlResponse(mixedHtml));
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => "" } as Response);
    });
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "swh3",
        pageHandle: "sirwaltersh3",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(42);
    // No coverage-gap error — real events made it through.
    expect(result.errors.filter((e) => /all were content-filtered/i.test(e))).toEqual([]);
  });

  it("does NOT flag shape-break when a fat empty-Page response carries SSR envelope markers (#1294 audit fix)", async () => {
    // Real-world: empty FB Pages still ship 600KB+ SSR bundles with the
    // RelayPrefetchedStreamCache / __bbox envelope intact. The byte-count
    // heuristic mis-classified those as shape rotations; the envelope
    // check correctly identifies them as legit "no upcoming events" pages.
    const fatEmptyWithEnvelope =
      `<html><body>${"x".repeat(700_000)}` +
      `<script type="application/json">{"require":[["RelayPrefetchedStreamCache","next",[],[]]]}</script>` +
      `<div data-bbox='{"__bbox":{"complete":true,"result":{"data":null}}}'></div>` +
      `</body></html>`;
    mockedFetch.mockResolvedValueOnce(htmlResponse(fatEmptyWithEnvelope));
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(
      makeSource({
        kennelTag: "gsh3",
        pageHandle: "GrandStrandHashing",
        timezone: "America/New_York",
        upcomingOnly: true,
      }),
    );
    expect(result.events).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
