import { describe, it, expect, vi } from "vitest";
import type { RawEventData } from "../types";
import {
  parseBerlinH3DetailPage,
  enrichBerlinH3Events,
} from "./berlin-h3-detail-enrichment";

describe("parseBerlinH3DetailPage", () => {
  it("extracts Hares from the wp-event-manager additional-info block", () => {
    const html = `
      <html><body>
        <p class="wpem-additional-info-block-title"><strong>Hares -</strong> Symphomaniac</p>
      </body></html>
    `;
    expect(parseBerlinH3DetailPage(html).hares).toBe("Symphomaniac");
  });

  it("handles 'Hare(s) -' label variant", () => {
    const html = `
      <p class="wpem-additional-info-block-title"><strong>Hare(s) -</strong> Alpha &amp; Omega</p>
    `;
    expect(parseBerlinH3DetailPage(html).hares).toBe("Alpha & Omega");
  });

  it("handles a trailing colon instead of dash", () => {
    const html = `
      <p class="wpem-additional-info-block-title"><strong>Hares:</strong> Captain Hash</p>
    `;
    expect(parseBerlinH3DetailPage(html).hares).toBe("Captain Hash");
  });

  it("ignores unrelated additional-info paragraphs", () => {
    const html = `
      <p class="wpem-additional-info-block-title"><strong>Cost -</strong> 5 EUR</p>
      <p class="wpem-additional-info-block-title"><strong>On On On -</strong> Some Pub</p>
    `;
    expect(parseBerlinH3DetailPage(html).hares).toBeUndefined();
  });

  it("returns undefined for pages without additional-info blocks", () => {
    const html = `<html><body><h1>Full Moon Run 149</h1></body></html>`;
    expect(parseBerlinH3DetailPage(html).hares).toBeUndefined();
  });

  it("skips overly long values (noise guard)", () => {
    const longValue = "x".repeat(300);
    const html = `
      <p class="wpem-additional-info-block-title"><strong>Hares -</strong> ${longValue}</p>
    `;
    expect(parseBerlinH3DetailPage(html).hares).toBeUndefined();
  });
});

describe("enrichBerlinH3Events", () => {
  const now = new Date("2026-04-01T00:00:00Z");

  function buildEvent(overrides: Partial<RawEventData>): RawEventData {
    return {
      date: "2026-04-03",
      kennelTag: "bh3fm",
      sourceUrl: "https://www.berlin-h3.eu/event/full-moon-run-148/",
      ...overrides,
    };
  }

  it("fetches the detail page and sets hares in place", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        `<p class="wpem-additional-info-block-title"><strong>Hares -</strong> Symphomaniac</p>`,
        { status: 200 },
      ),
    );
    const events = [buildEvent({})];

    const result = await enrichBerlinH3Events(events, { now });

    expect(result.enriched).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(events[0].hares).toBe("Symphomaniac");
    vi.restoreAllMocks();
  });

  it("skips events whose sourceUrl is not a Berlin H3 permalink", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const events = [
      buildEvent({
        sourceUrl: "https://www.sfh3.com/runs/1",
      }),
    ];

    const result = await enrichBerlinH3Events(events, { now });

    expect(result.enriched).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events[0].hares).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("skips events that already have hares (steady state → no fetch)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const events = [buildEvent({ hares: "Already Set" })];

    const result = await enrichBerlinH3Events(events, { now });

    expect(result.enriched).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("skips past events (outside the upcoming window)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const events = [buildEvent({ date: "2025-01-01" })];

    const result = await enrichBerlinH3Events(events, { now });

    expect(result.enriched).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("records HTTP failures without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );
    const events = [buildEvent({})];

    const result = await enrichBerlinH3Events(events, { now });

    expect(result.enriched).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].url).toBe(events[0].sourceUrl);
    expect(result.failures[0].message).toContain("HTTP 404");
    expect(events[0].hares).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("rejects same-origin non-event URLs (homepage, uploads, admin)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const events = [
      buildEvent({ sourceUrl: "https://www.berlin-h3.eu/" }),
      buildEvent({ sourceUrl: "https://www.berlin-h3.eu/wp-admin/" }),
      buildEvent({ sourceUrl: "https://www.berlin-h3.eu/wp-content/uploads/logo.png" }),
    ];

    const result = await enrichBerlinH3Events(events, { now });

    expect(result.enriched).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("accepts the post_type=event_listing query form", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        `<p class="wpem-additional-info-block-title"><strong>Hares -</strong> Symphomaniac</p>`,
        { status: 200 },
      ),
    );
    const events = [
      buildEvent({
        sourceUrl: "https://www.berlin-h3.eu/?post_type=event_listing&p=1119",
      }),
    ];

    const result = await enrichBerlinH3Events(events, { now });

    expect(result.enriched).toBe(1);
    expect(events[0].hares).toBe("Symphomaniac");
    vi.restoreAllMocks();
  });

  it("includes events exactly 24h in the past (cutoff boundary)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        `<p class="wpem-additional-info-block-title"><strong>Hares -</strong> Boundary</p>`,
        { status: 200 },
      ),
    );
    // now = 2026-04-01T00:00:00Z → cutoff date = 2026-03-31 (today − 24h)
    const events = [buildEvent({ date: "2026-03-31" })];

    const result = await enrichBerlinH3Events(events, { now });

    expect(result.enriched).toBe(1);
    expect(events[0].hares).toBe("Boundary");
    vi.restoreAllMocks();
  });

  it("excludes events older than the 24h buffer", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // now = 2026-04-01T00:00:00Z, cutoff = 2026-03-31 → 2026-03-30 is excluded
    const events = [buildEvent({ date: "2026-03-30" })];

    const result = await enrichBerlinH3Events(events, { now });

    expect(result.enriched).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("caps fetch count at MAX_ENRICH_PER_SCRAPE (100) and leaves overflow untouched", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        new Response(
          `<p class="wpem-additional-info-block-title"><strong>Hares -</strong> Capped</p>`,
          { status: 200 },
        ),
      );
    const events = Array.from({ length: 101 }, (_, i) =>
      buildEvent({
        // Stagger dates so sort order is deterministic: event #0 is earliest, #100 is latest.
        date: `2026-04-${String(3 + Math.floor(i / 10)).padStart(2, "0")}`,
        sourceUrl: `https://www.berlin-h3.eu/event/run-${i}/`,
      }),
    );

    const result = await enrichBerlinH3Events(events, { now });

    expect(fetchSpy).toHaveBeenCalledTimes(100);
    expect(result.enriched).toBe(100);
    // The latest-dated event (last after sort) is the one dropped by the cap.
    expect(events[100].hares).toBeUndefined();
    vi.restoreAllMocks();
  });
});
