import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseHangoverTitle, parseHangoverDate, parseHangoverBody } from "./hangover";
import { HangoverAdapter } from "./hangover";

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
});

describe("HangoverAdapter integration", () => {
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

  it("parses trail posts from Ghost listing page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }) as never
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
      kennelTag: "H4",
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
      kennelTag: "H4",
      runNumber: 213,
      title: "Need Wood",
      hares: "TestHare1 and TestHare2",
    });
  });

  it("returns fetch error on HTTP failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }) as never
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

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(html, { status: 200 }) as never
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(detailHtml, { status: 200 }) as never
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
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
