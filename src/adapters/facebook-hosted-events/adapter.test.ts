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
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  afterEach(() => {
    mockedFetch.mockReset();
  });

  it("rejects config missing required fields", async () => {
    const adapter = new FacebookHostedEventsAdapter();
    const result = await adapter.fetch(makeSource({}));
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toMatch(/missing required config field/);
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

  it("returns 0 events silently for a small empty-page response (legit no-events case)", async () => {
    // Small page (<200KB) + 0 events is the legit "no upcoming events"
    // shape — pass through silently so the surrounding alerts don't fire.
    mockedFetch.mockResolvedValueOnce(htmlResponse("<html><body>No events</body></html>"));
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

  it("flags a shape-break heuristic error when a heavy 200-OK response yields 0 events", async () => {
    // A fat (>200KB) page with 0 parsed events is almost certainly an SSR
    // shape change — surface as a non-fatal error so SCRAPE_FAILURE fires
    // before EVENT_COUNT_ANOMALY's baseline accrues.
    const fatHtml = "<html><body>" + "x".repeat(200_001) + "</body></html>";
    mockedFetch.mockResolvedValueOnce(htmlResponse(fatHtml));
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
    expect(result.errors[0]).toMatch(/SSR GraphQL shape change/i);
  });
});
