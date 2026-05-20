import { renderFilingInstructions } from "./audit-prompt-shared";

const HARELINE = renderFilingInstructions({
  stream: "chrome-event",
  kennelLabel: "{KENNEL_CODE}",
});
const DEEP_DIVE = renderFilingInstructions({
  stream: "chrome-kennel",
  kennelLabel: "hockessin",
});

type ContainsCase = readonly [label: string, expected: readonly string[]];

// prettier-ignore
const CONTAINS_CASES: readonly ContainsCase[] = [
  // 502 escalation language must be unambiguous — the chrome agent had been
  // looping indefinitely on persistent server-side outages (issue #1494).
  ["502 retry cap with explicit Option-2 escalation language", ["502", "Retry the same nonce exactly once", "switch to Option 2"]],
  // The URL-prefill flow is the auto-fallback for chrome-only sessions where
  // no admin is in the loop, so it must come BEFORE the paste-to-admin option.
  ["Option 2 is the URL-prefill flow, not paste-to-admin", ["Option 2 (automatic fallback when Option 1 errors): GitHub URL prefill"]],
  ["Option 3 is the manual paste-to-admin fallback", ["Option 3 (manual fallback", "an admin will pick it up"]],
  // The prefill URL must carry the stream + kennel labels so the bridging tier
  // can reattach the filing to the dedup graph on the next sync round.
  ["URL prefill template includes stream + kennel labels", ["labels=audit,alert,audit:chrome-event,kennel:{KENNEL_CODE}"]],
];

describe("renderFilingInstructions — hareline (chrome-event)", () => {
  it.each(CONTAINS_CASES)("contains %s", (_label, expected) => {
    for (const substring of expected) {
      expect(HARELINE).toContain(substring);
    }
  });
});

describe("renderFilingInstructions — deep-dive (chrome-kennel)", () => {
  it("substitutes the resolved kennelLabel into the URL prefill template", () => {
    expect(DEEP_DIVE).toContain(
      "labels=audit,alert,audit:chrome-kennel,kennel:hockessin",
    );
  });

  it("retains the 502 retry cap across both streams", () => {
    expect(DEEP_DIVE).toContain("Retry the same nonce exactly once");
  });
});
