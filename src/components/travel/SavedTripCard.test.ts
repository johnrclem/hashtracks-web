import { describe, it } from "vitest";

// Placeholder for interaction coverage. SavedTripCard's logic — Trip
// status badge + Remove button + lastViewedAt sort hint — is purely
// derived from props. Real interaction tests pending a Travel-Mode RTL
// setup; the action paths are covered end-to-end by actions.test.ts.
describe("SavedTripCard", () => {
  it.todo("renders 'Trip starts soon' badge for trips inside the window");
  it.todo("renders 'Saved' badge for trips before the window");
  it.todo("calls deleteTravelSearch and refreshes the route on Remove click");
});
