import { describe, it } from "vitest";

// Placeholder for interaction coverage. The component renders a single
// "possible activity" row inside the inline tier groups; behavior is
// driven by props with no internal state, so a smoke test was the
// cheapest gesture. Real coverage waits on a Travel-Mode-wide React
// Testing Library setup that the rest of the suite doesn't yet need.
describe("PossibleRow", () => {
  it.todo("renders kennel name + distance + cadence label");
  it.todo("links to the kennel page when source URL is absent");
});
