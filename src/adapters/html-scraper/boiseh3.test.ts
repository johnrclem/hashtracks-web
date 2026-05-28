import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseBoiseH3Page } from "./boiseh3";
import { BoiseH3Adapter } from "./boiseh3";

// Static fixture: captures the live home-page event block structure as of 2026-05-28.
// Wix wraps each content block in a [data-testid="richTextElement"] div; the
// adapter climbs to that container before calling .nextAll() so siblings are found.
const SAMPLE_HTML = `
<html>
<head><meta name="generator" content="Wix.com Website Builder" /></head>
<body>
<div data-testid="mesh-container-content">
  <div data-testid="richTextElement">
    <h1>Hash #1993 - Memorial Day Hash!</h1>
  </div>
  <div data-testid="richTextElement">
    <p>Monday, 05/25/2026 6:40 PM</p>
  </div>
  <div data-testid="richTextElement">
    <p>Castle Hills Park  5350 N Eugene St, Boise</p>
  </div>
  <div data-testid="richTextElement">
    <p>Trail: A to A</p>
  </div>
  <div data-testid="richTextElement">
    <p>Bring:  &#9679; $7 Hash Cash<br/>&#9679; Virgins<br/>&#9679; Wayward Hashers<br/>&#9679; Hashit<br/>&#9679; Hash Artifacts</p>
  </div>
  <div data-testid="richTextElement">
    <p>Hare: Stage Slut</p>
  </div>
  <div data-testid="richTextElement">
    <h2>We need Hares!</h2>
  </div>
  <p>Want to hare? Contact us!</p>
</div>
</body>
</html>
`;

// No-event fixture: page loads but no upcoming-hash heading present
const NO_EVENT_HTML = `
<html>
<head><meta name="generator" content="Wix.com Website Builder" /></head>
<body>
<h1>Welcome to Boise H3</h1>
<p>Check back soon for the next run!</p>
</body>
</html>
`;

describe("parseBoiseH3Page", () => {
  it("parses run number from heading", () => {
    const { event } = parseBoiseH3Page(SAMPLE_HTML, "https://www.boiseh3.org");
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(1993);
  });

  it("parses title from heading", () => {
    const { event } = parseBoiseH3Page(SAMPLE_HTML, "https://www.boiseh3.org");
    expect(event!.title).toBe("Memorial Day Hash!");
  });

  it("parses date as YYYY-MM-DD", () => {
    const { event } = parseBoiseH3Page(SAMPLE_HTML, "https://www.boiseh3.org");
    expect(event!.date).toBe("2026-05-25");
  });

  it("parses start time as HH:MM (24h)", () => {
    const { event } = parseBoiseH3Page(SAMPLE_HTML, "https://www.boiseh3.org");
    expect(event!.startTime).toBe("18:40");
  });

  it("includes venue name in location", () => {
    const { event } = parseBoiseH3Page(SAMPLE_HTML, "https://www.boiseh3.org");
    expect(event!.location).toContain("Castle Hills Park");
  });

  it("includes street address in location", () => {
    const { event } = parseBoiseH3Page(SAMPLE_HTML, "https://www.boiseh3.org");
    expect(event!.location).toContain("5350 N Eugene St");
  });

  it("parses hare name", () => {
    const { event } = parseBoiseH3Page(SAMPLE_HTML, "https://www.boiseh3.org");
    expect(event!.hares).toBe("Stage Slut");
  });

  it("sets kennelTags to boiseh3", () => {
    const { event } = parseBoiseH3Page(SAMPLE_HTML, "https://www.boiseh3.org");
    expect(event!.kennelTags).toEqual(["boiseh3"]);
  });

  it("sets sourceUrl to the fetch URL", () => {
    const { event } = parseBoiseH3Page(SAMPLE_HTML, "https://www.boiseh3.org");
    expect(event!.sourceUrl).toBe("https://www.boiseh3.org");
  });

  it("does not include Bring boilerplate in location or hares", () => {
    const { event } = parseBoiseH3Page(SAMPLE_HTML, "https://www.boiseh3.org");
    expect(event!.location).not.toContain("$7 Hash Cash");
    expect(event!.hares).not.toContain("Virgins");
  });

  it("returns null event with error when no hash heading found", () => {
    const { event, error } = parseBoiseH3Page(NO_EVENT_HTML, "https://www.boiseh3.org");
    expect(event).toBeNull();
    expect(error).toBeDefined();
    expect(error).toContain("no upcoming-hash heading");
  });
});

describe("BoiseH3Adapter.fetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed event on 200 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new BoiseH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.boiseh3.org",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBeDefined();
    expect(result.events[0].runNumber).toBe(1993);
    expect(result.events[0].date).toBe("2026-05-25");
    expect(result.events[0].kennelTags[0]).toBe("boiseh3");
  });

  it("returns error result on HTTP 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    const adapter = new BoiseH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.boiseh3.org",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns error result on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );

    const adapter = new BoiseH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.boiseh3.org",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns empty events with errors when page has no hash heading", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(NO_EVENT_HTML, { status: 200 }),
    );

    const adapter = new BoiseH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.boiseh3.org",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
