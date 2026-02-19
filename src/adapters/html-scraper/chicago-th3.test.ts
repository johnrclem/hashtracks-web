import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import {
  parseRunNumber,
  parseDateFromTitle,
  parseDateFromDatetime,
  parseBodyFields,
  parseTimeString,
  parseArticle,
} from "./chicago-th3";
import { ChicagoTH3Adapter } from "./chicago-th3";

describe("parseRunNumber", () => {
  it("parses run number from standard title", () => {
    expect(parseRunNumber("TH3 #1060 – October 3, 2024")).toBe(1060);
  });

  it("parses run number from short title", () => {
    expect(parseRunNumber("TH3 #1058")).toBe(1058);
  });

  it("returns null for title without run number", () => {
    expect(parseRunNumber("Special Event")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRunNumber("")).toBeNull();
  });
});

describe("parseDateFromTitle", () => {
  it("parses date from full TH3 title", () => {
    expect(parseDateFromTitle("TH3 #1060 – October 3, 2024")).toBe("2024-10-03");
  });

  it("parses date from title with September", () => {
    expect(parseDateFromTitle("TH3 #1058 – September 19, 2024")).toBe("2024-09-19");
  });

  it("parses date from standalone text", () => {
    expect(parseDateFromTitle("February 15, 2026")).toBe("2026-02-15");
  });

  it("parses abbreviated month", () => {
    expect(parseDateFromTitle("TH3 #999 – Jan 5, 2025")).toBe("2025-01-05");
  });

  it("returns null for invalid month", () => {
    expect(parseDateFromTitle("TH3 #1060 – Foobar 3, 2024")).toBeNull();
  });

  it("returns null for title without date", () => {
    expect(parseDateFromTitle("TH3 #1060")).toBeNull();
  });
});

describe("parseDateFromDatetime", () => {
  it("parses ISO datetime with timezone", () => {
    expect(parseDateFromDatetime("2024-10-03T19:00:00-05:00")).toBe("2024-10-03");
  });

  it("parses date-only format", () => {
    expect(parseDateFromDatetime("2024-10-03")).toBe("2024-10-03");
  });

  it("returns null for invalid format", () => {
    expect(parseDateFromDatetime("October 3, 2024")).toBeNull();
  });
});

describe("parseTimeString", () => {
  it("parses 7:00 PM", () => {
    expect(parseTimeString("7:00 PM")).toBe("19:00");
  });

  it("parses 7:30 PM", () => {
    expect(parseTimeString("7:30 PM")).toBe("19:30");
  });

  it("parses 24-hour format", () => {
    expect(parseTimeString("19:30")).toBe("19:30");
  });

  it("returns null for no time", () => {
    expect(parseTimeString("Thursday evening")).toBeNull();
  });
});

describe("parseBodyFields", () => {
  it("extracts all TH3 fields", () => {
    const body = "HARE: Trail Blazer  WHERE: Lincoln Park, near the zoo entrance  WHEN: 7:00 PM  HASH CASH: $7  WALKER'S TRAIL: Yes";
    const result = parseBodyFields(body);
    expect(result.hares).toBe("Trail Blazer");
    expect(result.location).toBe("Lincoln Park, near the zoo entrance");
    expect(result.startTime).toBe("19:00");
    expect(result.hashCash).toBe("$7");
    expect(result.walkersTrail).toBe("Yes");
  });

  it("handles HARES plural", () => {
    const body = "HARES: Alpha and Bravo  WHERE: Wicker Park";
    const result = parseBodyFields(body);
    expect(result.hares).toBe("Alpha and Bravo");
  });

  it("extracts location without other fields", () => {
    const body = "WHERE: Downtown Chicago  HARE: Solo Runner";
    const result = parseBodyFields(body);
    expect(result.location).toBe("Downtown Chicago");
    expect(result.hares).toBe("Solo Runner");
  });

  it("returns empty fields for body without labels", () => {
    const body = "Just a description of the run";
    const result = parseBodyFields(body);
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.hashCash).toBeUndefined();
  });

  it("handles body with only hare field", () => {
    const body = "HARE: Only Runner";
    const result = parseBodyFields(body);
    expect(result.hares).toBe("Only Runner");
    expect(result.location).toBeUndefined();
  });


  it("does not stop location at bare label words inside values", () => {
    const body = "WHERE: Meet at When Pigs Fly, near Hare & Hounds Pub  HARE: Solo Runner";
    const result = parseBodyFields(body);
    expect(result.location).toBe("Meet at When Pigs Fly, near Hare & Hounds Pub");
    expect(result.hares).toBe("Solo Runner");
  });

  it("supports dash delimiters while preserving label words in values", () => {
    const body = "WHERE - The When and Where Tavern HARE - Hare Trigger WHEN - 7:30 PM";
    const result = parseBodyFields(body);
    expect(result.location).toBe("The When and Where Tavern");
    expect(result.hares).toBe("Hare Trigger");
    expect(result.startTime).toBe("19:30");
  });
});

const SAMPLE_HTML = `
<html>
<body>
<main>
  <article class="post-101">
    <header>
      <h2 class="entry-title">
        <a href="https://chicagoth3.com/th3-1060/">TH3 #1060 – October 3, 2024</a>
      </h2>
      <time class="entry-date" datetime="2024-10-03T19:00:00-05:00">October 3, 2024</time>
    </header>
    <div class="entry-content">
      <p>HARE: Trail Blazer  WHERE: Lincoln Park, near the zoo entrance  WHEN: 7:00 PM  HASH CASH: $7  WALKER'S TRAIL: Yes</p>
    </div>
  </article>
  <article class="post-102">
    <header>
      <h2 class="entry-title">
        <a href="https://chicagoth3.com/th3-1059/">TH3 #1059 – September 26, 2024</a>
      </h2>
      <time class="entry-date" datetime="2024-09-26T19:00:00-05:00">September 26, 2024</time>
    </header>
    <div class="entry-content">
      <p>HARES: Alpha and Bravo  WHERE: Wicker Park  HASH CASH: $5</p>
    </div>
  </article>
  <article class="post-103">
    <header>
      <h2 class="entry-title">
        <a href="https://chicagoth3.com/th3-1058/">TH3 #1058 – September 19, 2024</a>
      </h2>
      <time class="entry-date" datetime="2024-09-19T19:00:00-05:00">September 19, 2024</time>
    </header>
    <div class="entry-content">
      <p>Run details coming soon.</p>
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
  <article class="post-104">
    <header>
      <h2 class="entry-title">
        <a href="https://chicagoth3.com/th3-1057/">TH3 #1057 – September 12, 2024</a>
      </h2>
      <time class="entry-date" datetime="2024-09-12T19:00:00-05:00">September 12, 2024</time>
    </header>
    <div class="entry-content">
      <p>HARE: Charlie  WHERE: Uptown  HASH CASH: $7</p>
    </div>
  </article>
</main>
</body>
</html>
`;

describe("parseArticle", () => {
  const $ = cheerio.load(SAMPLE_HTML);
  const articles = $("article");

  it("parses article with all TH3 fields", () => {
    const event = parseArticle($, articles.eq(0), "https://chicagoth3.com/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2024-10-03");
    expect(event!.kennelTag).toBe("TH3");
    expect(event!.runNumber).toBe(1060);
    expect(event!.title).toBe("TH3 #1060 – October 3, 2024");
    expect(event!.hares).toBe("Trail Blazer");
    expect(event!.location).toBe("Lincoln Park, near the zoo entrance");
    expect(event!.startTime).toBe("19:00");
    expect(event!.sourceUrl).toBe("https://chicagoth3.com/th3-1060/");
    expect(event!.description).toContain("Hash Cash: $7");
    expect(event!.description).toContain("Walker's Trail: Yes");
  });

  it("parses article with multiple hares", () => {
    const event = parseArticle($, articles.eq(1), "https://chicagoth3.com/");
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(1059);
    expect(event!.hares).toBe("Alpha and Bravo");
    expect(event!.location).toBe("Wicker Park");
  });

  it("parses article with minimal body content", () => {
    const event = parseArticle($, articles.eq(2), "https://chicagoth3.com/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2024-09-19");
    expect(event!.runNumber).toBe(1058);
    expect(event!.hares).toBeUndefined();
    // TH3 defaults to 19:00 when no time in body
    expect(event!.startTime).toBe("19:00");
  });
});

describe("ChicagoTH3Adapter.fetch", () => {
  it("parses sample HTML and returns events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new ChicagoTH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://chicagoth3.com/",
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

    const adapter = new ChicagoTH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://chicagoth3.com/",
    } as never);

    expect(result.events).toHaveLength(4); // 3 from page 1 + 1 from page 2
    expect(result.diagnosticContext).toMatchObject({
      pagesFetched: 2,
      eventsParsed: 4,
    });

    vi.restoreAllMocks();
  });

  it("reports error when later page fails with HTTP error", async () => {
    const page1Html = SAMPLE_HTML.replace(
      "</main>",
      '<nav><a class="next" href="/page/2/">Older posts</a></nav></main>',
    );

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(page1Html, { status: 200 }))
      .mockResolvedValueOnce(new Response("Server Error", { status: 500, statusText: "Internal Server Error" }));

    const adapter = new ChicagoTH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://chicagoth3.com/",
    } as never);

    expect(result.events).toHaveLength(3);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errorDetails?.fetch).toHaveLength(1);
    expect(result.errorDetails!.fetch![0].status).toBe(500);

    vi.restoreAllMocks();
  });

  it("reports error when later page fails with network error", async () => {
    const page1Html = SAMPLE_HTML.replace(
      "</main>",
      '<nav><a class="next" href="/page/2/">Older posts</a></nav></main>',
    );

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(page1Html, { status: 200 }))
      .mockRejectedValueOnce(new Error("Connection reset"));

    const adapter = new ChicagoTH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://chicagoth3.com/",
    } as never);

    expect(result.events).toHaveLength(3);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Connection reset");
    expect(result.errorDetails?.fetch).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new ChicagoTH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://chicagoth3.com/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errorDetails?.fetch).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("returns fetch error on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not found", { status: 404, statusText: "Not Found" }),
    );

    const adapter = new ChicagoTH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://chicagoth3.com/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(404);

    vi.restoreAllMocks();
  });

  it("uses default URL when source URL is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new ChicagoTH3Adapter();
    await adapter.fetch({ id: "test", url: "" } as never);

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://chicagoth3.com/",
      expect.any(Object),
    );

    vi.restoreAllMocks();
  });
});
