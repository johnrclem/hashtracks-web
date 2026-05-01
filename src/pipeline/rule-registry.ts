/**
 * Audit rule registry — single source of truth for rule semantics.
 *
 * Each entry owns its matcher DSL tree (consumed by the
 * `audit-evaluator`), its version number, and its fingerprint flag. The
 * hash computed by {@link semanticHashFor} participates in the audit-
 * issue fingerprint, so any change to a rule's matcher payload (or the
 * evaluator interpreting it) rolls the fingerprint forward.
 *
 * **Constraint:** every entry whose `fingerprint` flag is `true` MUST
 * express its matching logic entirely in declarative {@link Matcher}
 * data — no shared regex constants, no runtime regex construction, no
 * env reads. Rules that can't satisfy that constraint (e.g. cross-row
 * checks like `checkLocationQuality`'s aggregate dedup) tag
 * `fingerprint: false` and opt out of cross-stream coalescing for those
 * specific rules. They keep filing legacy-style with title-based dedup
 * until the DSL grows to support them.
 *
 * `AUDIT_RULES` is empty in this PR (P0a foundation). Rule migration
 * from `audit-checks.ts` happens in a follow-up PR — one rule per
 * commit so each fingerprint roll is reviewable in isolation. No live
 * caller reads from this Map yet; the file-finding endpoint that
 * triggers fingerprint-based dedup arrives in bundle 5.
 */

import { createHash } from "node:crypto";
import {
  EVALUATOR_VERSION,
  canonicalizeMatcher,
  type Matcher,
} from "@/lib/audit-evaluator";
import type {
  AuditCategory,
  AuditSeverity,
} from "@/pipeline/audit-checks";

export interface AuditRule {
  /** Stable rule identifier (e.g. `"hare-cta-text"`). Matches the
   *  existing `KNOWN_AUDIT_RULES` slugs so the suppressions UI keeps
   *  working through the migration. */
  slug: string;
  category: AuditCategory;
  severity: AuditSeverity;
  /** Bumped manually when the registry author wants to treat a change
   *  as a fresh version even if the matcher payload's canonical form
   *  is unchanged. Most authors don't touch this — changing matcher
   *  data automatically rolls the fingerprint via semanticHash. */
  version: number;
  /** Declarative matcher tree. Consumed by `audit-evaluator.evaluate`. */
  matcher: Matcher;
  /** Whether dedup uses fingerprint-based coalescing (true) or legacy
   *  title-based dedup (false). Cross-row aggregate rules opt out
   *  until the DSL grows to support them. */
  fingerprint: boolean;
  /** Short human-readable description for the registry inspector and
   *  registry-admin tooling. Optional — semanticHash ignores it so
   *  prose edits don't roll fingerprints. */
  description?: string;
}

/**
 * Build a registry from `(slug, rule)` entries. Separating construction
 * from the exported `AUDIT_RULES` instance lets bundle 4b populate the
 * registry by passing entries here, and lets tests build smaller
 * registries without monkey-patching the exported singleton.
 */
export function buildRegistry(
  entries: ReadonlyArray<readonly [string, AuditRule]> = [],
): ReadonlyMap<string, AuditRule> {
  return new Map(entries);
}

/** Registry of fingerprintable audit rules. */
export const AUDIT_RULES: ReadonlyMap<string, AuditRule> = buildRegistry();

export function getRule(slug: string): AuditRule | undefined {
  return AUDIT_RULES.get(slug);
}

/**
 * SHA-256 of the canonicalized matcher payload + the evaluator version.
 *
 * Including `EVALUATOR_VERSION` in the hash means a behavior change in
 * the interpreter — the `evaluate()` switch, the row normalizer, the
 * canonicalizer — rolls the fingerprint forward even if the matcher
 * data didn't change. Captures the FULL match-surface, not just the
 * rule's data.
 *
 * Built from explicit string concatenation rather than `JSON.stringify`
 * so the encoding is bit-stable regardless of object-key order
 * variations across JS engines (the inner `canonicalizeMatcher` already
 * sorts keys deterministically; we just don't want to layer another
 * `JSON.stringify` on top of an outer object whose key order isn't
 * guaranteed by spec).
 */
export function semanticHashFor(rule: AuditRule): string {
  const payload = `v${EVALUATOR_VERSION}\n${canonicalizeMatcher(rule.matcher)}`;
  return createHash("sha256").update(payload).digest("hex");
}
