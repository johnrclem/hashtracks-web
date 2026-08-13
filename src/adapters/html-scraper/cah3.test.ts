import { parseCah3Title, parseCah3Body, parseCah3Post, Cah3Adapter } from "./cah3";
import * as wordpressApi from "../wordpress-api";

vi.mock("../wordpress-api");

const MONTH_NAMES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** A near-future date (~3 weeks out) as "YYYY-MM-DD", plus its "MMM D" title
 *  form — used so fetch()-level tests stay inside the 365-day scrape window
 *  indefinitely instead of aging out on a hardcoded year (see
 *  adapter-patterns.md "windowed adapter tests need relative dates"). */
function nearFutureDate(): { iso: string; titleText: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 21);
  const iso = d.toISOString().slice(0, 10);
  const titleText = `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return { iso, titleText };
}

describe("parseCah3Title", () => {
  it("parses run number and date from a typical title", () => {
    const result = parseCah3Title(
      "Run 533 Saturday 8th March 2025",
      "2025-03-01T00:00:00",
    );
    expect(result.runNumber).toBe(533);
    expect(result.date).toBe("2025-03-08");
  });

  it("parses colon-separated title", () => {
    const result = parseCah3Title(
      "Run 534: Songkran Outstation APR 10 & 11",
      "2025-04-01T00:00:00",
    );
    expect(result.runNumber).toBe(534);
    // Should at least get the first date
    expect(result.date).toBe("2025-04-10");
  });

  it("parses title with month name and year", () => {
    const result = parseCah3Title(
      "Run 532 Saturday February 8 2025",
      "2025-01-15T00:00:00",
    );
    expect(result.runNumber).toBe(532);
    expect(result.date).toBe("2025-02-08");
  });

  it("returns undefined date when no date in title", () => {
    const result = parseCah3Title(
      "Run 530 Special Event",
      "2025-01-01T00:00:00",
    );
    expect(result.runNumber).toBe(530);
    expect(result.date).toBeUndefined();
  });

  it("infers date when publish date carries a timezone offset (utcRef regression)", () => {
    // WordPress dates may carry an offset like "+07:00". The earlier
    // utcRef helper appended "Z" unconditionally, producing an Invalid
    // Date and silently breaking year inference for every offset-bearing
    // post. This test pins the format so future helper changes can't
    // reintroduce the regression.
    const result = parseCah3Title(
      "Run 534: Songkran Outstation APR 10 & 11",
      "2026-04-07T12:40:57+07:00",
    );
    expect(result.runNumber).toBe(534);
    expect(result.date).toBe("2026-04-10");
  });
});

describe("parseCah3Body", () => {
  it("extracts labeled fields from body HTML", () => {
    const body = `
<p>Hare: Rusty Nail</p>
<p>Location: Cha-Am Beach Park</p>
<p>Time: 4:00 PM</p>
`;
    const result = parseCah3Body(body);
    expect(result.hares).toBe("Rusty Nail");
    expect(result.location).toBe("Cha-Am Beach Park");
    expect(result.startTime).toBe("16:00");
  });

  it("returns undefined for missing fields", () => {
    const body = "<p>Just some random post content</p>";
    const result = parseCah3Body(body);
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.startTime).toBeUndefined();
  });
});

describe("parseCah3Post", () => {
  it("parses a complete post", () => {
    const result = parseCah3Post({
      title: "Run 533 Saturday 8th March 2025",
      content: "<p>Hare: Rusty Nail</p><p>Location: Cha-Am Beach</p>",
      url: "https://cah3.net/?p=123",
      date: "2025-03-01T00:00:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.date).toBe("2025-03-08");
      expect(result.event.kennelTags[0]).toBe("cah3");
      expect(result.event.runNumber).toBe(533);
      expect(result.event.hares).toBe("Rusty Nail");
      expect(result.event.location).toBe("Cha-Am Beach");
      expect(result.event.sourceUrl).toBe("https://cah3.net/?p=123");
    }
  });

  it("filters non-run posts", () => {
    const result = parseCah3Post({
      title: "Welcome to Cha-Am H3",
      content: "<p>About us</p>",
      url: "https://cah3.net/?p=1",
      date: "2025-01-01T00:00:00",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-run-post");
  });

  it("returns no-date when title and body both lack a parseable date", () => {
    const result = parseCah3Post({
      title: "Run 533: Saurkrap's Cat Sanctuary Run",
      content: "<p>Some directions without a date</p>",
      url: "https://cah3.net/?p=456",
      date: "2026-03-16T12:40:57",
    });
    // Do NOT fall back to the WordPress publish date — it's the
    // announcement date and may be days before the actual Saturday run.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-date");
  });

  it("uses default start time when body has no time", () => {
    const result = parseCah3Post({
      title: "Run 533 Saturday 8th March 2025",
      content: "<p>Hare: Rusty Nail</p>",
      url: "https://cah3.net/?p=123",
      date: "2025-03-01T00:00:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.startTime).toBe("16:00");
  });
});

describe("Cah3Adapter.fetch — no-date skip vs. hard failure (#2668)", () => {
  afterEach(() => vi.restoreAllMocks());

  // cah3.net redesigned its "Run NNN" posts mid-2026 onto a template with no
  // date field anywhere; a majority of posts are expected to skip on
  // "no-date" as steady state (paired with a STATIC_SCHEDULE sibling source
  // for the recurring baseline — see seed comment). That expected partial
  // skip must NOT surface as `errors` (which drives consecutive-failure
  // alerts) as long as at least one post still yields a dated event.
  it("does not push no-date skips into errors when some posts still parse", async () => {
    const { iso, titleText } = nearFutureDate();
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValueOnce({
      posts: [
        {
          title: `Run 534: Songkran Outstation ${titleText}`,
          content: "<p>RUN DIRECTIONS</p>",
          url: "https://cah3.net/run-534/",
          date: `${iso}T09:00:00`,
        },
        {
          // New template, real content, but genuinely no date anywhere.
          title: "Run 541: Bangs My Sister & Brother Lover",
          content: "<p>Sam Phan Nam Spillway West</p>",
          url: "https://cah3.net/run-541/",
          date: `${iso}T11:19:21`,
        },
      ],
      fetchDurationMs: 150,
    });

    const result = await new Cah3Adapter().fetch({
      id: "test-cah3",
      url: "https://cah3.net",
      scrapeDays: 365,
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.diagnosticContext).toMatchObject({
      postsFound: 2,
      eventsParsed: 1,
      skippedNoDate: 1,
    });
  });

  it("escalates to a hard error when every post fetched lacks a date", async () => {
    const { iso } = nearFutureDate();
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValueOnce({
      posts: [
        {
          title: "Run 541: Bangs My Sister & Brother Lover",
          content: "<p>Sam Phan Nam Spillway West</p>",
          url: "https://cah3.net/run-541/",
          date: `${iso}T11:19:21`,
        },
        {
          title: "Run 540: Majestic Ballcock & HTT",
          content: "<p>GPS Coordinates N 12.5248534</p>",
          url: "https://cah3.net/run-540/",
          date: `${iso}T10:26:59`,
        },
      ],
      fetchDurationMs: 150,
    });

    const result = await new Cah3Adapter().fetch({
      id: "test-cah3",
      url: "https://cah3.net",
      scrapeDays: 365,
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
