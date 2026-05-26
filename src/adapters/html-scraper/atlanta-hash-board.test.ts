vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "@/adapters/safe-fetch";
import {
  parseAtomFeed,
  isReplyEntry,
  extractEventDate,
  extractEventFields,
  stripPhpBbBanners,
  AtlantaHashBoardAdapter,
} from "./atlanta-hash-board";

const mockSafeFetch = vi.mocked(safeFetch);

// Adapter only touches a small surface of Response (`ok`, `status`, `text`),
// so build a partial stub and cast once here rather than per call site.
const mockResponse = (init: Partial<Response>): Response => init as Response;

// ── Sample Atom XML fixtures ──

const SAMPLE_ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atlanta Hash Board - Atlanta Hash (Saturdays)</title>
  <entry>
    <title type="html"><![CDATA[Atlanta Hash (Saturdays) • Saturday Saturday Saturday Dr. PP & Big Bore]]></title>
    <published>2026-03-03T22:58:10+00:00</published>
    <author><name><![CDATA[Headnurse]]></name></author>
    <link href="https://board.atlantahash.com/viewtopic.php?p=1011#p1011"/>
    <category term="Atlanta Hash (Saturdays)" label="Atlanta Hash (Saturdays)"/>
    <content type="html"><![CDATA[
      Hares: Dr PP &amp; Big Bore<br>
      Start: Lake City, GA -- Parking lot off Main St<br>
      <a href="https://maps.app.goo.gl/abc123">Map Link</a><br>
      Time: Gather 1:30 Hounds out at 2:00 PM<br>
      Cost: $10 covers beer and food
    ]]></content>
  </entry>
  <entry>
    <title type="html"><![CDATA[Atlanta Hash (Saturdays) • Re: Last week's recap]]></title>
    <published>2026-03-02T15:00:00+00:00</published>
    <author><name><![CDATA[SomeUser]]></name></author>
    <link href="https://board.atlantahash.com/viewtopic.php?p=1010#p1010"/>
    <category term="Atlanta Hash (Saturdays)" label="Atlanta Hash (Saturdays)"/>
    <content type="html"><![CDATA[Great trail last week!]]></content>
  </entry>
  <entry>
    <title type="html"><![CDATA[Moonlite H3 • Moonlite #1638 March 10th]]></title>
    <published>2026-03-04T10:00:00+00:00</published>
    <author><name><![CDATA[LunarHare]]></name></author>
    <link href="https://board.atlantahash.com/viewtopic.php?p=1012#p1012"/>
    <category term="Moonlite H3" label="Moonlite H3"/>
    <content type="html"><![CDATA[
      Hares: Lunar Eclipse &amp; Stargazer<br>
      Where: Piedmont Park, Atlanta<br>
      Time: Meet at 6:30 PM, Trail at 7:00 PM<br>
      Run #1638
    ]]></content>
  </entry>
</feed>`;

// ── parseAtomFeed ──

describe("parseAtomFeed", () => {
  it("parses entries from valid Atom XML", () => {
    const entries = parseAtomFeed(SAMPLE_ATOM_FEED);
    expect(entries).toHaveLength(3);
    expect(entries[0].title).toContain("Dr. PP & Big Bore");
    expect(entries[0].published).toBe("2026-03-03T22:58:10+00:00");
    expect(entries[0].author).toBe("Headnurse");
    expect(entries[0].link).toContain("viewtopic.php");
    expect(entries[0].category).toBe("Atlanta Hash (Saturdays)");
    expect(entries[0].content).toContain("Hares:");
  });

  it("handles empty feed", () => {
    const entries = parseAtomFeed(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`);
    expect(entries).toHaveLength(0);
  });

  it("decodes HTML entities in title and author", () => {
    const entries = parseAtomFeed(SAMPLE_ATOM_FEED);
    expect(entries[0].title).toContain("Dr. PP & Big Bore");
    expect(entries[0].title).not.toContain("&amp;");
  });
});

// ── isReplyEntry ──

describe("isReplyEntry", () => {
  it("detects reply entries with bullet + Re:", () => {
    expect(isReplyEntry("Atlanta Hash (Saturdays) • Re: Last week's recap")).toBe(true);
  });

  it("detects reply entries with middle dot + Re:", () => {
    expect(isReplyEntry("Moonlite H3 · Re: Some topic")).toBe(true);
  });

  it("does not flag original topic posts", () => {
    expect(isReplyEntry("Atlanta Hash (Saturdays) • Saturday Trail Dr. PP")).toBe(false);
  });

  it("does not flag titles without bullet separator", () => {
    expect(isReplyEntry("Moonlite #1638 March 10th")).toBe(false);
  });
});

// ── extractEventDate ──

describe("extractEventDate", () => {
  it("extracts explicit date from body (When: 3/8/26)", () => {
    const date = extractEventDate(
      "BSH3 • Black Sheep Sunday Trail",
      "When: 3/8/26\nHares: Woolly Mammoth",
      "2026-03-01T08:00:00+00:00",
      "Sunday",
    );
    expect(date).toBe("2026-03-08");
  });

  it("extracts date from title (March 10th)", () => {
    const date = extractEventDate(
      "Moonlite H3 • Moonlite #1638 March 10th",
      "No date in body",
      "2026-03-04T10:00:00+00:00",
      "Monday",
    );
    expect(date).toBe("2026-03-10");
  });

  it("infers date from hashDay when no explicit date", () => {
    const date = extractEventDate(
      "Atlanta Hash (Saturdays) • Some Trail Name",
      "Hares: SomeHare\nStart: Some place",
      "2026-03-03T22:58:10+00:00", // Tuesday post
      "Saturday",
    );
    // Next Saturday after March 3 (Tuesday) is March 7
    expect(date).toBe("2026-03-07");
  });

  it("infers same-day date when posted on hash day", () => {
    const date = extractEventDate(
      "Atlanta Hash (Saturdays) • Today's Trail",
      "Hares: FastFeet\nStart: Midtown",
      "2026-03-07T10:00:00+00:00", // Saturday post
      "Saturday",
    );
    // Should return same-day Saturday (March 7), not next week
    expect(date).toBe("2026-03-07");
  });

  it("returns null for invalid post date", () => {
    const date = extractEventDate("Title", "Body", "not-a-date", "Saturday");
    expect(date).toBeNull();
  });
});

// ── extractEventFields ──

describe("extractEventFields", () => {
  it("extracts hares from body", () => {
    const fields = extractEventFields("Hares: Dr PP &amp; Big Bore<br>Start: Lake City");
    expect(fields.hares).toBe("Dr PP & Big Bore");
  });

  it("extracts location from Start: label", () => {
    const fields = extractEventFields("Start: Lake City, GA -- Parking lot<br>Time: 2:00 PM");
    expect(fields.location).toBe("Lake City, GA -- Parking lot");
  });

  it("extracts location from Where: label", () => {
    const fields = extractEventFields("Where: Piedmont Park, Atlanta<br>");
    expect(fields.location).toBe("Piedmont Park, Atlanta");
  });

  it("extracts Google Maps URL", () => {
    const fields = extractEventFields('<a href="https://maps.app.goo.gl/abc123">Map</a>');
    expect(fields.locationUrl).toBe("https://maps.app.goo.gl/abc123");
  });

  it("extracts time in 12-hour format", () => {
    const fields = extractEventFields("Time: Gather 1:30 Hounds out at 2:00 PM<br>");
    expect(fields.startTime).toBe("14:00");
  });

  it("extracts run number", () => {
    const fields = extractEventFields("Run #1638<br>Hares: Someone");
    expect(fields.runNumber).toBe(1638);
  });

  it("extracts cost into description", () => {
    const fields = extractEventFields("Cost: $10 covers beer<br>");
    expect(fields.description).toContain("Hash Cash: $10");
  });

  it("strips embedded time from location", () => {
    const fields = extractEventFields("Start: bankhead station at 1:30<br>Time: 1:30 PM");
    expect(fields.location).toBe("bankhead station");
  });

  it("strips embedded time with AM/PM from location", () => {
    const fields = extractEventFields("Meet: Midtown Park at 2:00 PM<br>");
    expect(fields.location).toBe("Midtown Park");
  });

  it("handles content with no structured fields", () => {
    const fields = extractEventFields("Just some random text about hashing");
    expect(fields.hares).toBeUndefined();
    expect(fields.location).toBeUndefined();
    expect(fields.startTime).toBeUndefined();
  });

  // ── #1587: body run-number must require "Run #NNN" prose marker, not just
  // bare #NNN — street-address suite numbers (#2000) and cross-kennel
  // references (#946 was Black Sheep's) were leaking through the old loose
  // regex. Inputs derived verbatim from issue #1587 evidence.
  it.each([
    {
      name: "rejects street-address suite number",
      body: "Hares: Lunar Eclipse\nWhere: Kroger 8465 Holcomb Bridge Rd #2000, Johns Creek, GA",
      expected: undefined,
    },
    {
      name: "rejects cross-kennel reference in prose",
      body: "Black Sheep Hash House Harriers; running strong since 3/11/91, every other Sunday, now all the way to #946",
      expected: undefined,
    },
    {
      name: "accepts explicit Run #NNN marker",
      body: "Run #1638\nHares: Someone",
      expected: 1638,
    },
    {
      name: "accepts Run NNN without hash",
      body: "Run 1644\nHares: Someone",
      expected: 1644,
    },
    {
      name: "ignores small numbers but extractor returns single match",
      body: "Hares: Eclipse\nLocation: 8465 Holcomb Bridge Rd",
      expected: undefined,
    },
  ])("extractEventFields runNumber: $name", ({ body, expected }) => {
    const fields = extractEventFields(body);
    expect(fields.runNumber).toBe(expected);
  });

  // ── #1588: phpBB post-banner lines must not leak into startTime. Inputs
  // derived verbatim from issue #1588 evidence (Mar 28 first-post banner,
  // May 02 last-post banner).
  it.each([
    {
      name: "rejects banner timestamp, accepts body Meet/Trail prose",
      body: "by mtmedori » Sat Mar 28, 2026 3:19 pm\n\nHares: Eclipse\nMeet at 6:30 PM, Trail at 7:30 PM",
      expected: "18:30",
    },
    {
      name: "emits undefined when only banner timestamp is present",
      body: "by Jackass » Sat May 02, 2026 10:36 pm\n\nMay the 4th be with You",
      expected: undefined,
    },
    {
      // Banner predicate requires `»` — a line without it is treated as
      // legitimate prose (Codex review: avoid stripping event copy like
      // "Time: Saturday March 8, 2026, meet 1:30 PM"). When the body
      // contains BOTH a banner and a regular Meet line, banner is stripped
      // and the Meet line wins.
      name: "preserves date-bearing prose lines without » separator",
      body: "by mtmedori » Sat Mar 28, 2026 3:19 pm\nMeet at 7:00 PM",
      expected: "19:00",
    },
  ])("extractEventFields startTime: $name", ({ body, expected }) => {
    const fields = extractEventFields(body);
    expect(fields.startTime).toBe(expected);
  });

  // ── #1640: Pinelake markdown bold/italic asterisks + time-as-location bug ──

  it("strips markdown ** asterisks from hares (#1640 Pinelake)", () => {
    const fields = extractEventFields("Hares: ** *Debbie Does Digits*<br>Start: bankhead station");
    expect(fields.hares).toBe("Debbie Does Digits");
  });

  it("strips ** asterisks from location values (#1640)", () => {
    const fields = extractEventFields("Where: **Piedmont Park**<br>");
    expect(fields.location).toBe("Piedmont Park");
  });

  it("promotes time-only Start: value to startTime — lowercase 'pm' (#1640 case-insensitivity)", () => {
    // Mixed-case scribes are common; TIME_ONLY_RE must be case-insensitive
    // to match parse12HourTime's contract.
    const fields = extractEventFields(
      "Hares: Foo<br>Start: ** 2:15 pm<br>Location: Park",
    );
    expect(fields.startTime).toBe("14:15");
    expect(fields.location).toBe("Park");
  });

  it("promotes time-only Start: value to startTime, not location (#1640 Pinelake)", () => {
    // Source body shape from the Pinelake post (issue #1640 evidence):
    // Hares: ** *Debbie Does Digits*
    // Start: ** 1:30 PM
    // Location: bankhead station
    const fields = extractEventFields(
      "Hares: ** *Debbie Does Digits*<br>Start: ** 1:30 PM<br>Location: bankhead station",
    );
    expect(fields.hares).toBe("Debbie Does Digits");
    expect(fields.startTime).toBe("13:30");
    expect(fields.location).toBe("bankhead station");
  });

  it("leaves location undefined when only a time-only Start: is present (#1640)", () => {
    const fields = extractEventFields("Start: ** 1:30 PM");
    expect(fields.startTime).toBe("13:30");
    expect(fields.location).toBeUndefined();
  });

  it("non-time Start: value still flows to location for other Atlanta kennels (regression)", () => {
    // The existing "extracts location with Start prefix" test covers the
    // common path; this asserts the demote-time-only branch hasn't broken it.
    const fields = extractEventFields("Start: Lake City, GA -- Parking lot");
    expect(fields.location).toBe("Lake City, GA -- Parking lot");
    expect(fields.startTime).toBeUndefined();
  });
});

// ── stripPhpBbBanners ──

describe("stripPhpBbBanners", () => {
  it("strips first-post banner line with month + year", () => {
    const text = "by mtmedori » Sat Mar 28, 2026 3:19 pm\nMeet at 7:25 PM";
    expect(stripPhpBbBanners(text)).toBe("Meet at 7:25 PM");
  });

  it("preserves event-time lines that lack a year", () => {
    const text = "Time: Gather 1:30 Hounds out at 2:00 PM";
    expect(stripPhpBbBanners(text)).toBe("Time: Gather 1:30 Hounds out at 2:00 PM");
  });

  it("collapses extra blank lines after stripping", () => {
    const text = "by user » Sat Mar 28, 2026 3:19 pm\n\nHares: Foo\n\nLocation: Bar";
    expect(stripPhpBbBanners(text)).toBe("Hares: Foo\nLocation: Bar");
  });

  it("strips multiple banner lines (first-post + last-post)", () => {
    const text = "by user » Sat Mar 28, 2026 3:19 pm\nReal content\nby other » Sat Apr 04, 2026 10:36 pm";
    expect(stripPhpBbBanners(text)).toBe("Real content");
  });

  it("preserves event prose that happens to mention a month + year (no » separator)", () => {
    // Codex review: predicate must not nuke legitimate event copy like
    // "Time: Saturday March 8, 2026, meet 1:30 PM" — only true phpBB banner
    // lines (carrying the » separator) should be stripped.
    const text = "Time: Saturday March 8, 2026, meet 1:30 PM";
    expect(stripPhpBbBanners(text)).toBe(text);
  });

  it("does not match month-prefix words like 'Marching' / 'Maybe' / 'Decoration'", () => {
    // Gemini + claude-bot review on PR #1622: a quoted line with `»` plus a
    // word starting with a month-prefix plus a year must NOT be treated as a
    // banner. Switching MONTH_NAME_RE from `[a-z]*` to specific suffixes
    // (Jan(uary)?, Feb(ruary)?, ...) closes the false-positive window.
    const text = "Quote: \"the Marching Band 2026 was epic\" » she said";
    expect(stripPhpBbBanners(text)).toBe(text);
  });
});

// ── AtlantaHashBoardAdapter.fetch ──

describe("AtlantaHashBoardAdapter", () => {
  beforeEach(() => {
    mockSafeFetch.mockReset();
  });

  it("has correct type", () => {
    const adapter = new AtlantaHashBoardAdapter();
    expect(adapter.type).toBe("HTML_SCRAPER");
  });

  it("fetches and parses events from multiple forums", async () => {
    mockSafeFetch.mockResolvedValue(mockResponse({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ATOM_FEED),
    }));

    const adapter = new AtlantaHashBoardAdapter();
    const source = {
      id: "test-source",
      url: "https://board.atlantahash.com",
      config: {
        forums: {
          "2": { kennelTag: "ah4", hashDay: "Saturday" },
          "8": { kennelTag: "mlh4", hashDay: "Monday" },
        },
      },
    } as never;

    const result = await adapter.fetch(source, { days: 90 });

    // Should have made 2 safeFetch calls (one per forum)
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    expect(mockSafeFetch).toHaveBeenCalledWith(
      expect.stringContaining("/app.php/feed/forum/2"),
      expect.any(Object),
    );
    expect(mockSafeFetch).toHaveBeenCalledWith(
      expect.stringContaining("/app.php/feed/forum/8"),
      expect.any(Object),
    );

    // Reply entry should be skipped (1 reply per forum × 2 forums = 2)
    expect(result.diagnosticContext?.skippedReplies).toBe(2);
    // Each forum has 2 non-reply entries; events within date window should be parsed
    expect(result.events.length).toBeGreaterThan(0);
    // Attribution check — every event must carry the kennelTag from its forum config
    const tags = new Set(result.events.flatMap((e) => e.kennelTags));
    expect(tags.has("ah4") || tags.has("mlh4")).toBe(true);
    expect(tags.has(undefined as unknown as string)).toBe(false);
  });

  it("handles fetch errors gracefully", async () => {
    mockSafeFetch.mockResolvedValue(mockResponse({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    }));

    const adapter = new AtlantaHashBoardAdapter();
    const source = {
      id: "test-source",
      url: "https://board.atlantahash.com",
      config: {
        forums: {
          "2": { kennelTag: "ah4", hashDay: "Saturday" },
        },
      },
    } as never;

    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errorDetails?.fetch).toBeDefined();
  });

  it("rejects invalid config", async () => {
    const adapter = new AtlantaHashBoardAdapter();
    const source = {
      id: "test-source",
      url: "https://board.atlantahash.com",
      config: null,
    } as never;

    await expect(adapter.fetch(source)).rejects.toThrow("source.config is null");
  });

  // Per-source useResidentialProxy flag — origin WAF blocks cloud-egress IPs (#633);
  // adapter forwards the flag to safeFetch when the source row opts in, else defaults false.
  it.each([
    { configValue: true, expectedForwarded: true, label: "true forwards through" },
    { configValue: undefined, expectedForwarded: false, label: "undefined defaults to false" },
  ])("useResidentialProxy: $label", async ({ configValue, expectedForwarded }) => {
    mockSafeFetch.mockResolvedValue(mockResponse({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ATOM_FEED),
    }));

    const adapter = new AtlantaHashBoardAdapter();
    const config: Record<string, unknown> = {
      forums: { "2": { kennelTag: "ah4", hashDay: "Saturday" } },
    };
    if (configValue !== undefined) config.useResidentialProxy = configValue;
    const source = {
      id: "test-source",
      url: "https://board.atlantahash.com",
      config,
    } as never;

    await adapter.fetch(source);

    expect(mockSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ useResidentialProxy: expectedForwarded }),
    );
  });
});
