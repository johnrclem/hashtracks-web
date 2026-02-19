import { describe, it, expect, vi } from "vitest";
import { parseEnfieldDate, parseEnfieldBody } from "./enfield-hash";
import { EnfieldHashAdapter } from "./enfield-hash";

describe("parseEnfieldDate", () => {
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
});

describe("parseEnfieldBody", () => {
  it("parses labeled fields", () => {
    const text = "Date: Wednesday 18th March 2026\nPub: The King's Head\nStation: Enfield Chase\nHare: Speedy";
    const result = parseEnfieldBody(text);
    expect(result.date).toBe("2026-03-18");
    expect(result.location).toBe("The King's Head");
    expect(result.station).toBe("Enfield Chase");
    expect(result.hares).toBe("Speedy");
  });

  it("parses with 'When:' and 'Where:' labels", () => {
    const text = "When: 15th April 2026\nWhere: The Rose and Crown\nHare: Muddy Boots";
    const result = parseEnfieldBody(text);
    expect(result.date).toBe("2026-04-15");
    expect(result.location).toBe("The Rose and Crown");
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
});

const SAMPLE_BLOGGER_HTML = `
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

describe("EnfieldHashAdapter.fetch", () => {
  it("parses Blogger HTML and returns events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_BLOGGER_HTML, { status: 200 }),
    );

    const adapter = new EnfieldHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.enfieldhash.org/",
    } as never);

    // 2 events (3rd post has no date)
    expect(result.events).toHaveLength(2);
    expect(result.structureHash).toBeDefined();

    const first = result.events[0];
    expect(first.date).toBe("2026-03-18");
    expect(first.kennelTag).toBe("EH3");
    expect(first.startTime).toBe("19:30");
    expect(first.location).toBe("The King's Head, Winchmore Hill");
    expect(first.hares).toBe("Speedy");
    expect(first.description).toContain("Winchmore Hill");
    expect(first.sourceUrl).toBe("http://www.enfieldhash.org/2026/03/run-266.html");

    const second = result.events[1];
    expect(second.date).toBe("2026-02-18");
    expect(second.hares).toBe("Muddy Boots");

    vi.restoreAllMocks();
  });

  it("skips posts without dates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_BLOGGER_HTML, { status: 200 }),
    );

    const adapter = new EnfieldHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.enfieldhash.org/",
    } as never);

    // Third post ("Happy New Year") has no date and should be skipped
    expect(result.events).toHaveLength(2);
    expect(result.diagnosticContext).toMatchObject({
      postsFound: 3,
      eventsParsed: 2,
    });

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new EnfieldHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.enfieldhash.org/",
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

    const adapter = new EnfieldHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.enfieldhash.org/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(403);

    vi.restoreAllMocks();
  });
});
