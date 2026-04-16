import { describe, it } from "vitest";

// Placeholder for interaction coverage. The grouping/filter logic is
// covered by filters.test.ts (groupResultsByTier, computeDayCounts).
// What's missing is the render-side assertion that distance tiers,
// day sub-groups, and the include-possible secondary line surface in
// the DOM. Pending Travel-Mode RTL setup.
describe("TravelResults", () => {
  it.todo("renders confirmed/likely cards grouped by distance tier and day");
  it.todo("shows the +N possibles line only when includePossible is on");
  it.todo("collapses possibles into PossibleSection when toggle is off");
  it.todo("clamps card-enter animation delay to 1500ms ceiling");
});
