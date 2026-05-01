/**
 * Concrete rule definitions for the audit-rule registry (bundle 4b).
 *
 * Each entry is the DSL-form translation of an existing rule from
 * `audit-checks.ts`. Patterns are inlined as data — the constraint
 * imposed in P0a is that every fingerprintable rule expresses its
 * matching logic entirely from registry data, with no runtime
 * dependency on shared regex constants.
 *
 * Five rules from the existing `KNOWN_AUDIT_RULES` set are NOT migrated
 * yet because their matching shape requires DSL ops that don't exist:
 *
 *   - `hare-cta-text`        — date-relative skip (events >14d out)
 *   - `title-raw-kennel-code` — kennelCode-templated regex + cross-field
 *   - `location-duplicate-segments` — string normalization + segment compare
 *   - `event-improbable-time` — numeric extraction from "HH:MM"
 *   - `description-dropped`  — cross-field length comparison
 *
 * Those rules continue to live in `audit-checks.ts` in their original
 * imperative form, with `fingerprint: false` semantics until the DSL
 * grows. They keep filing legacy-style with title-based dedup.
 *
 * **No runtime change in this PR.** The registry is populated and
 * tested for behavioral parity with `audit-checks.ts`, but no caller
 * yet routes through `evaluate()`. Bundle 5 wires the file-finding
 * endpoint to consume the registry; until then the existing
 * imperative checks remain the source of truth.
 */

import type { AuditRule } from "./rule-registry";

/**
 * Inlined regex sources mirror the patterns currently in `audit-checks.ts`
 * (and, for hare-boilerplate-leak, `adapters/utils.ts`). Kept as string
 * literals so they participate in `semanticHash` — when one of these
 * source strings changes, the fingerprint rolls automatically.
 *
 * The mirroring is the migration tax: until bundle 5 routes the
 * imperative checks through the registry, both sources of truth coexist.
 * `rule-definitions.test.ts` enforces parity by feeding a fixed corpus
 * through both paths and asserting agreement.
 */

// hare-phone-number / location-phone-number: matches the classic
// separated `(415) 555-1212` / `415.555.1212` / `415-555-1212` form
// plus an unseparated 10-digit run, anchored with non-digit boundaries.
const PHONE_NUMBER_PATTERN =
  String.raw`(?:(?<!\d)\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)|(?<!\d)\d{10}(?!\d))`;

// hare-boilerplate-leak: from `adapters/utils.ts:HARE_BOILERPLATE_RE`.
const HARE_BOILERPLATE_PATTERN =
  String.raw`\s*\b(?:WHAT TIME|WHAT TO WEAR|WHERE|Location|HASH CASH|Cost|Price|Length|Distance|Directions|Trail Type|Trail is|Start|Meet at|Registration|WHAT IS THE COST|On-On|On On|Hares?\s+Needed|Question|Call\s|Lost\?)[:\s].*|\s*\(\d{3}\)\s*\d{3}.*`;

// title-cta-text: combines the standalone TITLE_CTA_PATTERN and the
// CTA_EMBEDDED_PATTERNS array from audit-checks.ts into a single
// alternation (the imperative form OR'd them together via .some()).
const TITLE_CTA_PATTERN =
  String.raw`\b(?:wanna\s+hare|available\s+dates|check\s+out\s+our|sign\s*up|hares?\s+(?:needed|wanted|required|volunteer\w*)|need(?:ed)?\s+(?:a\s+)?hares?|looking\s+for\s+(?:a\s+)?hares?)\b`;

// title-schedule-description: combines three TITLE_SCHEDULE_PATTERNS.
const TITLE_SCHEDULE_PATTERN =
  String.raw`\b(?:runs?\s+on\s+the\s+(?:first|second|third|fourth|last)|meets?\s+every|runs?\s+every|hashes?\s+on\s+the\s+(?:first|second|third|fourth|last))\b`;

const TITLE_HTML_ENTITIES_PATTERN = String.raw`&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);`;

const TITLE_TIME_ONLY_PATTERN = String.raw`^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})$`;

const LOCATION_EMAIL_CTA_PATTERN =
  String.raw`^\s*(?:inquire|email|contact|ping|message|msg|dm)\b.*?\S+@\S+\.\S+.*$`;

/**
 * The 12 fingerprintable rules currently expressible in the DSL. Each
 * is `(slug, AuditRule)` — `buildRegistry` accepts this shape.
 */
export const FINGERPRINTABLE_RULES: ReadonlyArray<readonly [string, AuditRule]> = [
  // ── Hares ──────────────────────────────────────────────────────
  [
    "hare-single-char",
    {
      slug: "hare-single-char",
      category: "hares",
      severity: "error",
      field: "haresText",
      version: 1,
      matcher: { op: "length-eq", field: "haresText", value: 1 },
      fingerprint: true,
    },
  ],
  [
    "hare-url",
    {
      slug: "hare-url",
      category: "hares",
      severity: "warning",
      field: "haresText",
      version: 1,
      matcher: {
        op: "or",
        conditions: [
          { op: "starts-with", field: "haresText", value: "https://" },
          { op: "starts-with", field: "haresText", value: "http://" },
        ],
      },
      fingerprint: true,
    },
  ],
  [
    "hare-description-leak",
    {
      slug: "hare-description-leak",
      category: "hares",
      severity: "warning",
      field: "haresText",
      version: 1,
      matcher: { op: "length-gt", field: "haresText", value: 200 },
      fingerprint: true,
    },
  ],
  [
    "hare-phone-number",
    {
      slug: "hare-phone-number",
      category: "hares",
      severity: "warning",
      field: "haresText",
      version: 1,
      matcher: {
        op: "regex-test",
        field: "haresText",
        pattern: PHONE_NUMBER_PATTERN,
      },
      fingerprint: true,
    },
  ],
  [
    "hare-boilerplate-leak",
    {
      slug: "hare-boilerplate-leak",
      category: "hares",
      severity: "warning",
      field: "haresText",
      version: 1,
      matcher: {
        op: "regex-test",
        field: "haresText",
        pattern: HARE_BOILERPLATE_PATTERN,
        flags: "i",
      },
      fingerprint: true,
    },
  ],

  // ── Title ──────────────────────────────────────────────────────
  [
    "title-cta-text",
    {
      slug: "title-cta-text",
      category: "title",
      severity: "warning",
      field: "title",
      version: 1,
      matcher: {
        op: "regex-test",
        field: "title",
        pattern: TITLE_CTA_PATTERN,
        flags: "i",
      },
      fingerprint: true,
    },
  ],
  [
    "title-schedule-description",
    {
      slug: "title-schedule-description",
      category: "title",
      severity: "warning",
      field: "title",
      version: 1,
      matcher: {
        op: "regex-test",
        field: "title",
        pattern: TITLE_SCHEDULE_PATTERN,
        flags: "i",
      },
      fingerprint: true,
    },
  ],
  [
    "title-html-entities",
    {
      slug: "title-html-entities",
      category: "title",
      severity: "warning",
      field: "title",
      version: 1,
      matcher: {
        op: "regex-test",
        field: "title",
        pattern: TITLE_HTML_ENTITIES_PATTERN,
        flags: "i",
      },
      fingerprint: true,
    },
  ],
  [
    "title-time-only",
    {
      slug: "title-time-only",
      category: "title",
      severity: "warning",
      field: "title",
      version: 1,
      matcher: {
        op: "regex-test",
        field: "title",
        pattern: TITLE_TIME_ONLY_PATTERN,
        flags: "i",
      },
      fingerprint: true,
    },
  ],

  // ── Location ───────────────────────────────────────────────────
  [
    "location-url",
    {
      slug: "location-url",
      category: "location",
      severity: "warning",
      field: "locationName",
      version: 1,
      matcher: {
        op: "or",
        conditions: [
          { op: "starts-with", field: "locationName", value: "https://" },
          { op: "starts-with", field: "locationName", value: "http://" },
        ],
      },
      fingerprint: true,
    },
  ],
  [
    "location-phone-number",
    {
      slug: "location-phone-number",
      category: "location",
      severity: "warning",
      field: "locationName",
      version: 1,
      matcher: {
        op: "regex-test",
        field: "locationName",
        pattern: PHONE_NUMBER_PATTERN,
      },
      fingerprint: true,
    },
  ],
  [
    "location-email-cta",
    {
      slug: "location-email-cta",
      category: "location",
      severity: "warning",
      field: "locationName",
      version: 1,
      matcher: {
        op: "regex-test",
        field: "locationName",
        pattern: LOCATION_EMAIL_CTA_PATTERN,
        flags: "i",
      },
      fingerprint: true,
    },
  ],
];
