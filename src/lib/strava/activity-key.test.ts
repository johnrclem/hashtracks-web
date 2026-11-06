import { describe, it, expect } from "vitest";
import { stravaActivityKey } from "./activity-key";

describe("stravaActivityKey", () => {
  it("matches the Postgres expression used by the backfill migration", () => {
    // SELECT encode(sha256(convert_to('strava-activity:9876543210','UTF8')),'hex');
    // (prisma/migrations/20261106190000_strava_transient_cache/migration.sql)
    expect(stravaActivityKey("9876543210")).toBe(
      "2d9b1e2b3881069e9caafb871f0cdf265c076b4da52dc5fcc4f6cf22c333f422",
    );
  });

  it("is deterministic and distinguishes activities", () => {
    expect(stravaActivityKey("1")).toBe(stravaActivityKey("1"));
    expect(stravaActivityKey("1")).not.toBe(stravaActivityKey("2"));
  });

  it("never contains the raw activity ID", () => {
    expect(stravaActivityKey("9876543210")).not.toContain("9876543210");
  });
});
