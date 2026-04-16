import { describe, it, expect, vi } from "vitest";
import {
  buildTravelSearchUrl,
  localYmd,
  parseTravelRedirect,
  utcYmd,
  withConcurrency,
} from "./url";

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

  it("accepts pre-formatted YYYY-MM-DD strings (sliced if longer)", () => {
    // ISO timestamps slice cleanly; matches the existing string-passthrough
    // shape that callers like /travel/saved use when reading raw params.
    const url = buildTravelSearchUrl({
      latitude: 0,
      longitude: 0,
      startDate: "2026-04-14T12:00:00.000Z",
      endDate: "2026-04-20T12:00:00.000Z",
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

describe("localYmd", () => {
  it("formats a Date using LOCAL calendar accessors", () => {
    // 11:30 PM local on 2026-04-14, regardless of the runner's timezone.
    // Local accessors return the local calendar day (intended for
    // NearMeShortcut + PopularDestinations callers that want "today").
    const lateNight = new Date(2026, 3, 14, 23, 30, 0);
    expect(localYmd(lateNight)).toBe("2026-04-14");
  });

  it("zero-pads single-digit month + day", () => {
    expect(localYmd(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });
});

describe("utcYmd", () => {
  it("formats a Date using UTC accessors (preserves stored calendar day)", () => {
    // Persisted UTC-noon date: 2026-04-14T12:00:00Z. UTC accessors
    // return the calendar day the user originally saved, even when the
    // runner is in UTC+13/UTC+14 where local accessors would return
    // 2026-04-15.
    const utcNoon = new Date("2026-04-14T12:00:00.000Z");
    expect(utcYmd(utcNoon)).toBe("2026-04-14");
  });

  it("preserves UTC day even at UTC midnight", () => {
    // 2026-04-14T00:00:00Z: in UTC-5 this is 2026-04-13 19:00 local
    // (yesterday). UTC accessor must still return 2026-04-14.
    const utcMidnight = new Date("2026-04-14T00:00:00.000Z");
    expect(utcYmd(utcMidnight)).toBe("2026-04-14");
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

describe("parseTravelRedirect", () => {
  it("returns null for a null redirect", () => {
    expect(parseTravelRedirect(null)).toBeNull();
  });

  it("returns null when the path doesn't target /travel", () => {
    expect(
      parseTravelRedirect("/hareline?q=Boston&from=2026-04-12&to=2026-04-20"),
    ).toBeNull();
  });

  it("rejects paths that merely start with 'travel' (e.g. /travellers)", () => {
    // Regression: earlier impl used `startsWith("/travel")` which matched
    // /travellers, /travel-something, etc. Now uses exact match or
    // /travel/ prefix so those false positives are blocked.
    expect(
      parseTravelRedirect(
        "/travellers?q=Boston&from=2026-04-12&to=2026-04-20",
      ),
    ).toBeNull();
    expect(
      parseTravelRedirect(
        "/travel-guide?q=Boston&from=2026-04-12&to=2026-04-20",
      ),
    ).toBeNull();
  });

  it("returns null when required params are missing", () => {
    expect(parseTravelRedirect("/travel?from=2026-04-12&to=2026-04-20")).toBeNull();
    expect(parseTravelRedirect("/travel?q=Boston&to=2026-04-20")).toBeNull();
    expect(parseTravelRedirect("/travel?q=Boston&from=2026-04-12")).toBeNull();
  });

  it("returns kind='continuing' with destination + dates when /travel params are present and saved=1 is absent", () => {
    expect(
      parseTravelRedirect(
        "/travel?lat=42.3&lng=-71.0&q=Boston%2C+MA%2C+USA&from=2026-04-12&to=2026-04-20",
      ),
    ).toEqual({
      kind: "continuing",
      destination: "Boston, MA, USA",
      startDate: "2026-04-12",
      endDate: "2026-04-20",
    });
  });

  it("returns kind='save' when saved=1 is present", () => {
    expect(
      parseTravelRedirect(
        "/travel?q=Boston&from=2026-04-12&to=2026-04-20&saved=1",
      ),
    ).toEqual({
      kind: "save",
      destination: "Boston",
      startDate: "2026-04-12",
      endDate: "2026-04-20",
    });
  });

  it("returns kind='saved-trips' for the /travel/saved dashboard route", () => {
    // P1 #5: previously /travel/saved was swallowed by the /travel prefix
    // check and emitted either null (no q=) or a destination-flavored
    // context — so "Your saved trips →" redirected guests to a generic
    // sign-in banner. kind: "saved-trips" makes the intent explicit.
    expect(parseTravelRedirect("/travel/saved")).toEqual({
      kind: "saved-trips",
    });
  });

  it("treats q/from/to on /travel/saved as saved-trips (dashboard trumps search)", () => {
    // Defensive: if anything ever crafts `/travel/saved?q=…`, honor the
    // dashboard-route intent rather than rendering destination copy that
    // doesn't match where the user is headed post-auth.
    expect(
      parseTravelRedirect("/travel/saved?q=Boston&from=2026-04-12&to=2026-04-20"),
    ).toEqual({ kind: "saved-trips" });
  });

  it("returns null for malformed URLs", () => {
    expect(parseTravelRedirect(":not a url")).toBeNull();
  });
});
