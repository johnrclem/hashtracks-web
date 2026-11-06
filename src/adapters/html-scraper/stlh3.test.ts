import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseSubtitleTime,
  extractLocationFromMapsUrl,
  findMapsLink,
  parseTitleDate,
  cleanPostTitle,
  isPlausibleRunDate,
  normalizeArchivePage,
  StlH3Adapter,
} from "./stlh3";
import * as safeFetchModule from "../safe-fetch";

vi.mock("../safe-fetch");
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: () => "mock-hash",
}));

describe("parseSubtitleTime", () => {
  it("parses 5PM", () => {
    expect(parseSubtitleTime("Meet @ 5PM")).toBe("17:00");
  });

  it("parses 2pm", () => {
    expect(parseSubtitleTime("Meet @ 2pm")).toBe("14:00");
  });

  it("parses 11AM", () => {
    expect(parseSubtitleTime("Meet @ 11AM")).toBe("11:00");
  });

  it("parses time with minutes", () => {
    expect(parseSubtitleTime("Meet @ 2:30pm")).toBe("14:30");
  });

  it("parses noon", () => {
    expect(parseSubtitleTime("12PM")).toBe("12:00");
  });

  it("returns default for null", () => {
    expect(parseSubtitleTime(null)).toBe("17:00");
  });

  it("returns default for undefined", () => {
    expect(parseSubtitleTime(undefined)).toBe("17:00");
  });

  it("returns default for no time in string", () => {
    expect(parseSubtitleTime("No time here")).toBe("17:00");
  });
});

describe("extractLocationFromMapsUrl", () => {
  it("extracts location from /maps/dir// pattern", () => {
    const html = `<a href="https://www.google.com/maps/dir//Fenton+Bar+and+Grill+1025+Dougherty+Ferry+Rd+Fenton+MO+63026/@38.48,-90.44">Google Map</a>`;
    expect(extractLocationFromMapsUrl(html)).toBe(
      "Fenton Bar and Grill 1025 Dougherty Ferry Rd Fenton MO 63026",
    );
  });

  it("extracts location from /maps/place/ pattern", () => {
    const html = `<a href="https://www.google.com/maps/place/Tower+Grove+Park/@38.6,-90.26">Map</a>`;
    expect(extractLocationFromMapsUrl(html)).toBe("Tower Grove Park");
  });

  it("returns undefined for no maps links", () => {
    const html = `<p>No maps here</p>`;
    expect(extractLocationFromMapsUrl(html)).toBeUndefined();
  });

  it("falls back to link text", () => {
    const html = `<a href="https://www.google.com/maps?q=some+place">The Bar & Grill</a>`;
    expect(extractLocationFromMapsUrl(html)).toBe("The Bar & Grill");
  });

  it("returns undefined for short link text", () => {
    const html = `<a href="https://www.google.com/maps?q=x">Map</a>`;
    expect(extractLocationFromMapsUrl(html)).toBeUndefined();
  });

  it("extracts the address from a maps ?daddr= query (#2338)", () => {
    const html = `<a href="http://google.com/maps?um=1&daddr=2200+W+Port+Plaza+Dr,+St.+Louis,+MO+63146">Google Map</a>`;
    expect(extractLocationFromMapsUrl(html)).toBe(
      "2200 W Port Plaza Dr, St. Louis, MO 63146",
    );
  });

  it("returns undefined for a bare share.google shortlink (needs async resolve)", () => {
    // No inline venue — the sync helper can't resolve the redirect, so the
    // adapter's fetch() path handles it.
    const html = `<a href="https://share.google/B9WpajhNuORHjuQ5L">Google Map</a>`;
    expect(extractLocationFromMapsUrl(html)).toBeUndefined();
  });

  it("rejects a hostile href that only CONTAINS a maps host as a substring (Codex review)", () => {
    // evil.example merely embeds "share.google" in a query param — must not be
    // treated as a maps link, persisted, or followed.
    const html = `<a href="https://evil.example/?next=share.google/foo">Google Map</a>`;
    expect(findMapsLink(html)).toBeUndefined();
    expect(extractLocationFromMapsUrl(html)).toBeUndefined();
  });

  it("rejects a non-http(s) maps-shaped href", () => {
    const html = `<a href="javascript:share.google/x">Google Map</a>`;
    expect(findMapsLink(html)).toBeUndefined();
  });

  it("rejects hosts where 'google' is not the registrable domain", () => {
    // Subdomain-injection bypasses must NOT be treated as Google hosts.
    expect(findMapsLink(`<a href="https://google.evil.com/maps/place/X/">m</a>`)).toBeUndefined();
    expect(findMapsLink(`<a href="https://evil.google.attacker.com/maps">m</a>`)).toBeUndefined();
    // Genuine Google hosts still pass.
    expect(findMapsLink(`<a href="https://www.google.co.uk/maps/place/Big+Ben/">m</a>`)?.href)
      .toContain("google.co.uk");
  });
});

describe("cleanPostTitle (#808)", () => {
  it("strips date suffix after colon", () => {
    expect(cleanPostTitle("Upcumming Hash: Sunday Apr 19th 2026")).toBe(
      "Upcumming Hash",
    );
  });

  it("strips date with ordinal + year", () => {
    expect(cleanPostTitle("Upcumming Hash: Saturday Mar 22nd 2026")).toBe(
      "Upcumming Hash",
    );
  });

  it("preserves non-date suffixes", () => {
    expect(cleanPostTitle("Upcumming Hash: Halloween Edition")).toBe(
      "Upcumming Hash: Halloween Edition",
    );
  });

  it("leaves titles without a colon alone", () => {
    expect(cleanPostTitle("Weekly Announcement")).toBe("Weekly Announcement");
  });

  it("preserves relative date phrases that lack a full date", () => {
    // "Next Thursday" parses as a date in chrono but isn't the explicit
    // calendar suffix we expect — leave the title intact.
    expect(cleanPostTitle("Upcumming Hash: Next Thursday")).toBe(
      "Upcumming Hash: Next Thursday",
    );
  });

  it("preserves date-plus-extra suffixes (no over-strip)", () => {
    // A date token mid-suffix must not trigger a strip of meaningful text.
    expect(cleanPostTitle("Upcumming Hash: Apr 19 2026 Halloween Edition")).toBe(
      "Upcumming Hash: Apr 19 2026 Halloween Edition",
    );
  });

  it("strips a month-less day+year suffix (\"Sunday 27th 2026\")", () => {
    expect(cleanPostTitle("Upcumming Hash: Sunday 27th 2026")).toBe("Upcumming Hash");
  });

  it("strips from the last colon on multi-colon titles", () => {
    expect(
      cleanPostTitle("A: B: Sunday Apr 19th 2026"),
    ).toBe("A: B");
  });
});

describe("parseTitleDate", () => {
  it("parses date from after colon", () => {
    expect(parseTitleDate("Upcumming Hash: Sunday Mar 29th 2026")).toBe(
      "2026-03-29",
    );
  });

  it("parses date with ordinal suffix", () => {
    expect(parseTitleDate("Upcumming Hash: Saturday Mar 22nd 2026")).toBe(
      "2026-03-22",
    );
  });

  it("parses date without colon from full title", () => {
    expect(parseTitleDate("Sunday Mar 29th 2026 Trail")).toBe("2026-03-29");
  });

  it("returns null for unparseable date", () => {
    expect(parseTitleDate("Weekly Announcement")).toBeNull();
  });

  it("anchors a month-less title to the post's publish date, not today", () => {
    // Prod, Sep–Nov 2026: unanchored, "Sunday 27th 2026" resolved to the next
    // Sunday after each scrape and walked from Sep 27 to Nov 8.
    const published = new Date("2026-09-24T14:00:00Z");
    expect(parseTitleDate("Upcumming Hash: Sunday 27th 2026", published)).toBe("2026-09-27");
  });
});

describe("isPlausibleRunDate", () => {
  const published = new Date("2026-09-24T14:00:00Z");
  it("accepts a run a few days after the post", () => {
    expect(isPlausibleRunDate("2026-09-27", published)).toBe(true);
  });
  it("accepts a run up to a week before the post (late announcement)", () => {
    expect(isPlausibleRunDate("2026-09-20", published)).toBe(true);
  });
  it("rejects a run months after the post", () => {
    expect(isPlausibleRunDate("2027-03-01", published)).toBe(false);
  });
  it("rejects a run well before the post", () => {
    expect(isPlausibleRunDate("2026-08-01", published)).toBe(false);
  });
  it("keeps a run exactly 7 calendar days before a late-evening post", () => {
    expect(isPlausibleRunDate("2026-09-17", new Date("2026-09-24T23:30:00Z"))).toBe(true);
  });
});

describe("normalizeArchivePage", () => {
  it("accepts the legacy bare-array shape", () => {
    expect(normalizeArchivePage([])).toEqual({ posts: [], nextCursor: null });
  });
  it("accepts the { posts, nextCursor } shape", () => {
    expect(normalizeArchivePage({ posts: [], nextCursor: "abc" })).toEqual({ posts: [], nextCursor: "abc" });
  });
  it("rejects an error body", () => {
    expect(normalizeArchivePage({ errors: [{ msg: "Invalid value" }] })).toBeNull();
  });
  it("rejects a page with a null or malformed post", () => {
    expect(normalizeArchivePage({ posts: [null], nextCursor: null })).toBeNull();
    expect(normalizeArchivePage({ posts: [{ title: "x" }] })).toBeNull();
  });
  it("rejects a non-string cursor instead of treating it as the last page", () => {
    expect(normalizeArchivePage({ posts: [], nextCursor: 42 })).toBeNull();
  });
});

describe("StlH3Adapter", () => {
  const adapter = new StlH3Adapter();
  const mockSource = {
    id: "test-stlh3",
    url: "https://www.stlh3.com/",
  } as never;

  // Freeze the clock at the fixtures' era so the windowed/year-inferred assertions never age out (#2066).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses events from archive and detail pages", async () => {
    // Mock archive listing
    const archiveResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([
        {
          title: "Upcumming Hash: Sunday Mar 29th 2026",
          subtitle: "Meet @ 5PM",
          slug: "upcumming-hash-sunday-mar-29th-2026",
          post_date: "2026-03-28T13:26:47.707Z",
          canonical_url:
            "https://www.stlh3.com/p/upcumming-hash-sunday-mar-29th-2026",
          body_html: null,
        },
      ]),
    };

    // Mock detail fetch
    const detailResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        title: "Upcumming Hash: Sunday Mar 29th 2026",
        subtitle: "Meet @ 5PM",
        slug: "upcumming-hash-sunday-mar-29th-2026",
        body_html:
          '<a href="https://www.google.com/maps/dir//Fenton+Bar+and+Grill+1025+Dougherty+Ferry+Rd/@38.48,-90.44">Google Map</a>',
        canonical_url:
          "https://www.stlh3.com/p/upcumming-hash-sunday-mar-29th-2026",
      }),
    };

    vi.mocked(safeFetchModule.safeFetch)
      .mockResolvedValueOnce(archiveResponse as never)
      .mockResolvedValueOnce(detailResponse as never);

    const result = await adapter.fetch(mockSource);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].date).toBe("2026-03-29");
    expect(result.events[0].kennelTags[0]).toBe("stlh3");
    expect(result.events[0].startTime).toBe("17:00");
    expect(result.events[0].location).toBe(
      "Fenton Bar and Grill 1025 Dougherty Ferry Rd",
    );
    expect(result.events[0].sourceUrl).toBe(
      "https://www.stlh3.com/p/upcumming-hash-sunday-mar-29th-2026",
    );
  });

  it("handles events with body_html already in listing", async () => {
    const archiveResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([
        {
          title: "Upcumming Hash: Saturday Mar 22nd 2026",
          subtitle: "Meet @ 2pm",
          slug: "upcumming-hash-saturday-mar-22nd-2026",
          post_date: "2026-03-21T10:00:00Z",
          canonical_url: "https://www.stlh3.com/p/test",
          body_html:
            '<a href="https://www.google.com/maps/place/Tower+Grove+Park/@38.6,-90.26">Map</a>',
        },
      ]),
    };

    vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce(
      archiveResponse as never,
    );

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].startTime).toBe("14:00");
    expect(result.events[0].location).toBe("Tower Grove Park");
    // Should NOT have fetched detail since body_html was present
    expect(safeFetchModule.safeFetch).toHaveBeenCalledTimes(1);
  });

  it("resolves a share.google shortlink to recover the venue (#2338)", async () => {
    const archiveResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([
        {
          title: "Upcumming Hash: Sunday Mar 22nd 2026",
          subtitle: "Meet @ 5PM",
          slug: "upcumming-hash-sunday-mar-22nd-2026",
          post_date: "2026-03-21T10:00:00Z",
          canonical_url: "https://www.stlh3.com/p/upcumming-hash-sunday-mar-22nd-2026",
          body_html: '<a href="https://share.google/B9WpajhNuORHjuQ5L">Google Map</a>',
        },
      ]),
    };
    // The shortlink resolution call returns a response whose .url is the final
    // google.com/search?q= destination.
    const resolveResponse = {
      ok: true,
      status: 200,
      url: "https://www.google.com/search?q=Whitecliff+Park&kgmid=/g/11g6q30mfm",
    };

    vi.mocked(safeFetchModule.safeFetch)
      .mockResolvedValueOnce(archiveResponse as never)
      .mockResolvedValueOnce(resolveResponse as never);

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].location).toBe("Whitecliff Park");
    expect(result.events[0].locationUrl).toBe("https://share.google/B9WpajhNuORHjuQ5L");
  });

  it("ignores a shortlink resolution that returns a non-2xx response (Gemini review)", async () => {
    const archiveResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([
        {
          title: "Upcumming Hash: Sunday Mar 22nd 2026",
          subtitle: "Meet @ 5PM",
          slug: "dead-link",
          post_date: "2026-03-21T10:00:00Z",
          canonical_url: "https://www.stlh3.com/p/dead-link",
          body_html: '<a href="https://share.google/DeadLink">Google Map</a>',
        },
      ]),
    };
    // Dead shortlink → 404 whose .url is an error page; must not become a location.
    const resolveResponse = { ok: false, status: 404, url: "https://share.google/error" };
    vi.mocked(safeFetchModule.safeFetch)
      .mockResolvedValueOnce(archiveResponse as never)
      .mockResolvedValueOnce(resolveResponse as never);

    const result = await adapter.fetch(mockSource);
    expect(result.events[0].location).toBeUndefined();
    // The (validated) shortlink href is still stored as the clickable map URL.
    expect(result.events[0].locationUrl).toBe("https://share.google/DeadLink");
  });

  it("does not store or fetch a hostile body link as a location (Codex review)", async () => {
    const archiveResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([
        {
          title: "Upcumming Hash: Sunday Mar 22nd 2026",
          subtitle: "Meet @ 5PM",
          slug: "evil",
          post_date: "2026-03-21T10:00:00Z",
          canonical_url: "https://www.stlh3.com/p/evil",
          body_html: '<a href="https://evil.example/?next=share.google/foo">Google Map</a>',
        },
      ]),
    };
    vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce(archiveResponse as never);

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].location).toBeUndefined();
    expect(result.events[0].locationUrl).toBeUndefined();
    // Only the archive listing was fetched — no resolve fetch to evil.example.
    expect(safeFetchModule.safeFetch).toHaveBeenCalledTimes(1);
  });

  it("returns errors on archive fetch failure", async () => {
    vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as never);

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("500");
  });

  it("skips posts without parseable dates", async () => {
    const archiveResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([
        {
          title: "Weekly Announcement",
          subtitle: null,
          slug: "weekly-announcement",
          post_date: "2026-03-20T10:00:00Z",
          canonical_url: "https://www.stlh3.com/p/weekly-announcement",
          body_html: null,
        },
      ]),
    };

    vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce(
      archiveResponse as never,
    );

    const result = await adapter.fetch(mockSource);
    // "Weekly Announcement" matches /hash/i filter but date parse fails
    expect(result.events).toHaveLength(0);
  });

  it("filters archive posts by title keyword", async () => {
    const archiveResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue([
        {
          title: "Upcumming Hash: Sunday Mar 29th 2026",
          subtitle: "Meet @ 5PM",
          slug: "upcoming-1",
          post_date: "2026-03-28T13:00:00Z",
          canonical_url: "https://www.stlh3.com/p/upcoming-1",
          body_html: "<p>test</p>",
        },
        {
          title: "Photo Gallery from Last Week",
          subtitle: null,
          slug: "photos-1",
          post_date: "2026-03-28T10:00:00Z",
          canonical_url: "https://www.stlh3.com/p/photos-1",
          body_html: "<p>photos</p>",
        },
      ]),
    };

    vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce(
      archiveResponse as never,
    );

    const result = await adapter.fetch(mockSource);
    // Only the "Upcumming Hash" post should be processed, not "Photo Gallery"
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Upcumming Hash");
  });

  it("follows nextCursor across archive pages with limit<=25", async () => {
    const post = (title: string, slug: string, date: string) => ({
      title,
      subtitle: "Meet @ 3PM",
      slug,
      post_date: date,
      canonical_url: `https://www.stlh3.com/p/${slug}`,
      body_html: "<p>x</p>",
    });
    const page1 = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        posts: [post("Upcumming Hash: Sunday Mar 15th 2026", "mar-15", "2026-03-13T10:00:00Z")],
        nextCursor: "CURSOR1",
      }),
    };
    const page2 = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        posts: [post("Upcumming Hash: Sunday Mar 8th 2026", "mar-8", "2026-03-06T10:00:00Z")],
        nextCursor: null,
      }),
    };
    vi.mocked(safeFetchModule.safeFetch)
      .mockResolvedValueOnce(page1 as never)
      .mockResolvedValueOnce(page2 as never);

    const result = await adapter.fetch(mockSource, { days: 365 });

    const urls = vi.mocked(safeFetchModule.safeFetch).mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("limit=25");
    expect(urls[0]).not.toContain("cursor=");
    expect(urls[1]).toContain("cursor=CURSOR1");
    expect(result.events.map((e) => e.date)).toEqual(["2026-03-15", "2026-03-08"]);
    expect(result.errors).toEqual([]);
  });

  it("skips a post whose title parses far from its publish date", async () => {
    vi.mocked(safeFetchModule.safeFetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        posts: [
          {
            title: "Upcumming Hash: Sunday Dec 6th 2026",
            subtitle: null,
            slug: "typo",
            post_date: "2026-03-01T10:00:00Z",
            canonical_url: "https://www.stlh3.com/p/typo",
            body_html: "<p>x</p>",
          },
        ],
        nextCursor: null,
      }),
    } as never);

    const result = await adapter.fetch(mockSource, { days: 365 });
    expect(result.events).toHaveLength(0);
    expect(result.diagnosticContext?.implausibleDates).toBe(1);
  });

  it("keeps page-1 events and reports an error when a later page fails", async () => {
    vi.mocked(safeFetchModule.safeFetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          posts: [
            {
              title: "Upcumming Hash: Sunday Mar 15th 2026",
              subtitle: null,
              slug: "mar-15",
              post_date: "2026-03-13T10:00:00Z",
              canonical_url: "https://www.stlh3.com/p/mar-15",
              body_html: "<p>x</p>",
            },
          ],
          nextCursor: "C",
        }),
      } as never)
      .mockResolvedValueOnce({ ok: false, status: 400, statusText: "Bad Request" } as never);

    const result = await adapter.fetch(mockSource, { days: 365 });
    expect(result.events).toHaveLength(1);
    expect(result.errors[0]).toContain("page 2");
  });

  it("reports an error when the page cap truncates the window", async () => {
    const page = (i: number) => ({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        posts: [
          {
            title: "Upcumming Hash: Sunday Mar 15th 2026",
            subtitle: null,
            slug: `p${i}`,
            post_date: "2026-03-13T10:00:00Z",
            canonical_url: `https://www.stlh3.com/p/p${i}`,
            body_html: "<p>x</p>",
          },
        ],
        nextCursor: `C${i}`,
      }),
    });
    const mock = vi.mocked(safeFetchModule.safeFetch);
    for (let i = 0; i < 20; i++) mock.mockResolvedValueOnce(page(i) as never);

    const result = await adapter.fetch(mockSource, { days: 365 });
    expect(mock).toHaveBeenCalledTimes(20);
    expect(result.errors.some((e) => e.includes("truncated"))).toBe(true);
  });
});
