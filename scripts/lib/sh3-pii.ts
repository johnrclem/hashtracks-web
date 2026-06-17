/**
 * PII scrubbing for the Seoul H3 historical archive backfill.
 *
 * The Seoul H3 archive lists hare phone numbers (and occasionally emails) inline
 * in the hare field, in BOTH the domestic `010-XXXX-XXXX` and the international
 * `+82 10-XXXX-XXXX` forms. The merge pipeline's `sanitizeHares` only strips
 * trailing logistics/boilerplate — NOT mid-string phone numbers — so the frozen
 * dataset must be scrubbed at freeze time. The `01x` / `+82` anchors spare false
 * positives such as "Line 1 (10-15 min walk)" and year ranges like "1995-1996".
 *
 * `HARE_PII_RES` is exported (non-global, safe for `.test()`) so the regression
 * test guarding `scripts/data/sh3-kr-history.json` checks the exact same patterns
 * the scrubber removes.
 */

// Pattern sources (no flags) so we can build both non-global detectors and one
// global replacer without duplicating the literals. Inter-group separators use
// `*` (not `?`) because the archive has inconsistent spacing (e.g. "+82  10-…"
// with a double space). Each `[-\s.]*` is followed by a required disjoint class
// (`\d`), so the patterns stay ReDoS-linear.
const INTL_MOBILE = String.raw`\+82[-\s]*1[0-9][-\s.]*\d{3,4}[-\s.]*\d{4}`;
const DOMESTIC_MOBILE = String.raw`\b01[0-9][-\s.]*\d{3,4}[-\s.]*\d{4}\b`;
const EMAIL = String.raw`[\w.+-]+@[\w.-]+\.\w+`;

/** Non-global detection patterns. Used by the scrubber AND the regression test. */
export const HARE_PII_RES: readonly RegExp[] = [
  new RegExp(INTL_MOBILE),
  new RegExp(DOMESTIC_MOBILE),
  new RegExp(EMAIL),
];

const PII_GLOBAL = new RegExp(`${EMAIL}|${INTL_MOBILE}|${DOMESTIC_MOBILE}`, "g");

/**
 * Remove phone/email PII from a free-text field and tidy the separators left
 * behind (so "A +82 10-… & B" → "A & B", "A +82 10-…, B" → "A, B"). Returns
 * `undefined` when nothing meaningful remains.
 */
export function scrubHarePii(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const out = value
    .replace(PII_GLOBAL, "")
    .replace(/\(\s*\)/g, "") // empty parens from a stripped phone
    .replace(/\s*&\s*/g, " & ") // normalise ampersand spacing (keep "A & B")
    .replace(/\s+([,;])/g, "$1") // no space before comma/semicolon
    .replace(/([,;])\s*(?=[,;&])/g, "") // collapse a leftover separator run
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;&]+|[\s,;&]+$/g, "")
    .trim();
  return out || undefined;
}
