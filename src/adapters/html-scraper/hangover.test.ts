import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseHangoverTitle,
  parseHangoverDate,
  parseHangoverBody,
  extractTrailSection,
  HangoverAdapter,
} from "./hangover";

describe("parseHangoverTitle", () => {
  it("parses standard title", () => {
    const result = parseHangoverTitle("#214 - The Hungover Hearts Trail");
    expect(result).toEqual({
      runNumber: 214,
      trailName: "The Hungover Hearts Trail",
    });
  });

  it("parses title with em-dash", () => {
    const result = parseHangoverTitle("#213 — Need Wood");
    expect(result).toEqual({
      runNumber: 213,
      trailName: "Need Wood",
    });
  });

  it("parses title with en-dash", () => {
    const result = parseHangoverTitle("#212 – The Hangover H3 New Years 2026 Trail");
    expect(result).toEqual({
      runNumber: 212,
      trailName: "The Hangover H3 New Years 2026 Trail",
    });
  });

  it("returns null for non-matching title", () => {
    expect(parseHangoverTitle("About the Hangover Hash")).toBeNull();
    expect(parseHangoverTitle("Hash Markings Guide")).toBeNull();
  });
});

describe("parseHangoverDate", () => {
  it("parses 'Sunday, February 15th, 2026'", () => {
    expect(parseHangoverDate("Sunday, February 15th, 2026")).toBe("2026-02-15");
  });

  it("parses 'Saturday, April 12, 2025' (no ordinal)", () => {
    expect(parseHangoverDate("Saturday, April 12, 2025")).toBe("2025-04-12");
  });

  it("parses 'Sunday, May 4th, 2025'", () => {
    expect(parseHangoverDate("Sunday, May 4th, 2025")).toBe("2025-05-04");
  });

  it("parses 'Thursday, January 1st, 2026'", () => {
    expect(parseHangoverDate("Thursday, January 1st, 2026")).toBe("2026-01-01");
  });

  it("returns null for invalid input", () => {
    expect(parseHangoverDate("TBD")).toBeNull();
    expect(parseHangoverDate("no date here")).toBeNull();
  });
});

describe("parseHangoverBody", () => {
  it("extracts all labeled fields", () => {
    const text = [
      "Date: Sunday, February 15th, 2026",
      "Hare(s): Just Rebekah and Grinding Nemo",
      "Trail Start: Leesburg Town Hall Garage, 10 Loudoun St SW, Leesburg, VA 20175",
      "Hash Cash: $7.00 US",
      "Trail Type: A to A",
      "Pack Away at 10:15am",
      "Eagle ~7.69 miles long",
      "Turkey ~5.2 miles total",
      "Penguin ~3.8 miles short loop",
      "On-After: Silver Branch Rockville Beerworks",
    ].join("\n");

    const result = parseHangoverBody(text);
    expect(result.date).toBe("2026-02-15");
    expect(result.hares).toBe("Just Rebekah and Grinding Nemo");
    expect(result.location).toBe("Leesburg Town Hall Garage, 10 Loudoun St SW, Leesburg, VA 20175");
    expect(result.hashCash).toBe("$7.00 US");
    expect(result.trailType).toBe("A to A");
    expect(result.startTime).toBe("10:15");
    expect(result.distances).toContain("Eagle: ~7.69 mi");
    expect(result.distances).toContain("Turkey: ~5.2 mi");
    expect(result.distances).toContain("Penguin: ~3.8 mi");
    expect(result.onAfter).toBe("Silver Branch Rockville Beerworks");
  });

  it("extracts date from When label", () => {
    const text = "When: Sunday, October 12th, 2025\nHare(s): Test Hare";
    const result = parseHangoverBody(text);
    expect(result.date).toBe("2025-10-12");
  });

  it("handles missing fields", () => {
    const text = "Date: Sunday, March 9, 2025";
    const result = parseHangoverBody(text);
    expect(result.date).toBe("2025-03-09");
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
  });

  it("falls back to chrono-node for free-form dates without label", () => {
    // New Ghost theme: dates appear as free-form text without Date:/When: prefix
    const text = "Sunday, March 8th, 2026 Hare(s): Test Hare Trail Start: Some Park";
    const result = parseHangoverBody(text);
    expect(result.date).toBe("2026-03-08");
    expect(result.hares).toBe("Test Hare");
    expect(result.location).toBe("Some Park");
  });
});

describe("extractTrailSection", () => {
  it("extracts text after <hr> separator", () => {
    const html = `
      <h2 id="prelubes-214">Prelubes</h2>
      <p>Friday prelube at 6pm at Some Bar</p>
      <hr>
      <h2 id="h4-trail-214">H4 Trail #214</h2>
      <p>Date: Sunday, February 15th, 2026</p>
      <p>Hare(s): Test Hare</p>
    `;
    const result = extractTrailSection(html);
    expect(result).toContain("Date: Sunday, February 15th, 2026");
    expect(result).toContain("Test Hare");
    expect(result).not.toContain("Friday prelube");
  });

  it("returns full text when no <hr> found", () => {
    const html = `
      <p>Date: Sunday, March 8th, 2026</p>
      <p>Hare(s): Solo Hare</p>
    `;
    const result = extractTrailSection(html);
    expect(result).toContain("Date: Sunday, March 8th, 2026");
    expect(result).toContain("Solo Hare");
  });

  it("handles empty HTML", () => {
    expect(extractTrailSection("")).toBe("");
    expect(extractTrailSection("<p></p>")).toBe("");
  });

  it("strips prelube dates that would confuse chrono-node", () => {
    const html = `
      <h2>Prelubes</h2>
      <p>Saturday, February 14th at 5pm at Bad Hare Brewing</p>
      <hr>
      <h2>H4 Trail</h2>
      <p>Sunday, February 15th, 2026</p>
      <p>Hare(s): Good Hare</p>
    `;
    const trailText = extractTrailSection(html);
    // Should NOT contain the prelube date
    expect(trailText).not.toContain("February 14th");
    expect(trailText).toContain("February 15th");
  });
});

describe("HangoverAdapter Ghost API integration", () => {
  const GHOST_API_RESPONSE = {
    posts: [
      {
        title: "#215 - The Spring Trail",
        url: "https://hangoverhash.digitalpress.blog/215/",
        html: `
          <h2 id="prelubes-215">Prelubes</h2>
          <p>Saturday, March 7th at 5pm at Prelube Bar</p>
          <hr>
          <h2 id="h4-trail-215">H4 Trail #215</h2>
          <p>Date: Sunday, March 8th, 2026</p>
          <p>Hare(s): Spring Runner and Trail Blazer</p>
          <p>Trail Start: Rock Creek Park, 5200 Glover Rd NW, Washington, DC 20015</p>
          <p>Hash Cash: $7.00 US</p>
          <p>Trail Type: A to A</p>
          <p>Pack Away at 10:15am</p>
          <p>Eagle ~6.5 miles</p>
          <p>Turkey ~4.2 miles</p>
          <p>On-After: Pinstripes Georgetown</p>
        `,
        published_at: "2026-03-04T12:00:00.000Z",
      },
      {
        title: "#214 - The Hungover Hearts Trail",
        url: "https://hangoverhash.digitalpress.blog/214/",
        html: `
          <h2>H4 Trail #214</h2>
          <p>Date: Sunday, February 15th, 2026</p>
          <p>Hare(s): Just Rebekah and Grinding Nemo</p>
          <p>Trail Start: Leesburg Town Hall Garage, 10 Loudoun St SW, Leesburg, VA 20175</p>
          <p>Hash Cash: $7.00 US</p>
        `,
        published_at: "2026-02-10T12:00:00.000Z",
      },
      {
        title: "About the Hangover Hash",
        url: "https://hangoverhash.digitalpress.blog/about/",
        html: "<p>We are a monthly hash in the DC area.</p>",
        published_at: "2025-01-01T12:00:00.000Z",
      },
    ],
  };

  let adapter: HangoverAdapter;

  beforeEach(() => {
    adapter = new HangoverAdapter();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("parses events from Ghost Content API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(GHOST_API_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
    );

    const result = await adapter.fetch({
      id: "test-h4",
      url: "https://hangoverhash.digitalpress.blog/",
    } as never);

    expect(result.events).toHaveLength(2); // "About" skipped (no trail number)
    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "ghost-api",
      postsFound: 3,
      eventsParsed: 2,
    });

    // First event — has prelubes section (should be stripped)
    expect(result.events[0]).toMatchObject({
      date: "2026-03-08",
      kennelTag: "h4",
      runNumber: 215,
      title: "The Spring Trail",
      hares: "Spring Runner and Trail Blazer",
      location: "Rock Creek Park, 5200 Glover Rd NW, Washington, DC 20015",
      startTime: "10:15",
      sourceUrl: "https://hangoverhash.digitalpress.blog/215/",
    });
    expect(result.events[0].description).toContain("Hash Cash: $7.00 US");

    // Second event — no prelubes section
    expect(result.events[1]).toMatchObject({
      date: "2026-02-15",
      kennelTag: "h4",
      runNumber: 214,
      title: "The Hungover Hearts Trail",
      hares: "Just Rebekah and Grinding Nemo",
    });
  });

  it("extracts correct trail date, not prelube date", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(GHOST_API_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
    );

    const result = await adapter.fetch({
      id: "test-h4",
      url: "https://hangoverhash.digitalpress.blog/",
    } as never);

    // Trail date should be March 8, NOT the prelube date of March 7
    expect(result.events[0].date).toBe("2026-03-08");
  });

  it("falls back to HTML scraping when Ghost API returns empty", async () => {
    // Ghost API returns empty
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ posts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
    );

    // HTML fallback
    const fallbackHtml = `
<html><body>
  <article class="gh-card">
    <h2><a href="/214/">#214 - The Hungover Hearts Trail</a></h2>
    <time datetime="2026-02-10">Feb 10, 2026</time>
    <div class="gh-card-excerpt">
      <p>Date: Sunday, February 15th, 2026</p>
      <p>Hare(s): Just Rebekah</p>
      <p>Trail Start: Leesburg</p>
      <p>Hash Cash: $7.00</p>
    </div>
  </article>
</body></html>`;
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(fallbackHtml, { status: 200 }) as never,
    );

    const result = await adapter.fetch({
      id: "test-h4",
      url: "https://hangoverhash.digitalpress.blog/",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "html-scrape",
    });
    expect(result.events[0].date).toBe("2026-02-15");
  });

  it("falls back to HTML scraping when Ghost API errors", async () => {
    // Ghost API 500 → 0 events → falls through to HTML scrape
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }) as never,
    );
    // HTML scrape also fails (simulating total outage)
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Server Error", { status: 500 }) as never,
    );

    const result = await adapter.fetch({
      id: "test-h4",
      url: "https://hangoverhash.digitalpress.blog/",
    } as never);

    // Both paths failed — should get HTML scrape result (the fallback path)
    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.diagnosticContext).toBeUndefined(); // HTML scrape error has no diagnosticContext
    // Verify both API and HTML fetch were attempted
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses published_at as date fallback when body has no date", async () => {
    const response = {
      posts: [
        {
          title: "#216 - Mystery Trail",
          url: "https://hangoverhash.digitalpress.blog/216/",
          html: "<p>Hare(s): Unknown Hare</p><p>Trail Start: Somewhere</p>",
          published_at: "2026-04-05T12:00:00.000Z",
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
    );

    const result = await adapter.fetch({
      id: "test-h4",
      url: "https://hangoverhash.digitalpress.blog/",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].date).toBe("2026-04-05");
  });
});

describe("HangoverAdapter HTML scraping (legacy)", () => {
  const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <article class="gh-card">
    <h2><a href="https://hangoverhash.digitalpress.blog/214/">#214 - The Hungover Hearts Trail</a></h2>
    <time datetime="2026-02-10">Feb 10, 2026</time>
    <div class="gh-card-excerpt">
      <p>Date: Sunday, February 15th, 2026</p>
      <p>Hare(s): Just Rebekah and Grinding Nemo</p>
      <p>Trail Start: Leesburg Town Hall Garage, 10 Loudoun St SW, Leesburg, VA 20175</p>
      <p>Hash Cash: $7.00 US</p>
      <p>Pack Away at 10:15am</p>
      <p>Eagle ~7.69 miles</p>
      <p>Turkey ~5.2 miles</p>
      <p>Penguin ~3.8 miles</p>
      <p>On-After: Silver Branch Rockville Beerworks</p>
    </div>
  </article>
  <article class="gh-card">
    <h2><a href="https://hangoverhash.digitalpress.blog/213/">#213 - Need Wood</a></h2>
    <time datetime="2026-01-06">Jan 6, 2026</time>
    <div class="gh-card-excerpt">
      <p>Date: Sunday, January 11th, 2026</p>
      <p>Hare(s): TestHare1 and TestHare2</p>
      <p>Trail Start: Some Park, 123 Main St, Arlington, VA</p>
      <p>Hash Cash: $7.00 US</p>
    </div>
  </article>
  <article class="gh-card">
    <h2><a href="https://hangoverhash.digitalpress.blog/about/">About the Hangover Hash</a></h2>
    <div class="gh-card-excerpt">
      <p>We are a monthly hash in the DC area.</p>
    </div>
  </article>
</body>
</html>`;

  let adapter: HangoverAdapter;

  beforeEach(() => {
    adapter = new HangoverAdapter();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("parses trail posts from Ghost listing page via HTML fallback", async () => {
    // Ghost API returns empty → falls back to HTML
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ posts: [] }), { status: 200, headers: { "Content-Type": "application/json" } }) as never,
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }) as never,
    );

    const result = await adapter.fetch({
      id: "test-h4",
      url: "https://hangoverhash.digitalpress.blog/",
    } as never);

    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(2); // "About" page is skipped (no trail number)

    // First event
    expect(result.events[0]).toMatchObject({
      date: "2026-02-15",
      kennelTag: "h4",
      runNumber: 214,
      title: "The Hungover Hearts Trail",
      hares: "Just Rebekah and Grinding Nemo",
      location: "Leesburg Town Hall Garage, 10 Loudoun St SW, Leesburg, VA 20175",
      startTime: "10:15",
      sourceUrl: "https://hangoverhash.digitalpress.blog/214/",
    });
    expect(result.events[0].description).toContain("Hash Cash: $7.00 US");

    // Second event
    expect(result.events[1]).toMatchObject({
      date: "2026-01-11",
      kennelTag: "h4",
      runNumber: 213,
      title: "Need Wood",
      hares: "TestHare1 and TestHare2",
    });
  });

  it("returns fetch error on HTTP failure", async () => {
    // Ghost API fails
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }) as never,
    );
    // API returns 0 events → falls through to HTML scrape
    // HTML scrape also fails
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }) as never,
    );

    const result = await adapter.fetch({
      id: "test-h4",
      url: "https://hangoverhash.digitalpress.blog/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });

  it("falls back to Ghost datetime when detail page has no date", async () => {
    const html = `
<html><body>
  <article class="gh-card">
    <h2><a href="/210/">#210 - Mystery Trail</a></h2>
    <time datetime="2025-11-03">Nov 3, 2025</time>
    <div class="gh-card-excerpt"><p>No date label in body</p></div>
  </article>
</body></html>`;

    const detailHtml = `
<html><body>
  <article>
    <div class="gh-content">
      <p>Hare(s): Test Hare</p>
      <p>Trail Start: Somewhere</p>
    </div>
  </article>
</body></html>`;

    // Ghost API returns empty
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ posts: [] }), { status: 200, headers: { "Content-Type": "application/json" } }) as never,
    );
    // HTML listing
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(html, { status: 200 }) as never,
    );
    // Detail page fetch
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(detailHtml, { status: 200 }) as never,
    );

    const result = await adapter.fetch({
      id: "test-h4",
      url: "https://hangoverhash.digitalpress.blog/",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].date).toBe("2025-11-03");
    expect(result.events[0].runNumber).toBe(210);
    expect(result.events[0].hares).toBe("Test Hare");
    expect(result.events[0].location).toBe("Somewhere");
  });

  it("fetches detail page when listing lacks key trail fields", async () => {
    const listingHtml = `
<html><body>
  <article class="gh-card">
    <h2><a href="/211/">#211 - Deep Link Trail</a></h2>
    <time datetime="2025-12-01">Dec 1, 2025</time>
    <div class="gh-card-excerpt"><p>Teaser only</p></div>
  </article>
</body></html>`;

    const detailHtml = `
<html><body>
  <article>
    <div class="gh-content">
      <p>Date: Sunday, December 7th, 2025</p>
      <p>Hare(s): Hairy Potter</p>
      <p>Trail Start: The Pub, DC</p>
      <p>Hash Cash: $7.00 US</p>
    </div>
  </article>
</body></html>`;

    // Ghost API returns empty
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ posts: [] }), { status: 200, headers: { "Content-Type": "application/json" } }) as never,
    );
    vi.mocked(fetch).mockResolvedValueOnce(new Response(listingHtml, { status: 200 }) as never);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(detailHtml, { status: 200 }) as never);

    const result = await adapter.fetch({
      id: "test-h4",
      url: "https://hangoverhash.digitalpress.blog/",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      date: "2025-12-07",
      runNumber: 211,
      hares: "Hairy Potter",
      location: "The Pub, DC",
      sourceUrl: "https://hangoverhash.digitalpress.blog/211/",
    });
    // API call + HTML listing + detail page
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

// ── Location address concatenation fix ──

describe("parseHangoverBody — Cost/Directions boundary", () => {
  it("stops location capture at Cost: label", () => {
    const text = "Location: Hyattstown Fire Dept, 25801 Frederick Rd, Clarksburg, MD 20871\nCost: $20.00 for beer";
    const result = parseHangoverBody(text);
    expect(result.location).toBe("Hyattstown Fire Dept, 25801 Frederick Rd, Clarksburg, MD 20871");
    expect(result.location).not.toContain("$20");
  });

  it("stops location capture at Directions: label", () => {
    const text = "Location: The Pub, 123 Main St\nDirections: Take I-270 North";
    const result = parseHangoverBody(text);
    expect(result.location).toBe("The Pub, 123 Main St");
    expect(result.location).not.toContain("270");
  });
});

describe("extractTrailSection — br preservation", () => {
  it("preserves <br> as newlines in trail section", () => {
    const html = `<hr><p>Location: Venue Name<br>123 Street<br>City, MD 21701</p>`;
    const result = extractTrailSection(html);
    expect(result).toContain("Venue Name\n123 Street\nCity, MD 21701");
  });
});

describe("extractTrailSection — trail before <hr> (post #212 structure)", () => {
  it("returns before-hr text when trail header is before <hr>", () => {
    const html = `
      <h2>H4 Trail #212</h2>
      <p>Thursday January 1st, 2026</p>
      <p>Hare(s): Straight in the Navy</p>
      <p>Where: Black Hill Regional Park, 20926 Lake Ridge Dr, Boyds, MD 20841</p>
      <hr>
      <h2>Hangover Helper</h2>
      <p>Where: Hyattstown Volunteer Fire Department</p>
      <p>Cost: $20.00</p>
    `;
    const result = extractTrailSection(html);
    expect(result).toContain("H4 Trail #212");
    expect(result).toContain("Black Hill Regional Park");
    expect(result).toContain("Straight in the Navy");
    expect(result).not.toContain("Hyattstown");
    expect(result).not.toContain("Hangover Helper");
  });

  it("still returns after-hr text for standard prelubes → trail structure", () => {
    const html = `
      <h2>Prelubes</h2>
      <p>Friday prelube at 6pm at Some Bar</p>
      <hr>
      <h2>H4 Trail #215</h2>
      <p>Date: Sunday, March 8th, 2026</p>
    `;
    const result = extractTrailSection(html);
    expect(result).toContain("H4 Trail #215");
    expect(result).toContain("March 8th");
    expect(result).not.toContain("Friday prelube");
  });
});

describe("parseHangoverDate — no-comma day-of-week", () => {
  it("parses 'Thursday January 1st, 2026' (no comma after day)", () => {
    // This goes through parseHangoverBody's chrono fallback (no Date: label)
    const result = parseHangoverBody("Thursday January 1st, 2026 Hare(s): Test");
    expect(result.date).toBe("2026-01-01");
  });

  it("parses 'Sunday January 11th, 2026' (no comma after day)", () => {
    const result = parseHangoverBody("Sunday January 11th, 2026 Hare(s): Test");
    expect(result.date).toBe("2026-01-11");
  });
});

describe("parseHangoverBody — compact no-label format (post #212)", () => {
  it("extracts date, hares, and location from compact format", () => {
    const text = [
      "H4 Trail #212",
      "Thursday January 1st, 2026",
      "Hare(s): Straight in the Navy",
      "Where: Black Hill Regional Park, 20926 Lake Ridge Dr, Boyds, MD 20841",
    ].join("\n");
    const result = parseHangoverBody(text);
    expect(result.date).toBe("2026-01-01");
    expect(result.hares).toBe("Straight in the Navy");
    expect(result.location).toContain("Black Hill Regional Park");
  });
});

describe("HangoverAdapter Ghost API — post #212 trail-before-hr", () => {
  let adapter: HangoverAdapter;

  beforeEach(() => {
    adapter = new HangoverAdapter();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("extracts correct date and location from trail-before-hr post", async () => {
    const response = {
      posts: [
        {
          title: "#212 – The Hangover H3 New Years 2026 Trail",
          url: "https://hangoverhash.digitalpress.blog/212/",
          html: `
            <h2>H4 Trail #212</h2>
            <p>Thursday January 1st, 2026</p>
            <p>Hare(s): Straight in the Navy</p>
            <p>Where: Black Hill Regional Park, 20926 Lake Ridge Dr, Boyds, MD 20841</p>
            <p>Hash Cash: $7.00 US</p>
            <p>Pack Away at 10:15am</p>
            <hr>
            <h2>Hangover Helper</h2>
            <p>Where: Hyattstown Volunteer Fire Department, 26161 Frederick Rd, Clarksburg, MD 20871</p>
            <p>Cost: $20.00</p>
          `,
          published_at: "2025-12-24T12:00:00.000Z",
        },
      ],
    };

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as never,
    );

    const result = await adapter.fetch({
      id: "test-h4",
      url: "https://hangoverhash.digitalpress.blog/",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      date: "2026-01-01",
      kennelTag: "h4",
      runNumber: 212,
      title: "The Hangover H3 New Years 2026 Trail",
      hares: "Straight in the Navy",
      startTime: "10:15",
    });
    expect(result.events[0].location).toContain("Black Hill Regional Park");
    expect(result.events[0].location).not.toContain("Hyattstown");
  });
});
