import { describe, it, expect } from "vitest";
import { noRunsBody } from "./EmptyStates";

describe("noRunsBody", () => {
  it("says the usual schedules miss the dates when every schedule was projected", () => {
    const body = noRunsBody("Wichita", "all");
    expect(body).toContain("near Wichita has a trail posted");
    expect(body).toContain("usual schedules don't land on them");
  });

  it.each(["high", "none"] as const)(
    "doesn't rule out the usual schedules at the %s horizon, where some aren't projected",
    (tier) => {
      const body = noRunsBody("Wichita", tier);
      expect(body).toContain("near Wichita has a trail posted");
      expect(body).not.toContain("usual schedules don't land");
      expect(body).toContain("Check back closer to your trip");
    },
  );

  it("falls back to 'here' without a place", () => {
    expect(noRunsBody(undefined, "all")).toContain("near here has a trail posted");
  });
});
