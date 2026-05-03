import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import {
  parseEnfieldDate,
  parseEnfieldBody,
  inferYear,
  extractStartTimeOverride,
  EnfieldHashAdapter,
} from "./enfield-hash";

// Stub proxy env vars to prevent adapter from routing through residential proxy
// (1Password op:// references in env are truthy but not real URLs)
beforeAll(() => {
  vi.stubEnv("RESIDENTIAL_PROXY_URL", "");
  vi.stubEnv("RESIDENTIAL_PROXY_KEY", "");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("inferYear", () => {
  it("returns current year when date is within 6 months", () => {
    const now = new Date("2026-02-24T12:00:00Z");
    expect(inferYear(3, 25, now)).toBe(2026); // March — 1 month ahead
    expect(inferYear(1, 21, now)).toBe(2026); // January — 1 month ago
  });

  it("returns previous year when date is >6 months in the future", () => {
    // Scraping in Feb 2026, see December → Dec 2026 would be ~10 months ahead → use 2025
    const now = new Date("2026-02-24T12:00:00Z");
    expect(inferYear(12, 17, now)).toBe(2025);
    expect(inferYear(11, 15, now)).toBe(2025);
  });

  it("returns next year when date is >6 months in the past", () => {
    // Scraping in Dec 2025, see January → Jan 2025 would be ~11 months ago → use 2026
    const now = new Date("2025-12-15T12:00:00Z");
    expect(inferYear(1, 21, now)).toBe(2026);
    expect(inferYear(2, 18, now)).toBe(2026);
  });

  it("handles boundary months correctly", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    // December is ~6 months away — should stay current year (just at boundary)
    expect(inferYear(12, 15, now)).toBe(2026);
    // January is ~5 months ago — should stay current year
    expect(inferYear(1, 15, now)).toBe(2026);
  });
});

describe("parseEnfieldDate", () => {
  const now = new Date("2026-02-24T12:00:00Z");

  // --- Formats with explicit year (backward compat) ---

  it("parses UK ordinal date", () => {
    expect(parseEnfieldDate("18th March 2026")).toBe("2026-03-18");
  });

  it("parses UK date with day name", () => {
    expect(parseEnfieldDate("Wednesday 18th March 2026")).toBe("2026-03-18");
  });

  it("parses date without ordinal suffix", () => {
    expect(parseEnfieldDate("18 March 2026")).toBe("2026-03-18");
  });

  it("parses DD/MM/YYYY format", () => {
    expect(parseEnfieldDate("18/03/2026")).toBe("2026-03-18");
  });

  it("parses US-style date (Month DD, YYYY)", () => {
    expect(parseEnfieldDate("March 18, 2026")).toBe("2026-03-18");
  });

  it("parses 1st, 2nd, 3rd ordinals", () => {
    expect(parseEnfieldDate("1st January 2026")).toBe("2026-01-01");
    expect(parseEnfieldDate("2nd February 2026")).toBe("2026-02-02");
    expect(parseEnfieldDate("3rd March 2026")).toBe("2026-03-03");
  });

  it("returns null for invalid month", () => {
    expect(parseEnfieldDate("18th Flub 2026")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseEnfieldDate("")).toBeNull();
  });

  // --- Year-less formats (new site) ---

  it("parses year-less date with day name: 'Wed 25 February'", () => {
    expect(parseEnfieldDate("Wed 25 February", now)).toBe("2026-02-25");
  });

  it("parses year-less date without day name: '25 February'", () => {
    expect(parseEnfieldDate("25 February", now)).toBe("2026-02-25");
  });

  it("parses year-less date with ordinal: '17th December'", () => {
    // December is >6 months ahead from Feb 2026 → infers 2025
    expect(parseEnfieldDate("17th December", now)).toBe("2025-12-17");
  });

  it("parses year-less date embedded in title: 'Run 318 - Wed 25 February'", () => {
    expect(parseEnfieldDate("Run 318 - Wed 25 February", now)).toBe("2026-02-25");
  });

  it("prefers explicit year over year inference", () => {
    // If text has "25 February 2025" with explicit year, use it
    expect(parseEnfieldDate("25 February 2025", now)).toBe("2025-02-25");
  });

  it("trusts chrono for DD/MM/YY format", () => {
    expect(parseEnfieldDate("25/02/26", now)).toBe("2026-02-25");
  });

  it("trusts chrono for DD/MM/YYYY format", () => {
    expect(parseEnfieldDate("25/02/2026", now)).toBe("2026-02-25");
  });
});

describe("parseEnfieldBody", () => {
  const now = new Date("2026-02-24T12:00:00Z");

  // --- Labeled field format (backward compat) ---

  it("parses labeled fields", () => {
    const text = "Date: Wednesday 18th March 2026\nPub: The King's Head\nStation: Enfield Chase\nHare: Speedy";
    const result = parseEnfieldBody(text);
    expect(result.date).toBe("2026-03-18");
    expect(result.location).toBe("The King's Head, Enfield, London");
    expect(result.station).toBe("Enfield Chase");
    expect(result.hares).toBe("Speedy");
  });

  it("parses with 'When:' and 'Where:' labels", () => {
    const text = "When: 15th April 2026\nWhere: The Rose and Crown\nHare: Muddy Boots";
    const result = parseEnfieldBody(text);
    expect(result.date).toBe("2026-04-15");
    expect(result.location).toBe("The Rose and Crown, Enfield, London");
    expect(result.hares).toBe("Muddy Boots");
  });

  it("extracts date from unlabeled text", () => {
    const text = "Next run is on 20th May 2026 at the usual spot";
    const result = parseEnfieldBody(text);
    expect(result.date).toBe("2026-05-20");
  });

  it("handles TBA hare", () => {
    const text = "Date: 18th March 2026\nHare: TBA\nPub: TBC";
    const result = parseEnfieldBody(text);
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
  });

  it("handles multiple hares", () => {
    const text = "Date: 18th March 2026\nHares: Flash & Muddy";
    const result = parseEnfieldBody(text);
    expect(result.hares).toBe("Flash & Muddy");
  });

  it("returns undefined date for text without date", () => {
    const text = "Welcome to the hash! Next run details coming soon.";
    const result = parseEnfieldBody(text);
    expect(result.date).toBeUndefined();
  });

  it("does not truncate pub name containing 'Station' (e.g. The Station Hotel)", () => {
    const text = "Date: 18th March 2026\nPub: The Station Hotel\nStation: Enfield Chase\nHare: Speedy";
    const result = parseEnfieldBody(text);
    expect(result.location).toBe("The Station Hotel, Enfield, London");
    expect(result.station).toBe("Enfield Chase");
  });

  it("does not truncate pub name containing 'Start' or 'Time'", () => {
    const text = "Date: 18th March 2026\nPub: The Time and Tide\nHare: Flash";
    const result = parseEnfieldBody(text);
    expect(result.location).toBe("The Time and Tide, Enfield, London");
  });

  it("does not truncate station containing 'Meet' (e.g. Meeting House Lane)", () => {
    const text = "Date: 18th March 2026\nStation: Meeting House Lane\nPub: The Crown\nHare: Muddy";
    const result = parseEnfieldBody(text);
    expect(result.station).toBe("Meeting House Lane");
    expect(result.location).toBe("The Crown, Enfield, London");
  });

  it("does not truncate hare name containing label words", () => {
    const text = "Date: 18th March 2026\nHare: Where's Wally\nPub: The Fox";
    const result = parseEnfieldBody(text);
    expect(result.hares).toBe("Where's Wally");
  });

  // --- Unstructured prose format (new site) ---

  it("extracts station from prose: 'P trail from Gordon Hill station'", () => {
    const text = "Rose and Crown pub, Clay Hill, Enfield. P trail from Gordon Hill station. Bring a torch!";
    const result = parseEnfieldBody(text, now);
    expect(result.station).toBe("Gordon Hill");
  });

  it("extracts location from prose: 'running from The Wonder'", () => {
    const text = "As is tradition, we will be running from The Wonder, with a mulled wine and mince pie stop";
    const result = parseEnfieldBody(text, now);
    expect(result.location).toBe("The Wonder, Enfield, London");
  });

  it("extracts full address from 'running from' prose (Chase Side, Enfield)", () => {
    const text = "We are running from The Cricketers, Chase Side, Enfield. P trail from Enfield Chase station.";
    const result = parseEnfieldBody(text, now);
    expect(result.location).toBe("The Cricketers, Chase Side, Enfield, London");
    expect(result.station).toBe("Enfield Chase");
  });

  it("extracts location from 'Meet at' prose pattern", () => {
    const text = "Meet at The Old Wheatsheaf, opposite Enfield Chase station. Bring a torch!";
    const result = parseEnfieldBody(text, now);
    expect(result.location).toBe("The Old Wheatsheaf, opposite Enfield Chase station, London");
  });

  it("extracts location from 'pub' keyword prose pattern", () => {
    const text = "Rose and Crown pub, Clay Hill, Enfield. P trail from Gordon Hill station.";
    const result = parseEnfieldBody(text, now);
    expect(result.location).toBe("Rose and Crown pub, Clay Hill, Enfield, London");
  });

  it("appends Enfield and London to locations that lack them for geocoding (#1135)", () => {
    const text = "Pub: The King's Head";
    const result = parseEnfieldBody(text, now);
    expect(result.location).toBe("The King's Head, Enfield, London");
  });

  it("does not double-append London when location already names it (#1135)", () => {
    const text = "Pub: The Old Wheatsheaf, Chase Side, London";
    const result = parseEnfieldBody(text, now);
    // Already contains London → no `, London` re-append. Enfield IS appended
    // because every EH3 trail is in the London borough of Enfield, so naming
    // the borough explicitly improves geocoder precision.
    expect(result.location).toBe(
      "The Old Wheatsheaf, Chase Side, London, Enfield",
    );
  });

  it("handles year-less date in prose", () => {
    const text = "RUN WILL BE ON 25 FEBRUARY";
    const result = parseEnfieldBody(text, now);
    expect(result.date).toBe("2026-02-25");
  });

  it("mis-parses bare day name as relative date (regression context for processPost fix)", () => {
    // When now is March 10 and body contains "THE FOURTH WEDNESDAY",
    // chrono picks up "WEDNESDAY" → next Wednesday (March 11), not Feb 25.
    const marchNow = new Date("2026-03-10T12:00:00Z");
    const text = "CHANGE OF DATE TO THE FOURTH WEDNESDAY - RUN WILL BE ON 25 FEBRUARY\nMeet at The Old Wheatsheaf for a 7:30pm start.";
    const result = parseEnfieldBody(text, marchNow);
    // Body parser returns March 11 (wrong) — processPost should prefer title date instead
    expect(result.date).toBe("2026-03-11");
  });
});

describe("extractStartTimeOverride (#1136)", () => {
  it("extracts 'for HH:MMpm run' (Run 319 joint-run)", () => {
    const text =
      "Joint run with Enfield Chasers - EARLY START meet 7pm for 7:15pm run";
    expect(extractStartTimeOverride(text)).toBe("19:15");
  });

  it("extracts 'for a HH:MMpm start' (Run 316 Christmas)", () => {
    const text =
      "Meet at the pub for a 7:30pm start. You will need a TORCH.";
    expect(extractStartTimeOverride(text)).toBe("19:30");
  });

  it("extracts standalone 'HH:MMpm start' anchor", () => {
    const text = "Meet at The Old Wheatsheaf for a 8:00pm start.";
    expect(extractStartTimeOverride(text)).toBe("20:00");
  });

  it("falls back to first time after 'EARLY START' when no 'for X' anchor", () => {
    const text = "EARLY START meet 6pm. Bring a torch.";
    expect(extractStartTimeOverride(text)).toBe("18:00");
  });

  it("returns undefined when body has no time mention (Run 320)", () => {
    const text =
      "We are running from The Rose and Crown, Clay Hill. P trail from Gordon Hill station. Bring a torch.";
    expect(extractStartTimeOverride(text)).toBeUndefined();
  });

  it("returns undefined for malformed time tokens", () => {
    expect(extractStartTimeOverride("for 25:99pm start")).toBeUndefined();
    expect(extractStartTimeOverride("the year 2026 starts soon")).toBeUndefined();
  });

  // Known limitations — documented as tests so future readers see what the
  // extractor doesn't catch. If a third pattern shows up in real EH3 posts,
  // extend `extractStartTimeOverride` and flip these to positive assertions.
  it("does not catch 'starts at HH(pm)' phrasing (known limitation)", () => {
    expect(extractStartTimeOverride("Run starts at 8pm")).toBeUndefined();
    expect(extractStartTimeOverride("starts 6:30pm sharp")).toBeUndefined();
  });

  it("handles 12am/12pm correctly", () => {
    expect(extractStartTimeOverride("for a 12pm start")).toBe("12:00");
    expect(extractStartTimeOverride("for a 12am start")).toBe("00:00");
  });
});

describe("EnfieldHashAdapter home.html URL construction", () => {
  let adapter: EnfieldHashAdapter;

  beforeEach(() => {
    adapter = new EnfieldHashAdapter();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body></body></html>", { status: 200 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs home.html from trailing-slash base URL", async () => {
    await adapter.fetch({ id: "test", url: "https://www.enfieldhash.org/" } as never);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("enfieldhash.org/home.html"),
      expect.anything(),
    );
  });

  it("constructs home.html from non-trailing-slash base URL", async () => {
    await adapter.fetch({ id: "test", url: "https://www.enfieldhash.org" } as never);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("enfieldhash.org/home.html"),
      expect.anything(),
    );
  });

  it("uses default URL when source.url is empty", async () => {
    await adapter.fetch({ id: "test", url: "" } as never);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("enfieldhash.org/home.html"),
      expect.anything(),
    );
  });
});

// --- New site HTML structure (current enfieldhash.org) ---

const SAMPLE_NEW_SITE_HTML = `
<html><body>
<div class="content" id="content">
  <div class="paragraph-box">
    <h1>Run 318 - Wed 25 February</h1>
    <p>CHANGE OF DATE TO THE FOURTH WEDNESDAY - RUN WILL BE ON 25 FEBRUARY</p>
    <p>Pub details to follow nearer the time.</p>
    <p>OnOn</p>
  </div>
  <div class="paragraph-box">
    <h1>Run 317 - Wed 21 January</h1>
    <p>Rose and Crown pub, Clay Hill, Enfield. P trail from Gordon Hill station. Bring a torch!</p>
    <p>OnOn</p>
  </div>
  <div class="paragraph-box">
    <h1>Run 316 - Wed 17 December</h1>
    <p>Annual Christmas Fancy Dress Run</p>
    <p>As is tradition, we will be running from The Wonder, with a mulled wine and mince pie stop</p>
    <p>Meet at the pub for a 7:30pm start. You will need a TORCH and your FANCY DRESS. P trail from Gordon Hill station.</p>
    <p>RSVP so our pastry chef and somellier can pepare.</p>
    <p>OnOn</p>
  </div>
  <div class="paragraph-box">
    <h1>Welcome to the Enfield Hash!</h1>
    <p>We are a friendly running club.</p>
    <p>OnOn</p>
  </div>
</div>
</body></html>
`;

// --- Legacy Blogger HTML structure (backward compat) ---

const SAMPLE_LEGACY_HTML = `
<html><body>
<div class="blog-posts">
  <div class="post-outer">
    <div class="post">
      <h3 class="post-title entry-title">
        <a href="http://www.enfieldhash.org/2026/03/run-266.html">Enfield Hash Run #266 - March 2026</a>
      </h3>
      <div class="post-body entry-content">
        Date: Wednesday 18th March 2026
        Pub: The King's Head, Winchmore Hill
        Station: Winchmore Hill (Overground)
        Hare: Speedy
      </div>
    </div>
  </div>
  <div class="post-outer">
    <div class="post">
      <h3 class="post-title entry-title">
        <a href="http://www.enfieldhash.org/2026/02/run-265.html">Enfield Hash Run #265 - February 2026</a>
      </h3>
      <div class="post-body entry-content">
        Date: Wednesday 18th February 2026
        Pub: The Salisbury Arms, Hoppers Road
        Station: Edmonton Green
        Hare: Muddy Boots
      </div>
    </div>
  </div>
  <div class="post-outer">
    <div class="post">
      <h3 class="post-title entry-title">
        <a href="http://www.enfieldhash.org/2026/01/happy-new-year.html">Happy New Year from EH3!</a>
      </h3>
      <div class="post-body entry-content">
        Wishing all hashers a happy new year! Details for our next run will be posted soon.
      </div>
    </div>
  </div>
</div>
</body></html>
`;

describe("EnfieldHashAdapter.fetch (new site structure)", () => {
  let adapter: EnfieldHashAdapter;

  beforeEach(() => {
    adapter = new EnfieldHashAdapter();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-02-24T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("parses events from .paragraph-box containers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_NEW_SITE_HTML, { status: 200 }),
    );

    const result = await adapter.fetch({
      id: "test",
      url: "https://www.enfieldhash.org/",
    } as never);

    // 3 events (4th post "Welcome to the Enfield Hash!" has no date)
    expect(result.events).toHaveLength(3);
    expect(result.structureHash).toBeDefined();

    const first = result.events[0];
    expect(first.kennelTags[0]).toBe("eh3");
    expect(first.startTime).toBe("19:30");
    expect(first.title).toBe("Run 318 - Wed 25 February");
    // SPA fix: fetches home.html, so sourceUrl is the home.html URL
    expect(first.sourceUrl).toBe("https://www.enfieldhash.org/home.html");
    // Date includes inferred year
    expect(first.date).toMatch(/^\d{4}-02-25$/);

    const second = result.events[1];
    expect(second.title).toBe("Run 317 - Wed 21 January");
    expect(second.date).toMatch(/^\d{4}-01-21$/);
    expect((second as unknown as Record<string, unknown>).station).toBeUndefined(); // station goes to description
    expect(second.description).toContain("Gordon Hill");

    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "html-scrape",
      postsFound: 4,
      eventsParsed: 3,
    });
  });

  it("filters out 'OnOn' from body text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_NEW_SITE_HTML, { status: 200 }),
    );

    const result = await adapter.fetch({
      id: "test",
      url: "https://www.enfieldhash.org/",
    } as never);

    // No event should have "OnOn" in its description or title
    for (const event of result.events) {
      if (event.description) {
        expect(event.description).not.toMatch(/on\s*on/i);
      }
    }
  });

  it("uses the source body prose as description (#1136)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_NEW_SITE_HTML, { status: 200 }),
    );

    const result = await adapter.fetch({
      id: "test",
      url: "https://www.enfieldhash.org/",
    } as never);

    // Run 318 body announces a date change — that callout must survive.
    const run318 = result.events.find((e) => e.title?.includes("Run 318"))!;
    expect(run318.description).toContain("CHANGE OF DATE");
    expect(run318.description).toContain("FOURTH WEDNESDAY");

    // Run 317 body mentions Gordon Hill station — still surfaced via the
    // verbatim body, no longer via a synthesized "Nearest station" string.
    const run317 = result.events.find((e) => e.title?.includes("Run 317"))!;
    expect(run317.description).toContain("Gordon Hill");
    expect(run317.description).toContain("Bring a torch");
  });

  it("prefers title date over body date when body contains ambiguous day name (Run 318 regression)", async () => {
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_NEW_SITE_HTML, { status: 200 }),
    );

    const result = await adapter.fetch({
      id: "test",
      url: "https://www.enfieldhash.org/",
    } as never);

    // Run 318 body has "THE FOURTH WEDNESDAY" which chrono misreads as March 11.
    // Title "Run 318 - Wed 25 February" has the correct date — adapter should use it.
    const run318 = result.events.find((e) => e.title?.includes("Run 318"));
    expect(run318).toBeDefined();
    expect(run318!.date).toBe("2026-02-25");
  });

  it("extracts joint-run early-start text + 7:15pm override end-to-end (#1135, #1136)", async () => {
    // Run 319 fixture — joint-run / EARLY START / 7:15pm override.
    const html =
      `<h1>Run 319 - Wed 18 March</h1>` +
      `<p>Joint run with Enfield Chasers - EARLY START meet 7pm for 7:15pm run</p>` +
      `<p>We are running from The Cricketers, Chase Side, Enfield. P trail from Enfield Chase station.</p>` +
      `<p>Bring a torch and your trail shoes.</p>` +
      `<p>OnOn</p>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(`<div class="paragraph-box">${html}</div>`, { status: 200 }),
    );

    const result = await adapter.fetch({
      id: "test",
      url: "https://www.enfieldhash.org/",
    } as never);

    expect(result.events).toHaveLength(1);
    const run319 = result.events[0];
    expect(run319.title).toBe("Run 319 - Wed 18 March");
    // Per-event override beats the kennel default of 19:30
    expect(run319.startTime).toBe("19:15");
    // Description preserves the source prose, including the joint-run callout
    expect(run319.description).toContain("Joint run");
    expect(run319.description).toContain("EARLY START");
    expect(run319.description).toContain("Bring a torch");
    // Geocode disambiguation: the displayed location now ends in `, London`
    // so the geocoder doesn't fall through to Enfield, Lincolnshire.
    expect(run319.location).toBe(
      "The Cricketers, Chase Side, Enfield, London",
    );
  });

  it("skips posts without dates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_NEW_SITE_HTML, { status: 200 }),
    );

    const result = await adapter.fetch({
      id: "test",
      url: "https://www.enfieldhash.org/",
    } as never);

    // "Welcome to the Enfield Hash!" has no date → skipped
    expect(result.events).toHaveLength(3);
    expect(result.diagnosticContext).toMatchObject({
      postsFound: 4,
      eventsParsed: 3,
    });
  });
});

describe("EnfieldHashAdapter.fetch (legacy Blogger HTML fallback)", () => {
  let adapter: EnfieldHashAdapter;

  beforeEach(() => {
    adapter = new EnfieldHashAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to .post-outer selectors for legacy HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_LEGACY_HTML, { status: 200 }),
    );

    const result = await adapter.fetch({
      id: "test",
      url: "http://www.enfieldhash.org/",
    } as never);

    // 2 events (3rd post has no date)
    expect(result.events).toHaveLength(2);
    expect(result.structureHash).toBeDefined();

    const first = result.events[0];
    expect(first.date).toBe("2026-03-18");
    expect(first.kennelTags[0]).toBe("eh3");
    expect(first.startTime).toBe("19:30");
    expect(first.location).toBe("The King's Head, Winchmore Hill, Enfield, London");
    expect(first.hares).toBe("Speedy");
    expect(first.description).toContain("Winchmore Hill");
    expect(first.sourceUrl).toBe("http://www.enfieldhash.org/2026/03/run-266.html");

    const second = result.events[1];
    expect(second.date).toBe("2026-02-18");
    expect(second.hares).toBe("Muddy Boots");

    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "html-scrape",
      postsFound: 3,
      eventsParsed: 2,
    });
  });
});

describe("EnfieldHashAdapter.fetch (error handling)", () => {
  let adapter: EnfieldHashAdapter;

  beforeEach(() => {
    adapter = new EnfieldHashAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network error"),
    );

    const result = await adapter.fetch({
      id: "test",
      url: "https://www.enfieldhash.org/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errorDetails?.fetch?.length).toBeGreaterThan(1);
  });

  it("returns fetch error on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );

    const result = await adapter.fetch({
      id: "test",
      url: "https://www.enfieldhash.org/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(403);
    expect(result.errorDetails?.fetch?.length).toBeGreaterThan(1);
  });

  it("falls back across protocol/host variants on 403", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(SAMPLE_NEW_SITE_HTML, { status: 200 }),
    );

    const result = await adapter.fetch({
      id: "test",
      url: "https://www.enfieldhash.org/",
    } as never);

    expect(result.events.length).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
