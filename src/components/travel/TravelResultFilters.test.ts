import { describe, it } from "vitest";

// Placeholder for interaction coverage. The chip-sort-by-trip-date
// behavior is exercised by filters.test.ts (computeDayCounts +
// datesByDay shape); what's missing is the rendered chip → click →
// onToggleDay assertion. Pending Travel-Mode RTL setup.
describe("TravelResultFilters", () => {
  it.todo("renders day chips in trip-chronological order, not Sun-first");
  it.todo("calls onToggleDay with the chip's day code on click");
  it.todo("renders Include Possible toggle only when possibleCount > 0");
});
