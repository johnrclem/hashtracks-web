import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import { parseDateFromTitle, extractPostcode, parseRunCard } from "./city-hash";
import { CityHashAdapter } from "./city-hash";

describe("parseDateFromTitle", () => {
  it("parses ordinal date with short month", () => {
    expect(parseDateFromTitle("City Hash R*n #1910 - 24th Feb 2026")).toBe("2026-02-24");
  });

  it("parses 1st with full month", () => {
    expect(parseDateFromTitle("City Hash R*n #1915 - 1st March 2026")).toBe("2026-03-01");
  });

  it("parses 2nd", () => {
    expect(parseDateFromTitle("R*n #100 - 2nd Jan 2026")).toBe("2026-01-02");
  });

  it("parses 3rd", () => {
    expect(parseDateFromTitle("R*n #100 - 3rd April 2026")).toBe("2026-04-03");
  });

  it("parses 11th (not 1st)", () => {
    expect(parseDateFromTitle("R*n #100 - 11th December 2025")).toBe("2025-12-11");
  });

  it("returns null for missing date", () => {
    expect(parseDateFromTitle("City Hash R*n #1910")).toBeNull();
  });

  it("returns null for invalid month", () => {
    expect(parseDateFromTitle("R*n #1 - 5th Flob 2026")).toBeNull();
  });
});

describe("extractPostcode", () => {
  it("extracts standard UK postcode", () => {
    expect(extractPostcode("The Beehive SE11 5JA")).toBe("SE11 5JA");
  });

  it("extracts postcode from full address", () => {
    expect(extractPostcode("The Roundhouse, 2 North Side, London SW18 2SS")).toBe("SW18 2SS");
  });

  it("extracts postcode with single-letter area", () => {
    expect(extractPostcode("The Eagle N1 9AA")).toBe("N1 9AA");
  });

  it("extracts postcode with letter in district", () => {
    expect(extractPostcode("Ye Olde Cheshire Cheese EC4A 2BU")).toBe("EC4A 2BU");
  });

  it("returns null when no postcode present", () => {
    expect(extractPostcode("The Pub, London")).toBeNull();
  });
});

const SAMPLE_HTML = `
<div class="ch-runlist-container">
  <div class="ch-run">
    <div class="ch-run-title"><h5>City Hash R*n #1910 - 24th Feb 2026</h5></div>
    <div class="ch-run-location">
      <a href="https://maps.google.com/?q=51.48513,-0.11880">The Beehive SE11 5JA</a>
    </div>
    <div class="ch-run-ptransport">
      <a href="https://tfl.gov.uk">Vauxhall</a>
    </div>
    <div class="ch-run-description">
      <p>Hare - Tuna Melt</p>
      <p>Pub - The Beehive</p>
      <p>Station - Vauxhall</p>
    </div>
  </div>
  <div class="ch-run">
    <div class="ch-run-title"><h5>City Hash R*n #1911 - 3rd March 2026</h5></div>
    <div class="ch-run-location">
      <a href="https://maps.google.com/?q=51.5074,-0.1278">The Eagle N1 9AA</a>
    </div>
    <div class="ch-run-ptransport">
      <a href="https://tfl.gov.uk">Angel</a>
    </div>
    <div class="ch-run-description">
      <p>Hare - Zippy and Bungle</p>
      <p>Some special theme info</p>
    </div>
  </div>
  <div class="ch-run">
    <div class="ch-run-title"><h5>City Hash R*n #1912 - 10th March 2026</h5></div>
    <div class="ch-run-location">
      <a href="">TBC</a>
    </div>
    <div class="ch-run-description">
      <p>Hare - TBC</p>
    </div>
  </div>
</div>
`;

describe("parseRunCard", () => {
  const $ = cheerio.load(SAMPLE_HTML);
  const cards = $(".ch-run");

  it("parses first run card with all fields", () => {
    const event = parseRunCard($, cards.eq(0), "https://cityhash.org.uk/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-02-24");
    expect(event!.kennelTag).toBe("CityH3");
    expect(event!.runNumber).toBe(1910);
    expect(event!.hares).toBe("Tuna Melt");
    expect(event!.location).toBe("The Beehive");
    expect(event!.locationUrl).toBe("https://maps.google.com/?q=51.48513,-0.11880");
    expect(event!.startTime).toBe("19:00");
    expect(event!.description).toContain("Nearest station: Vauxhall");
    expect(event!.description).toContain("Postcode: SE11 5JA");
  });

  it("parses second card with multiple hares and theme", () => {
    const event = parseRunCard($, cards.eq(1), "https://cityhash.org.uk/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-03");
    expect(event!.runNumber).toBe(1911);
    expect(event!.hares).toBe("Zippy and Bungle");
    expect(event!.location).toBe("The Eagle");
    expect(event!.description).toContain("Nearest station: Angel");
    expect(event!.description).toContain("Some special theme info");
  });

  it("parses TBC card (minimal data)", () => {
    const event = parseRunCard($, cards.eq(2), "https://cityhash.org.uk/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-10");
    expect(event!.runNumber).toBe(1912);
    expect(event!.hares).toBe("TBC");
  });
});

describe("CityHashAdapter.fetch", () => {
  it("parses sample HTML and returns events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new CityHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://cityhash.org.uk/",
    } as never);

    expect(result.events).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBeDefined();
    expect(result.diagnosticContext).toMatchObject({
      cardsFound: 3,
      eventsParsed: 3,
    });

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new CityHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://cityhash.org.uk/",
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

    const adapter = new CityHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://cityhash.org.uk/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(404);

    vi.restoreAllMocks();
  });
});
