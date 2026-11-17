import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));

import { safeFetch } from "@/adapters/safe-fetch";
import {
  HALF_MIND_USER_AGENT,
  cleanHalfMindSchedule,
  fetchHalfMindListings,
  parseHalfMindResponse,
  passesImportBar,
  scopeKey,
} from "./client";
import { HALF_MIND_GA_FIXTURE } from "./fixtures";

const NOW = new Date("2026-11-17T12:00:00Z");
const parsed = parseHalfMindResponse(HALF_MIND_GA_FIXTURE, NOW);
const byName = (n: string) => parsed.listings.find((l) => l.name === n)!;

describe("scopeKey", () => {
  it("joins country and state", () => {
    expect(scopeKey({ country: "USA", state: "GA" })).toBe("USA/GA");
    expect(scopeKey({ country: "UK" })).toBe("UK");
  });
});

describe("parseHalfMindResponse", () => {
  it("parses the Georgia fixture", () => {
    expect(parsed.listings).toHaveLength(25);
    expect(parsed.errors).toEqual([]);
    const pf = byName("Peach Fuzz H3");
    expect(pf.id).toBe("19");
    expect(pf.status).toBe("alive");
    expect(pf.lastVerifiedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(typeof pf.latitude).toBe("number");
    expect(typeof pf.longitude).toBe("number");
    expect(pf.schedule).toBe("Bi-weekly Saturday 2 PM");
  });

  it("never carries an email key", () => {
    for (const l of parsed.listings) expect("email" in l).toBe(false);
    const withEmail = parseHalfMindResponse({ items: [{ id: 1, name: "X", email: "a@b.c" }] }, NOW);
    expect("email" in withEmail.listings[0]).toBe(false);
  });

  it("accepts numeric strings for id/lat/lng", () => {
    const r = parseHalfMindResponse({ items: [{ id: "7", name: "X", lat: "33.5", lng: "-84.1" }] }, NOW);
    expect(r.listings[0]).toMatchObject({ id: "7", latitude: 33.5, longitude: -84.1 });
  });

  it("maps status", () => {
    const one = (row: object) => parseHalfMindResponse({ items: [{ id: 1, name: "X", ...row }] }, NOW).listings[0].status;
    expect(one({ status: "dead" })).toBe("dead");
    expect(one({ status: "active", current_state: "Alive and Verified" })).toBe("alive");
    expect(one({ current_state: "UNKNOWN" })).toBe("unknown");
    expect(one({ status: "active", current_state: "Unknown" })).toBe("unknown");
    expect(one({ current_state: "Alive" })).toBe("unknown");
    expect(one({ current_state: "Alive but unverified" })).toBe("unknown");
    expect(one({ current_state: "Probably dead" })).toBe("dead");
    expect(one({ status: "DEAD" })).toBe("dead");
  });

  it.each(["<html>", { error: "x" }, { items: "nope" }])("reports one error for bad body %j", (body) => {
    const r = parseHalfMindResponse(body, NOW);
    expect(r.listings).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });

  it("skips rows missing id or name with an index-only error", () => {
    const r = parseHalfMindResponse({ items: [{ id: 1, name: "Ok" }, { name: "SECRET" }, { id: 3 }] }, NOW);
    expect(r.listings).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain("1");
    expect(r.errors.join(" ")).not.toContain("SECRET");
  });

  it("nulls lastVerifiedAt for null, zero, garbage and future dates", () => {
    for (const v of [null, "0000-00-00 00:00:00", "garbage", "2027-01-01 00:00:00"]) {
      const r = parseHalfMindResponse({ items: [{ id: 1, name: "X", last_verified: v }] }, NOW);
      expect(r.listings[0].lastVerifiedAt).toBeNull();
    }
  });

  it("passes truncated through", () => {
    expect(parseHalfMindResponse({ items: [], truncated: true }, NOW).truncated).toBe(true);
  });
});

describe("cleanHalfMindSchedule", () => {
  it.each([
    [["Bi-weekly Saturday 14:00 All Year"], "Bi-weekly Saturday 2 PM"],
    [["Monthly Tuesday 19:00 All Year", "Variable"], "Monthly Tuesday 7 PM"],
    [["Every Year 13:00 ST", "18:30 Summer"], "Every Year 1 PM (winter) · 6:30 PM Summer"],
    [["1st Tuesday 19:00 DST"], "1st Tuesday 7 PM (summer)"],
    [["Every Saturday 11:00 All Year"], "Every Saturday 11 AM"],
    [["Variable"], null],
    [[], null],
    [null, null],
    ["['Every Month 19:00 All Year']", "Every Month 7 PM"],
  ])("%j -> %j", (input, out) => {
    expect(cleanHalfMindSchedule(input)).toBe(out);
  });
});

describe("passesImportBar", () => {
  const good = {
    status: "alive" as const,
    lastVerifiedAt: new Date("2026-10-07T12:00:00Z"),
    website: "https://x.org",
    facebookUrl: null,
    latitude: 33,
    longitude: -84,
  };
  it("passes Peach Fuzz", () => expect(passesImportBar(byName("Peach Fuzz H3"), NOW)).toBe(true));
  it("fails Black Sheep (no verification date)", () => expect(passesImportBar(byName("Black Sheep H3"), NOW)).toBe(false));
  it("fails unknown listings", () => expect(passesImportBar({ ...good, status: "unknown" }, NOW)).toBe(false));
  it("fails stale checks", () =>
    expect(passesImportBar({ ...good, lastVerifiedAt: new Date("2025-10-01T12:00:00Z") }, NOW)).toBe(false));
  it("fails with no web presence", () => expect(passesImportBar({ ...good, website: null }, NOW)).toBe(false));
  it("accepts Facebook alone", () =>
    expect(passesImportBar({ ...good, website: null, facebookUrl: "https://facebook.com/x" }, NOW)).toBe(true));
  it("fails with null coordinates", () => expect(passesImportBar({ ...good, latitude: null }, NOW)).toBe(false));
});

describe("fetchHalfMindListings", () => {
  const mocked = vi.mocked(safeFetch);
  beforeEach(() => {
    mocked.mockReset();
  });
  const res = (status: number, body: string) => new Response(body, { status });

  it("sends an honest request", async () => {
    mocked.mockResolvedValue(res(200, JSON.stringify(HALF_MIND_GA_FIXTURE)));
    const r = await fetchHalfMindListings({ country: "USA", state: "GA" }, NOW);
    expect(r.listings).toHaveLength(25);
    expect(mocked).toHaveBeenCalledTimes(1);
    const [url, init] = mocked.mock.calls[0];
    const u = new URL(url);
    expect(u.searchParams.get("country")).toBe("USA");
    expect(u.searchParams.get("state")).toBe("GA");
    expect(u.searchParams.get("dead")).toBe("1");
    expect(init?.headers).toEqual({ "User-Agent": HALF_MIND_USER_AGENT, Accept: "application/json" });
    expect(init?.useResidentialProxy).toBeUndefined();
    expect(init?.egress).toBeUndefined();
  });

  it.each([406, 429, 403])("HTTP %i is one error, no retry", async (status) => {
    mocked.mockResolvedValue(res(status, "no"));
    const r = await fetchHalfMindListings({ country: "USA" }, NOW);
    expect(r.errors).toEqual([`Half-Mind API returned HTTP ${status}`]);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("reports a thrown fetch", async () => {
    mocked.mockRejectedValue(new Error("timeout"));
    const r = await fetchHalfMindListings({ country: "USA" }, NOW);
    expect(r.errors).toEqual(["Half-Mind API request failed"]);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("reports an HTML 200", async () => {
    mocked.mockResolvedValue(res(200, "<html>blocked</html>"));
    const r = await fetchHalfMindListings({ country: "USA" }, NOW);
    expect(r.errors).toHaveLength(1);
    expect(r.listings).toEqual([]);
  });
});
