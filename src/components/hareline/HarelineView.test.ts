import { computeBucketBoundary, computeInitialScope, passesTimeFilter } from "./HarelineView";

// Pin process timezone for deterministic local-midnight math. The bucket
// boundary depends on the runtime's local TZ post-hydration, so without
// this the tests would behave differently on developer laptops in PT vs
// CI runners in UTC.
process.env.TZ = "America/New_York";

describe("computeBucketBoundary", () => {
  test("post-hydration: returns user-local midnight today as UTC ms", () => {
    // Apr 26 19:00 EDT == Apr 26 23:00 UTC. Local midnight today in EDT
    // is Apr 26 00:00 EDT == Apr 26 04:00 UTC.
    const nowMs = new Date("2026-04-26T23:00:00.000Z").getTime();
    expect(computeBucketBoundary(nowMs, true)).toBe(
      new Date("2026-04-26T04:00:00.000Z").getTime(),
    );
  });

  test("pre-hydration: returns yesterday-UTC midnight (matches server floor)", () => {
    const nowMs = new Date("2026-04-26T23:00:00.000Z").getTime();
    expect(computeBucketBoundary(nowMs, false)).toBe(
      new Date("2026-04-25T00:00:00.000Z").getTime(),
    );
  });

  test("DST spring-forward day: local midnight resolves to the post-DST UTC offset", () => {
    // 2026-03-08 is the US DST transition day. Local midnight Mar 8 still
    // exists unambiguously (the gap is at 02:00 → 03:00, not at midnight).
    // Mar 8 00:00 EST == Mar 8 05:00 UTC.
    const nowMs = new Date("2026-03-08T15:00:00.000Z").getTime();
    expect(computeBucketBoundary(nowMs, true)).toBe(
      new Date("2026-03-08T05:00:00.000Z").getTime(),
    );
  });
});

describe("passesTimeFilter — upcoming bucket regression for yesterday-UTC events", () => {
  // Reproduce the bug from the user report: on Apr 26, 2026 (today), an
  // event for Sat Apr 25 (stored at UTC noon) was leaking into "All
  // upcoming" for an EDT viewer. With the local-midnight boundary it
  // should now drop into "past."
  const aprilTwentyFifthNoonUtc = new Date("2026-04-25T12:00:00.000Z").getTime();
  const aprilTwentySixthNoonUtc = new Date("2026-04-26T12:00:00.000Z").getTime();

  test("EDT viewer post-hydration: yesterday-UTC-noon event filtered OUT of upcoming", () => {
    const nowMs = new Date("2026-04-26T23:00:00.000Z").getTime(); // 19:00 EDT
    const bucket = computeBucketBoundary(nowMs, true);
    const today = new Date("2026-04-26T12:00:00.000Z").getTime();
    expect(passesTimeFilter(aprilTwentyFifthNoonUtc, "upcoming", today, bucket)).toBe(false);
    expect(passesTimeFilter(aprilTwentyFifthNoonUtc, "past", today, bucket)).toBe(true);
  });

  test("EDT viewer post-hydration: today-UTC-noon event stays in upcoming", () => {
    const nowMs = new Date("2026-04-26T23:00:00.000Z").getTime();
    const bucket = computeBucketBoundary(nowMs, true);
    const today = new Date("2026-04-26T12:00:00.000Z").getTime();
    expect(passesTimeFilter(aprilTwentySixthNoonUtc, "upcoming", today, bucket)).toBe(true);
  });

  test("EDT viewer pre-hydration: yesterday-UTC-noon event leaks (matches SSR)", () => {
    // Pre-hydration we intentionally use the lenient yesterday-UTC floor
    // so SSR HTML matches server query output. The post-hydration tick
    // narrows it.
    const nowMs = new Date("2026-04-26T23:00:00.000Z").getTime();
    const bucket = computeBucketBoundary(nowMs, false);
    const today = new Date("2026-04-26T12:00:00.000Z").getTime();
    expect(passesTimeFilter(aprilTwentyFifthNoonUtc, "upcoming", today, bucket)).toBe(true);
  });

  test("post-hydration: rolling-window filter unaffected — 4w still includes today and forward", () => {
    // Verifies the fix doesn't accidentally narrow the rolling-window
    // anchor. todayUtc stays at today-noon-UTC, and the existing
    // bucketBoundaryUtc parameter is irrelevant for the "4w" branch.
    const nowMs = new Date("2026-04-26T23:00:00.000Z").getTime();
    const today = new Date("2026-04-26T12:00:00.000Z").getTime();
    const bucket = computeBucketBoundary(nowMs, true);
    expect(passesTimeFilter(aprilTwentySixthNoonUtc, "4w", today, bucket)).toBe(true);
    expect(passesTimeFilter(aprilTwentyFifthNoonUtc, "4w", today, bucket)).toBe(false);
  });
});

describe("computeInitialScope", () => {
  test("explicit scope=my wins even with regions present", () => {
    expect(computeInitialScope("my", "Boston, MA", "all")).toBe("my");
  });

  test("explicit scope=all wins", () => {
    expect(computeInitialScope("all", null, "my")).toBe("all");
  });

  test("regions present with no explicit scope → always returns all", () => {
    expect(computeInitialScope(null, "Boston, MA", "my")).toBe("all");
  });

  test("pipe-separated multi-region with no explicit scope → all", () => {
    expect(computeInitialScope(null, "Boston, MA|NYC", "my")).toBe("all");
  });

  test("no regions and no explicit scope → uses defaultScope (my)", () => {
    expect(computeInitialScope(null, null, "my")).toBe("my");
  });

  test("no regions and no explicit scope → uses defaultScope (all)", () => {
    expect(computeInitialScope(null, null, "all")).toBe("all");
  });

  test("empty string regions → uses defaultScope", () => {
    expect(computeInitialScope(null, "", "my")).toBe("my");
  });

  test("invalid scope param is ignored → falls through to region check", () => {
    // 'mine' is not a valid scope value, so falls through to region check
    expect(computeInitialScope("mine", "Boston, MA", "my")).toBe("all");
  });
});
