import { describe, it, expect } from "vitest";
import { isStravaCacheStale, STALE_HOURS } from "./constants";

describe("isStravaCacheStale", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000);

  it("treats a never-synced cache as stale", () => {
    expect(isStravaCacheStale(null, now)).toBe(true);
    expect(isStravaCacheStale(undefined, now)).toBe(true);
  });

  it("is fresh inside STALE_HOURS and stale from STALE_HOURS on", () => {
    expect(isStravaCacheStale(hoursAgo(STALE_HOURS - 1), now)).toBe(false);
    expect(isStravaCacheStale(hoursAgo(STALE_HOURS), now)).toBe(true);
  });

  it("accepts ISO strings (the logbook passes lastSyncAt as a string)", () => {
    expect(isStravaCacheStale(hoursAgo(1).toISOString(), now)).toBe(false);
    expect(isStravaCacheStale("2026-06-08T17:02:37.791Z", now)).toBe(true);
  });
});
