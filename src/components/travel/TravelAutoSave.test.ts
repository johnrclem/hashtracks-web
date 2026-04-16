import { describe, it } from "vitest";

// Placeholder for interaction coverage. The auto-save flow is exercised
// end-to-end via save-intent.test.ts (sessionStorage handshake) and
// actions.test.ts (server-action idempotency). What's missing here is
// the React-rendering side: that the component fires saveTravelSearch
// only once on mount and cleans up the URL. Pending Travel-Mode RTL.
describe("TravelAutoSave", () => {
  it.todo("fires saveTravelSearch once when the saved=1 intent matches");
  it.todo("does not fire when the intent signature mismatches");
  it.todo("scrubs the saved=1 query param after firing");
});
