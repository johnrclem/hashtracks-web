import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import {
  parseRunNumber,
  parseDateFromDatetime,
  parseDateFromText,
  parseBodyFields,
  parseTimeString,
  parseArticle,
} from "./chicago-hash";
import { ChicagoHashAdapter } from "./chicago-hash";

describe("parseRunNumber", () => {
  it("parses run number from standard title", () => {
    expect(parseRunNumber("CH3 #2580")).toBe(2580);
  });

  it("parses run number from title with event name", () => {
    expect(parseRunNumber("CH3 Run #2580 – Groundhog Day Hash")).toBe(2580);
  });

  it("parses run number from title with just hash symbol", () => {
    expect(parseRunNumber("#100")).toBe(100);
  });

  it("returns null for title without run number", () => {
    expect(parseRunNumber("Special Event Hash")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRunNumber("")).toBeNull();
  });
});

describe("parseDateFromDatetime", () => {
  it("parses ISO datetime with timezone", () => {
    expect(parseDateFromDatetime("2026-02-15T14:00:00-06:00")).toBe("2026-02-15");
  });

  it("parses date-only format", () => {
    expect(parseDateFromDatetime("2026-02-15")).toBe("2026-02-15");
  });

  it("returns null for invalid format", () => {
    expect(parseDateFromDatetime("Feb 15, 2026")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseDateFromDatetime("")).toBeNull();
  });
});

describe("parseDateFromText", () => {
  it("parses full month name with comma", () => {
    expect(parseDateFromText("February 15, 2026")).toBe("2026-02-15");
  });

  it("parses abbreviated month", () => {
    expect(parseDateFromText("Feb 15, 2026")).toBe("2026-02-15");
  });

  it("parses without comma", () => {
    expect(parseDateFromText("March 5 2026")).toBe("2026-03-05");
  });

  it("parses single-digit day", () => {
    expect(parseDateFromText("January 3, 2026")).toBe("2026-01-03");
  });

  it("returns null for invalid month", () => {
    expect(parseDateFromText("Flob 15, 2026")).toBeNull();
  });

  it("returns null for missing year", () => {
    expect(parseDateFromText("February 15")).toBeNull();
  });
});

describe("parseTimeString", () => {
  it("parses 12-hour PM time", () => {
    expect(parseTimeString("2:00 PM")).toBe("14:00");
  });

  it("parses 12-hour AM time", () => {
    expect(parseTimeString("10:30 AM")).toBe("10:30");
  });

  it("parses 7:00 PM", () => {
    expect(parseTimeString("7:00 PM")).toBe("19:00");
  });

  it("parses lowercase am/pm", () => {
    expect(parseTimeString("7:30pm")).toBe("19:30");
  });

  it("handles 12:00 PM (noon)", () => {
    expect(parseTimeString("12:00 PM")).toBe("12:00");
  });

  it("handles 12:00 AM (midnight)", () => {
    expect(parseTimeString("12:00 AM")).toBe("00:00");
  });

  it("parses 24-hour format", () => {
    expect(parseTimeString("14:00")).toBe("14:00");
  });

  it("returns null for no time", () => {
    expect(parseTimeString("no time listed")).toBeNull();
  });
});

describe("parseBodyFields", () => {
  it("extracts all fields from full body text", () => {
    const body = "Venue: Joe's Bar, 123 Main St, Chicago  Hare: Speedy McFast  Event: Groundhog Day Hash  Hash Cash: $8  Transit: Take the Red Line to Fullerton";
    const result = parseBodyFields(body);
    expect(result.location).toBe("Joe's Bar, 123 Main St, Chicago");
    expect(result.hares).toBe("Speedy McFast");
    expect(result.eventName).toBe("Groundhog Day Hash");
    expect(result.hashCash).toBe("$8");
  });

  it("handles Hares (plural) label", () => {
    const body = "Venue: The Pub  Hares: Runner One and Runner Two  Hash Cash: $5";
    const result = parseBodyFields(body);
    expect(result.hares).toBe("Runner One and Runner Two");
  });

  it("extracts location from Where label", () => {
    const body = "Where: Lincoln Park  Hare: Fast Runner";
    const result = parseBodyFields(body);
    expect(result.location).toBe("Lincoln Park");
    expect(result.hares).toBe("Fast Runner");
  });

  it("extracts time from When label", () => {
    const body = "When: 2:00 PM  Venue: The Park  Hare: Someone";
    const result = parseBodyFields(body);
    expect(result.startTime).toBe("14:00");
  });

  it("returns empty fields for body without labels", () => {
    const body = "Just some random text about the hash";
    const result = parseBodyFields(body);
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
  });

  it("handles body with only hare field", () => {
    const body = "Hare: Solo Runner";
    const result = parseBodyFields(body);
    expect(result.hares).toBe("Solo Runner");
    expect(result.location).toBeUndefined();
  });
});

const SAMPLE_HTML = `
<html>
<body>
<main>
  <article class="post-1234">
    <header>
      <h2 class="entry-title">
        <a href="https://chicagohash.org/ch3-2580/">CH3 #2580</a>
      </h2>
      <time class="entry-date" datetime="2026-02-15T14:00:00-06:00">February 15, 2026</time>
    </header>
    <div class="entry-content">
      <p>Venue: Joe's Bar, 123 Main St, Chicago  Hare: Speedy McFast  Event: Groundhog Day Hash  Hash Cash: $8</p>
    </div>
  </article>
  <article class="post-1235">
    <header>
      <h2 class="entry-title">
        <a href="https://chicagohash.org/ch3-2579/">CH3 #2579 – Super Bowl Hash</a>
      </h2>
      <time class="entry-date" datetime="2026-02-08T14:00:00-06:00">February 8, 2026</time>
    </header>
    <div class="entry-content">
      <p>Venue: Stadium Bar, 456 Elm Ave  Hares: Alpha and Bravo  Hash Cash: $10  Transit: Blue Line to Jackson</p>
    </div>
  </article>
  <article class="post-1236">
    <header>
      <h2 class="entry-title">
        <a href="https://chicagohash.org/special-event/">Annual Pub Crawl</a>
      </h2>
      <time class="entry-date" datetime="2026-01-31T19:00:00-06:00">January 31, 2026</time>
    </header>
    <div class="entry-content">
      <p>A special event with no labeled fields.</p>
    </div>
  </article>
</main>
</body>
</html>
`;

const SAMPLE_HTML_PAGE2 = `
<html>
<body>
<main>
  <article class="post-1237">
    <header>
      <h2 class="entry-title">
        <a href="https://chicagohash.org/ch3-2578/">CH3 #2578</a>
      </h2>
      <time class="entry-date" datetime="2026-01-25T14:00:00-06:00">January 25, 2026</time>
    </header>
    <div class="entry-content">
      <p>Venue: North Side Pub  Hare: Charlie  Hash Cash: $7</p>
    </div>
  </article>
</main>
</body>
</html>
`;

describe("parseArticle", () => {
  const $ = cheerio.load(SAMPLE_HTML);
  const articles = $("article");

  it("parses article with all fields", () => {
    const event = parseArticle($, articles.eq(0), "https://chicagohash.org/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-02-15");
    expect(event!.kennelTag).toBe("CH3");
    expect(event!.runNumber).toBe(2580);
    expect(event!.title).toBe("CH3 #2580");
    expect(event!.hares).toBe("Speedy McFast");
    expect(event!.location).toBe("Joe's Bar, 123 Main St, Chicago");
    expect(event!.sourceUrl).toBe("https://chicagohash.org/ch3-2580/");
    expect(event!.description).toContain("Groundhog Day Hash");
    expect(event!.description).toContain("Hash Cash: $8");
  });

  it("parses article with multiple hares and event name in title", () => {
    const event = parseArticle($, articles.eq(1), "https://chicagohash.org/");
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(2579);
    expect(event!.hares).toBe("Alpha and Bravo");
    expect(event!.title).toBe("CH3 #2579 – Super Bowl Hash");
  });

  it("parses special event without run number", () => {
    const event = parseArticle($, articles.eq(2), "https://chicagohash.org/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-01-31");
    expect(event!.runNumber).toBeUndefined();
    expect(event!.title).toBe("Annual Pub Crawl");
    expect(event!.hares).toBeUndefined();
  });
});

describe("ChicagoHashAdapter.fetch", () => {
  it("parses sample HTML and returns events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new ChicagoHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://chicagohash.org/",
    } as never);

    expect(result.events).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBeDefined();
    expect(result.diagnosticContext).toMatchObject({
      pagesFetched: 1,
      eventsParsed: 3,
    });

    vi.restoreAllMocks();
  });

  it("follows pagination links", async () => {
    const page1Html = SAMPLE_HTML.replace(
      "</main>",
      '<nav><a class="next" href="/page/2/">Older posts</a></nav></main>',
    );

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(page1Html, { status: 200 }))
      .mockResolvedValueOnce(new Response(SAMPLE_HTML_PAGE2, { status: 200 }));

    const adapter = new ChicagoHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://chicagohash.org/",
    } as never);

    expect(result.events).toHaveLength(4); // 3 from page 1 + 1 from page 2
    expect(result.diagnosticContext).toMatchObject({
      pagesFetched: 2,
      eventsParsed: 4,
    });

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new ChicagoHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://chicagohash.org/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errorDetails?.fetch).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("returns fetch error on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );

    const adapter = new ChicagoHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://chicagohash.org/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(403);

    vi.restoreAllMocks();
  });

  it("uses default URL when source URL is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new ChicagoHashAdapter();
    await adapter.fetch({ id: "test", url: "" } as never);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://chicagohash.org/",
      expect.any(Object),
    );

    vi.restoreAllMocks();
  });
});
