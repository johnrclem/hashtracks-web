import { describe, it, expect, vi } from "vitest";
import { buildTravelSearchUrl, withConcurrency } from "./url";

describe("buildTravelSearchUrl", () => {
  it("emits the param names /travel page.tsx parses", () => {
    const url = buildTravelSearchUrl({
      latitude: 42.36,
      longitude: -71.06,
      startDate: "2026-04-14",
      endDate: "2026-04-20",
      label: "Boston, MA, USA",
      radiusKm: 50,
      timezone: "America/New_York",
    });
    const params = new URL(url, "https://x").searchParams;
    expect(url.startsWith("/travel?")).toBe(true);
    expect(params.get("lat")).toBe("42.36");
    expect(params.get("lng")).toBe("-71.06");
    expect(params.get("from")).toBe("2026-04-14");
    expect(params.get("to")).toBe("2026-04-20");
    expect(params.get("q")).toBe("Boston, MA, USA");
    expect(params.get("r")).toBe("50");
    expect(params.get("tz")).toBe("America/New_York");
  });

  it("accepts Date objects (slices to YYYY-MM-DD)", () => {
    const url = buildTravelSearchUrl({
      latitude: 0,
      longitude: 0,
      startDate: new Date("2026-04-14T12:00:00.000Z"),
      endDate: new Date("2026-04-20T12:00:00.000Z"),
      label: "x",
    });
    const params = new URL(url, "https://x").searchParams;
    expect(params.get("from")).toBe("2026-04-14");
    expect(params.get("to")).toBe("2026-04-20");
  });

  it("omits radius and timezone when not provided", () => {
    const url = buildTravelSearchUrl({
      latitude: 0,
      longitude: 0,
      startDate: "2026-04-14",
      endDate: "2026-04-20",
      label: "x",
    });
    const params = new URL(url, "https://x").searchParams;
    expect(params.has("r")).toBe(false);
    expect(params.has("tz")).toBe(false);
  });

  it("treats a null timezone as omit (no empty tz= in URL)", () => {
    const url = buildTravelSearchUrl({
      latitude: 0,
      longitude: 0,
      startDate: "2026-04-14",
      endDate: "2026-04-20",
      label: "x",
      timezone: null,
    });
    expect(new URL(url, "https://x").searchParams.has("tz")).toBe(false);
  });
});

describe("withConcurrency", () => {
  it("preserves input order in the result array", async () => {
    const out = await withConcurrency([10, 20, 30, 40, 50], 2, async (n) => n * 2);
    expect(out).toEqual([20, 40, 60, 80, 100]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const limit = 3;
    await withConcurrency([1, 2, 3, 4, 5, 6, 7, 8], limit, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // simulate async work
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(limit);
  });

  it("handles items.length < limit without spawning extra workers", async () => {
    const fn = vi.fn(async (n: number) => n);
    await withConcurrency([1, 2], 10, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns [] for empty input without invoking fn", async () => {
    const fn = vi.fn(async () => 42);
    const out = await withConcurrency([], 5, fn);
    expect(out).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
