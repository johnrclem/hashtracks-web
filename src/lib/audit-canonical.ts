/**
 * Canonical-block emission and parsing for audit-issue bodies.
 *
 * Cron-filed and (eventually) chrome-filed audit issues embed a tiny
 * machine-readable JSON block in their markdown body so the sync
 * pipeline can backfill `AuditIssue.fingerprint` without re-deriving
 * the hash from scratch each time. The block is hidden as an HTML
 * comment so it never renders in the GitHub UI.
 *
 * Format:
 *   <!-- audit-canonical: {"v":1,"stream":"AUTOMATED","kennelCode":"nych3","ruleSlug":"hare-url","ruleVersion":1,"semanticHash":"abc...","fingerprint":"def..."} -->
 *
 * Parsing fails closed: any malformed payload (missing field, wrong
 * schema version, JSON parse error) returns `null` and the row stays
 * un-fingerprinted, to be picked up by the bridging tier later.
 */

import type { AuditStream } from "@/lib/audit-stream-meta";
import { computeAuditFingerprint } from "@/lib/audit-fingerprint";
import { getRule, semanticHashFor } from "@/pipeline/rule-registry";

/** Schema version of the canonical-block payload. Bump when the
 *  field set changes incompatibly so older readers can fail closed
 *  on newer-format blocks. */
export const CANONICAL_SCHEMA_VERSION = 1;

export interface CanonicalBlock {
  /** Schema version. Reject blocks where v !== CANONICAL_SCHEMA_VERSION. */
  v: number;
  stream: AuditStream;
  kennelCode: string;
  ruleSlug: string;
  ruleVersion: number;
  /** sha256 hex from `rule-registry.semanticHashFor(rule)` */
  semanticHash: string;
  /** sha256 hex from `computeAuditFingerprint(...)` — pre-computed
   *  so the sync doesn't need to re-derive it on every upsert. */
  fingerprint: string;
}

/** Markdown HTML comment containing the JSON-encoded block. Stable
 *  prefix lets `parseCanonicalBlock` find it without ambiguity even
 *  when the body has other HTML comments. */
const PREFIX = "<!-- audit-canonical:";
const SUFFIX = "-->";

/**
 * Wrap the canonical block in the HTML-comment envelope used by audit
 * issues. Pure function — no I/O. Caller is responsible for
 * computing `fingerprint` (typically via `computeAuditFingerprint`).
 *
 * `-->` inside any string field is escaped to `--&gt;` so the comment
 * envelope can't be terminated early by a malicious or accidental
 * payload (e.g. a future kennelCode containing the literal sequence).
 * Mirrors the same defense in `src/pipeline/auto-issue.ts`.
 */
export function emitCanonicalBlock(block: Omit<CanonicalBlock, "v">): string {
  const payload: CanonicalBlock = { v: CANONICAL_SCHEMA_VERSION, ...block };
  const json = JSON.stringify(payload).replaceAll("-->", "--&gt;");
  return `${PREFIX} ${json} ${SUFFIX}`;
}

/**
 * Extract the canonical block from an audit-issue body. Returns null
 * when the body has no block, the block is malformed JSON, or the
 * schema version doesn't match. Strict on shape — partial matches
 * fail closed so the bridging tier can claim the row instead.
 *
 * Symmetric with `emitCanonicalBlock`: the emitter escapes `-->`
 * inside string fields to `--&gt;` so the comment envelope can't be
 * terminated early; the parser MUST unescape that back before
 * `JSON.parse` or the original string value is silently corrupted
 * (Gemini PR #1172 review feedback).
 */
export function parseCanonicalBlock(body: string | null | undefined): CanonicalBlock | null {
  if (!body) return null;
  const start = body.indexOf(PREFIX);
  if (start === -1) return null;
  const end = body.indexOf(SUFFIX, start + PREFIX.length);
  if (end === -1) return null;
  const json = body.slice(start + PREFIX.length, end).trim().replaceAll("--&gt;", "-->");
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isCanonicalBlock(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the canonical-block payload from the registry. Returns
 * `undefined` for rules that aren't in the registry or have
 * `fingerprint: false` — caller falls back to filing without a
 * block, leaving the row for the bridging tier.
 *
 * Lives here (not in audit-issue.ts) so the chrome-stream filing
 * endpoint can reuse the same plumbing without depending on the
 * cron-only AuditGroup type.
 */
export function buildCanonicalBlock(input: {
  stream: AuditStream;
  kennelCode: string;
  ruleSlug: string;
}): Omit<CanonicalBlock, "v"> | undefined {
  const rule = getRule(input.ruleSlug);
  if (!rule?.fingerprint) return undefined;
  const semanticHash = semanticHashFor(rule);
  const fingerprint = computeAuditFingerprint({
    kennelCode: input.kennelCode,
    ruleSlug: rule.slug,
    ruleVersion: rule.version,
    semanticHash,
  });
  return {
    stream: input.stream,
    kennelCode: input.kennelCode,
    ruleSlug: rule.slug,
    ruleVersion: rule.version,
    semanticHash,
    fingerprint,
  };
}

function isCanonicalBlock(value: unknown): value is CanonicalBlock {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === CANONICAL_SCHEMA_VERSION &&
    isAuditStreamValue(v.stream) &&
    typeof v.kennelCode === "string" &&
    typeof v.ruleSlug === "string" &&
    typeof v.ruleVersion === "number" &&
    typeof v.semanticHash === "string" &&
    typeof v.fingerprint === "string"
  );
}

function isAuditStreamValue(value: unknown): value is AuditStream {
  return (
    value === "AUTOMATED" ||
    value === "CHROME_EVENT" ||
    value === "CHROME_KENNEL" ||
    value === "UNKNOWN"
  );
}

// ── Dedup identity marker (issue #2308 dedup hardening) ────────────────
//
// The canonical block above is only emitted for *fingerprintable* rules. But
// chrome-kennel findings frequently use non-fingerprintable rules AND carry
// free-form, agent-authored titles, so neither the fingerprint nor the title
// gives the filer a stable way to recognize an already-open issue across runs.
// That let a re-file fork a duplicate even when the same (kennel, rule) issue
// was already open (#2425≡#2421, #2296≡#2260).
//
// The identity marker is a tiny, ALWAYS-emitted block carrying just the dedup
// identity — (stream, kennelCode, ruleSlug) — which is independent of which
// sample events a given run happened to pick. The GitHub-search dedup gate in
// `audit-filer.ts` reads it back out of open issue bodies to match a re-file to
// its existing issue, with no dependence on the local mirror's freshness.

/** Schema version of the identity-marker payload. */
export const IDENTITY_SCHEMA_VERSION = 1;

const IDENTITY_PREFIX = "<!-- audit-identity:";

/** The stable dedup identity of an audit finding — sample-event-independent. */
export interface AuditIdentity {
  stream: AuditStream;
  kennelCode: string;
  ruleSlug: string;
}

interface IdentityPayload extends AuditIdentity {
  v: number;
}

/**
 * Emit the always-on identity marker for an audit-issue body. Pure function;
 * uses the same `-->`-escaping defense as `emitCanonicalBlock` so a payload
 * field can't terminate the comment envelope early.
 */
export function emitIdentityMarker(identity: AuditIdentity): string {
  const payload: IdentityPayload = { v: IDENTITY_SCHEMA_VERSION, ...identity };
  const json = JSON.stringify(payload).replaceAll("-->", "--&gt;");
  return `${IDENTITY_PREFIX} ${json} ${SUFFIX}`;
}

function parseIdentityMarker(body: string): AuditIdentity | null {
  const start = body.indexOf(IDENTITY_PREFIX);
  if (start === -1) return null;
  const end = body.indexOf(SUFFIX, start + IDENTITY_PREFIX.length);
  if (end === -1) return null;
  const json = body.slice(start + IDENTITY_PREFIX.length, end).trim().replaceAll("--&gt;", "-->");
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isIdentityPayload(parsed)) return null;
    return {
      stream: parsed.stream,
      kennelCode: parsed.kennelCode,
      ruleSlug: parsed.ruleSlug,
    };
  } catch {
    return null;
  }
}

function isIdentityPayload(value: unknown): value is IdentityPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === IDENTITY_SCHEMA_VERSION &&
    isAuditStreamValue(v.stream) &&
    typeof v.kennelCode === "string" &&
    typeof v.ruleSlug === "string"
  );
}

/**
 * Extract the dedup identity from an audit-issue body. Reads the explicit
 * identity marker first, then falls back to the canonical block (which already
 * carries stream + kennelCode + ruleSlug) so issues filed before the identity
 * marker existed still match on the fingerprintable path. Returns null when the
 * body carries neither (fails closed — the gate then treats it as no-match).
 */
export function parseAuditIdentity(
  body: string | null | undefined,
): AuditIdentity | null {
  if (!body) return null;
  const marker = parseIdentityMarker(body);
  if (marker) return marker;
  const canonical = parseCanonicalBlock(body);
  if (canonical) {
    return {
      stream: canonical.stream,
      kennelCode: canonical.kennelCode,
      ruleSlug: canonical.ruleSlug,
    };
  }
  return null;
}
