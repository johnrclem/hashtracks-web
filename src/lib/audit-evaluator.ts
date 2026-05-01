/**
 * Tiny pure interpreter for the audit-rule DSL.
 *
 * Every fingerprintable rule's matching logic must be expressible
 * entirely from data declared in its registry entry — no shared regex
 * constants, no `new RegExp` at runtime, no env reads. Rules call
 * `evaluate(matcher, row)` and that's the entire matching surface.
 *
 * Including {@link EVALUATOR_VERSION} in each rule's `semanticHash`
 * means a behavior change in the interpreter (the `evaluate()` switch,
 * the row normalizer, the canonicalizer) rolls fingerprints forward
 * even when matcher data is unchanged. That's what makes "same
 * fingerprint = same matching semantics" a sound invariant.
 */

import isSafeRegex from "safe-regex2";

import type { AuditEventRow } from "@/pipeline/audit-checks";

/**
 * Bump when ANY of the following change:
 *   - the `evaluate()` switch / control flow
 *   - the {@link NormalizedRow} shape
 *   - the {@link Matcher} type union (adding/removing/renaming ops)
 */
export const EVALUATOR_VERSION = 1;

// ── Field projection ────────────────────────────────────────────────

/**
 * Subset of audit-event fields the evaluator can project from. Derived
 * from {@link AuditEventRow} via Pick<> so any future schema field that
 * needs to be matchable just gets added here, not re-listed in a
 * parallel union.
 */
export type NormalizedRow = Pick<
  AuditEventRow,
  | "haresText"
  | "title"
  | "description"
  | "locationName"
  | "locationCity"
  | "startTime"
  | "rawDescription"
  | "kennelCode"
  | "kennelShortName"
>;

/** Field the DSL can read off a normalized row. */
export type RowField = keyof NormalizedRow;

// ── Matcher DSL ─────────────────────────────────────────────────────

/**
 * Discriminated union of supported ops. Each variant is data-only — no
 * function references, no regex literals (regex patterns are stored as
 * strings and compiled lazily via {@link compileRegex}, with the source
 * + flags participating in `semanticHash`).
 */
export type Matcher =
  | { op: "regex-test"; field: RowField; pattern: string; flags?: string }
  // String prefix test. Case-sensitive — use `regex-test` with `^…` for fuzzier matching.
  | { op: "starts-with"; field: RowField; value: string }
  | { op: "equals"; field: RowField; value: string }
  // Field length comparisons. Null fields treat length as 0.
  | { op: "length-eq"; field: RowField; value: number }
  | { op: "length-gt"; field: RowField; value: number }
  // Boolean composition.
  | { op: "and"; conditions: readonly Matcher[] }
  | { op: "or"; conditions: readonly Matcher[] }
  | { op: "not"; condition: Matcher };

// ── Evaluator ───────────────────────────────────────────────────────

/**
 * Compiled-regex cache keyed by the matcher node identity. A typical
 * audit run evaluates the same matcher tree against thousands of
 * events; without this cache each event would recompile every regex
 * via `new RegExp(pattern, flags)`. WeakMap so cache entries clear
 * automatically when a Matcher object goes out of scope (registry
 * reload, tests).
 */
const regexCache = new WeakMap<object, RegExp>();

/**
 * Allowed flag set: `i`, `m`, `s`, `u`. The stateful flags `g` and `y`
 * are banned because the compiled `RegExp` is cached and reused across
 * many `evaluate()` calls — `RegExp.prototype.test()` mutates
 * `lastIndex` for those flags, which would make the evaluator
 * non-deterministic and break the fingerprint invariant. Multiple PR
 * reviewers (Gemini, Codex, Qodo, CodeRabbit) flagged this on the
 * initial pass; the test suite locks the rejection in.
 */
const ALLOWED_FLAGS_RE = /^[imsu]*$/;

function compileRegex(matcher: Extract<Matcher, { op: "regex-test" }>): RegExp {
  const cached = regexCache.get(matcher);
  if (cached) return cached;
  if (matcher.pattern.length === 0) {
    throw new Error("Matcher regex-test: pattern must be non-empty");
  }
  if (matcher.flags !== undefined && !ALLOWED_FLAGS_RE.test(matcher.flags)) {
    throw new Error(
      `Matcher regex-test: invalid flags "${matcher.flags}" (allowed: i, m, s, u)`,
    );
  }
  // Patterns come from the source-controlled rule registry, not from
  // user input — but `isSafeRegex` is cheap defense-in-depth so a
  // rule author can't accidentally land a catastrophic-backtrack
  // pattern that would hang every audit run. The cost (one check per
  // first-compile) is amortized by the WeakMap cache.
  // nosemgrep: detect-non-literal-regexp — pattern is registry-supplied + ReDoS-validated
  const compiled = new RegExp(matcher.pattern, matcher.flags); // NOSONAR
  if (!isSafeRegex(compiled)) {
    throw new Error(
      `Matcher regex-test: pattern "${matcher.pattern}" may cause catastrophic backtracking (ReDoS)`,
    );
  }
  regexCache.set(matcher, compiled);
  return compiled;
}

function readField(row: NormalizedRow, field: RowField): string | null {
  // `field` is a literal union of known column names — dynamic access
  // is type-safe by construction, no untrusted input.
  return row[field];
}

/**
 * Evaluate a matcher against a row. Pure function — same inputs always
 * yield the same output. No side effects, no I/O, no env reads.
 */
export function evaluate(matcher: Matcher, row: NormalizedRow): boolean {
  switch (matcher.op) {
    case "regex-test": {
      const value = readField(row, matcher.field);
      if (value === null) return false;
      return compileRegex(matcher).test(value);
    }
    case "starts-with": {
      return readField(row, matcher.field)?.startsWith(matcher.value) ?? false;
    }
    case "equals": {
      const value = readField(row, matcher.field);
      return value === matcher.value;
    }
    case "length-eq": {
      const value = readField(row, matcher.field);
      return (value?.length ?? 0) === matcher.value;
    }
    case "length-gt": {
      const value = readField(row, matcher.field);
      return (value?.length ?? 0) > matcher.value;
    }
    case "and":
      return matcher.conditions.every((c) => evaluate(c, row));
    case "or":
      return matcher.conditions.some((c) => evaluate(c, row));
    case "not":
      return !evaluate(matcher.condition, row);
  }
}

// ── Canonicalization (for semanticHash) ─────────────────────────────

/**
 * Deterministic JSON encoding of a matcher tree — keys sorted, arrays
 * preserved in declared order. The `semanticHash` of a rule is
 * `sha256(canonicalize(matcher) + EVALUATOR_VERSION)`.
 */
export function canonicalizeMatcher(matcher: Matcher): string {
  return JSON.stringify(matcher, sortedKeyReplacer);
}

function sortedKeyReplacer(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      // `k` came from Object.keys(obj) directly — same source.
      out[k] = obj[k];
    }
    return out;
  }
  return value;
}
