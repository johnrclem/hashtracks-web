import {
  AUDIT_RULES,
  getRule,
  semanticHashFor,
  type AuditRule,
} from "./rule-registry";

const SAMPLE_RULE: AuditRule = {
  slug: "test-only-sample",
  category: "title",
  severity: "warning",
  field: "title",
  version: 1,
  matcher: { op: "regex-test", field: "title", pattern: "test" },
  fingerprint: true,
  description: "Test fixture, not registered in AUDIT_RULES.",
};

describe("AUDIT_RULES", () => {
  it("is populated with the fingerprintable rules from rule-definitions", () => {
    // Sanity check that the import path wired up. Specific rule-by-rule
    // assertions live in rule-definitions.test.ts (parity with
    // audit-checks.ts).
    expect(AUDIT_RULES.size).toBeGreaterThan(0);
  });

  it("returns undefined for unknown slugs via getRule()", () => {
    expect(getRule("nonexistent")).toBeUndefined();
  });

  it("each registry entry is self-describing — slug field matches map key", () => {
    for (const [key, rule] of AUDIT_RULES) {
      expect(rule.slug).toBe(key);
    }
  });
});

describe("semanticHashFor", () => {
  it("returns a 64-char hex sha256", () => {
    expect(semanticHashFor(SAMPLE_RULE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same rule", () => {
    expect(semanticHashFor(SAMPLE_RULE)).toBe(semanticHashFor(SAMPLE_RULE));
  });

  it("rolls forward when the matcher payload changes", () => {
    const a = semanticHashFor(SAMPLE_RULE);
    const b = semanticHashFor({
      ...SAMPLE_RULE,
      matcher: { op: "regex-test", field: "title", pattern: "different" },
    });
    expect(a).not.toBe(b);
  });

  it("rolls forward when the matcher field changes", () => {
    const a = semanticHashFor(SAMPLE_RULE);
    const b = semanticHashFor({
      ...SAMPLE_RULE,
      matcher: { op: "regex-test", field: "haresText", pattern: "test" },
    });
    expect(a).not.toBe(b);
  });

  it("rolls forward when boolean composition is restructured", () => {
    // and([a, b]) and or([a, b]) must hash differently even if both
    // would happen to evaluate the same way for some inputs.
    const a = semanticHashFor({
      ...SAMPLE_RULE,
      matcher: {
        op: "and",
        conditions: [
          { op: "regex-test", field: "title", pattern: "x" },
          { op: "regex-test", field: "title", pattern: "y" },
        ],
      },
    });
    const b = semanticHashFor({
      ...SAMPLE_RULE,
      matcher: {
        op: "or",
        conditions: [
          { op: "regex-test", field: "title", pattern: "x" },
          { op: "regex-test", field: "title", pattern: "y" },
        ],
      },
    });
    expect(a).not.toBe(b);
  });

  it("does NOT roll forward when only the human-readable description changes", () => {
    // semanticHash is about matching behavior, not documentation. A
    // typo-fix in `description` shouldn't invalidate every existing
    // open issue's fingerprint.
    const a = semanticHashFor(SAMPLE_RULE);
    const b = semanticHashFor({ ...SAMPLE_RULE, description: "different prose" });
    expect(a).toBe(b);
  });
});
