import {
  parseAtomFeed,
  isReplyEntry,
  extractEventDate,
  extractEventFields,
  AtlantaHashBoardAdapter,
} from "./atlanta-hash-board";

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

  it("handles content with no structured fields", () => {
    const fields = extractEventFields("Just some random text about hashing");
    expect(fields.hares).toBeUndefined();
    expect(fields.location).toBeUndefined();
    expect(fields.startTime).toBeUndefined();
  });
});

// ── AtlantaHashBoardAdapter.fetch ──

describe("AtlantaHashBoardAdapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("has correct type", () => {
    const adapter = new AtlantaHashBoardAdapter();
    expect(adapter.type).toBe("HTML_SCRAPER");
  });

  it("fetches and parses events from multiple forums", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ATOM_FEED),
    });
    vi.stubGlobal("fetch", mockFetch);

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

    // Should have made 2 fetch calls (one per forum)
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/app.php/feed/forum/2"),
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/app.php/feed/forum/8"),
      expect.any(Object),
    );

    // Reply entry should be skipped (1 reply per forum × 2 forums = 2)
    expect(result.diagnosticContext?.skippedReplies).toBe(2);
    // Each forum has 2 non-reply entries; events within date window should be parsed
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("handles fetch errors gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });
    vi.stubGlobal("fetch", mockFetch);

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
});
