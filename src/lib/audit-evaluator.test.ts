import {
  evaluate,
  canonicalizeMatcher,
  EVALUATOR_VERSION,
  type Matcher,
  type NormalizedRow,
} from "./audit-evaluator";

const FIXTURE: NormalizedRow = {
  haresText: "Just Frank, BareGain",
  title: "NYCH3 #1234 — Frank's run",
  description: "BYOB, $5 hash cash, runs at 7 PM",
  locationName: "Central Park, NYC",
  locationCity: "New York",
  startTime: "19:00",
  rawDescription: "BYOB, $5 hash cash, runs at 7 PM\nMore details...",
  kennelCode: "nych3",
  kennelShortName: "NYCH3",
};

describe("evaluate", () => {
  it("regex-test fires when the pattern matches the field", () => {
    const m: Matcher = { op: "regex-test", field: "haresText", pattern: "Frank" };
    expect(evaluate(m, FIXTURE)).toBe(true);
  });

  it("regex-test does not fire on a missing field", () => {
    const m: Matcher = { op: "regex-test", field: "haresText", pattern: "Frank" };
    expect(evaluate(m, { ...FIXTURE, haresText: null })).toBe(false);
  });

  it("regex-test honors flags (case-insensitive)", () => {
    const m: Matcher = { op: "regex-test", field: "title", pattern: "nych3", flags: "i" };
    expect(evaluate(m, FIXTURE)).toBe(true);
  });

  it("regex-test rejects empty pattern at compile time", () => {
    const m: Matcher = { op: "regex-test", field: "title", pattern: "" };
    expect(() => evaluate(m, FIXTURE)).toThrow(/non-empty/);
  });

  it("regex-test rejects unsupported flags so the evaluator stays deterministic", () => {
    // 'x' is not in the supported flag set — fingerprint integrity depends on
    // every variation of behavior being caught by the validator.
    const m: Matcher = { op: "regex-test", field: "title", pattern: "x", flags: "xyz" };
    expect(() => evaluate(m, FIXTURE)).toThrow(/invalid flags/);
  });

  it.each([["g"], ["y"], ["gi"], ["iy"]])(
    "regex-test rejects stateful flag '%s' (cached RegExp + lastIndex would break determinism)",
    (flags) => {
      // Compiled regex is memoized in a WeakMap and reused across many
      // evaluations. `g` and `y` mutate `lastIndex` on `.test()`, which
      // would make identical inputs alternate between match/non-match
      // depending on prior call history. PR #1163 reviewers (Gemini,
      // Codex, Qodo, CodeRabbit) all flagged this on the initial pass.
      const m: Matcher = { op: "regex-test", field: "title", pattern: "x", flags };
      expect(() => evaluate(m, FIXTURE)).toThrow(/invalid flags/);
    },
  );


  it("starts-with is case-sensitive (use regex-test with ^ for fuzzier matching)", () => {
    const lower: Matcher = { op: "starts-with", field: "title", value: "nych3" };
    expect(evaluate(lower, FIXTURE)).toBe(false);
    const upper: Matcher = { op: "starts-with", field: "title", value: "NYCH3" };
    expect(evaluate(upper, FIXTURE)).toBe(true);
  });

  it("starts-with does not fire on a null field", () => {
    const m: Matcher = { op: "starts-with", field: "haresText", value: "anything" };
    expect(evaluate(m, { ...FIXTURE, haresText: null })).toBe(false);
  });

  it("equals does strict string comparison and treats null as not-equal", () => {
    const yes: Matcher = { op: "equals", field: "kennelCode", value: "nych3" };
    expect(evaluate(yes, FIXTURE)).toBe(true);
    const no: Matcher = { op: "equals", field: "kennelCode", value: "NYCH3" };
    expect(evaluate(no, FIXTURE)).toBe(false);
    const nullish: Matcher = { op: "equals", field: "haresText", value: "" };
    expect(evaluate(nullish, { ...FIXTURE, haresText: null })).toBe(false);
  });

  it("length-eq treats null as length 0", () => {
    const m: Matcher = { op: "length-eq", field: "haresText", value: 0 };
    expect(evaluate(m, { ...FIXTURE, haresText: null })).toBe(true);
    expect(evaluate(m, FIXTURE)).toBe(false);
  });

  it("length-gt fires when the field exceeds the threshold", () => {
    const m: Matcher = { op: "length-gt", field: "rawDescription", value: 20 };
    expect(evaluate(m, FIXTURE)).toBe(true);
    expect(evaluate(m, { ...FIXTURE, rawDescription: "short" })).toBe(false);
  });

  it("and short-circuits — all conditions must hold", () => {
    const m: Matcher = {
      op: "and",
      conditions: [
        { op: "starts-with", field: "title", value: "NYCH3" },
        { op: "regex-test", field: "title", pattern: "Frank" },
      ],
    };
    expect(evaluate(m, FIXTURE)).toBe(true);
    expect(evaluate(m, { ...FIXTURE, title: "DIFFERENT_KENNEL #1234" })).toBe(false);
  });

  it("or fires when any condition holds", () => {
    const m: Matcher = {
      op: "or",
      conditions: [
        { op: "equals", field: "kennelCode", value: "nope" },
        { op: "equals", field: "kennelCode", value: "nych3" },
      ],
    };
    expect(evaluate(m, FIXTURE)).toBe(true);
  });

  it("not negates the inner condition", () => {
    const m: Matcher = {
      op: "not",
      condition: { op: "equals", field: "kennelCode", value: "other-kennel" },
    };
    expect(evaluate(m, FIXTURE)).toBe(true);
  });

  it("nested boolean composition stays deterministic across re-runs", () => {
    // Same inputs → same output: gives us confidence that the evaluator
    // has no hidden state that would invalidate fingerprint identity.
    const m: Matcher = {
      op: "and",
      conditions: [
        {
          op: "or",
          conditions: [
            { op: "regex-test", field: "title", pattern: "Frank" },
            { op: "regex-test", field: "title", pattern: "Doe" },
          ],
        },
        { op: "not", condition: { op: "starts-with", field: "kennelCode", value: "x" } },
      ],
    };
    expect(evaluate(m, FIXTURE)).toBe(true);
    expect(evaluate(m, FIXTURE)).toBe(true);
  });
});

describe("canonicalizeMatcher", () => {
  it("produces stable output regardless of object key order", () => {
    // Same matcher built with keys in different declaration order should
    // canonicalize identically — that's what makes semanticHash stable.
    const a: Matcher = { op: "regex-test", field: "title", pattern: "x", flags: "i" };
    const b: Matcher = { flags: "i", pattern: "x", field: "title", op: "regex-test" } as Matcher;
    expect(canonicalizeMatcher(a)).toBe(canonicalizeMatcher(b));
  });

  it("changes when the matcher payload changes", () => {
    const a: Matcher = { op: "regex-test", field: "title", pattern: "x" };
    const b: Matcher = { op: "regex-test", field: "title", pattern: "y" };
    expect(canonicalizeMatcher(a)).not.toBe(canonicalizeMatcher(b));
  });

  it("treats arrays positionally — reordering conditions changes the hash", () => {
    // Boolean composition is commutative for evaluation, but for fingerprint
    // identity we want to detect any change. Authors who reorder conditions
    // must accept a fingerprint roll.
    const a: Matcher = {
      op: "and",
      conditions: [
        { op: "equals", field: "kennelCode", value: "a" },
        { op: "equals", field: "kennelCode", value: "b" },
      ],
    };
    const b: Matcher = {
      op: "and",
      conditions: [
        { op: "equals", field: "kennelCode", value: "b" },
        { op: "equals", field: "kennelCode", value: "a" },
      ],
    };
    expect(canonicalizeMatcher(a)).not.toBe(canonicalizeMatcher(b));
  });
});

describe("EVALUATOR_VERSION", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(EVALUATOR_VERSION)).toBe(true);
    expect(EVALUATOR_VERSION).toBeGreaterThan(0);
  });
});
