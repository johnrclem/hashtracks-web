import { describe, it } from "vitest";

// Placeholder for interaction coverage. The undo/restore flow logic lives
// in TripSummary's handleRemove handler; the server action paths are
// covered by actions.test.ts (restoreTravelSearch success/error branches).
// What's missing is the React-rendering side: that clicking Undo fires the
// server action, updates savedId on success, dismisses the success toast,
// and shows an error toast on failure. Pending Travel-Mode RTL setup.
describe("TripSummary", () => {
  it.todo("restores savedId and captures analytics when Undo succeeds");
  it.todo("dismisses the success toast and shows error when Undo fails");
  it.todo("dismisses the success toast and shows error on network failure");
  it.todo("does not update state if user navigated away during Undo");
  it.todo("suppresses radiusSnapped badge when noCoverage is true");
  it.todo("suppresses broaderExpanded badge when noCoverage is true");
});
