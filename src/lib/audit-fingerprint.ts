/**
 * Audit-issue fingerprint computation.
 *
 * The fingerprint is a SHA-256 hash that uniquely identifies the rule
 * variation that produced an audit finding. The file-finding endpoint
 * (added in bundle 5) queries `AuditIssue.fingerprint` to coalesce
 * duplicates across the three audit streams — same
 * `(kennelCode, ruleSlug, ruleVersion, semanticHash)` tuple → same hash
 * → comment on the existing issue instead of opening a new one.
 *
 * The four inputs deliberately exclude the affected event-id set —
 * sampling-dependent inputs would hash differently across streams that
 * happened to surface different events for the same defect, breaking
 * cross-stream coalescing.
 *
 * `semanticHash` is computed by the rule registry from the rule's
 * matcher DSL plus `EVALUATOR_VERSION`, so any change to matcher data
 * OR interpreter behavior rolls the fingerprint forward. `ruleVersion`
 * is bumped manually when the registry author wants to treat a change
 * as a fresh version even if the matcher payload's canonical form is
 * unchanged (rare).
 */

import { createHash } from "node:crypto";

export interface AuditFingerprintInput {
  kennelCode: string;
  ruleSlug: string;
  ruleVersion: number;
  /** sha256 hex from `rule-registry.ts:semanticHashFor`. */
  semanticHash: string;
}

/**
 * Compute the canonical fingerprint for an audit finding.
 *
 * Inputs are joined with newline separators and hashed once. Newline as
 * the separator (rather than a delimiter character that could appear in
 * any input) keeps the encoding unambiguous: kennelCode, ruleSlug, and
 * the hex-only `semanticHash` are all guaranteed not to contain newlines
 * by their respective producers (slug regex, sha256 output), and
 * `ruleVersion` is an integer.
 */
export function computeAuditFingerprint(
  input: AuditFingerprintInput,
): string {
  const payload = [
    input.kennelCode,
    input.ruleSlug,
    String(input.ruleVersion),
    input.semanticHash,
  ].join("\n");
  return createHash("sha256").update(payload).digest("hex");
}
