/**
 * PII scrubbing for Seoul H3 hare fields.
 *
 * The Seoul H3 source lists hare phone numbers (and occasionally emails) inline
 * in the hare field, in BOTH the domestic `010-XXXX-XXXX` and international
 * `+82 10-XXXX-XXXX` forms (with inconsistent spacing, e.g. a double space). The
 * merge pipeline's `sanitizeHares` only strips trailing logistics — NOT mid-string
 * phones — so both the live adapter and the frozen archive backfill scrub here.
 *
 * `containsHarePii` is exported so the regression test guarding
 * `scripts/data/sh3-kr-history.json` checks the exact patterns the scrubber removes.
 *
 * Regex notes: patterns are kept as separate per-type LITERALS (not `new RegExp`,
 * and not one big alternation) so each stays under the Sonar S5843 complexity
 * budget. The email uses `[\w-]+(?:\.[\w-]+)+` (the label class excludes `.`) so
 * there's no backtracking ambiguity. Each `[-\s.]*` is followed by a disjoint
 * required token (`\d`), keeping the phone patterns linear. The `01x` / `+82`
 * anchors spare false positives like "Line 1 (10-15 min walk)" and "1995-1996".
 * Detection uses `String.search` (which ignores the global flag's `lastIndex`,
 * unlike `RegExp.test`), so the global regexes are reused safely.
 */
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const INTL_MOBILE_RE = /\+82[-\s]*1\d[-\s.]*\d{3,4}[-\s.]*\d{4}/g;
const DOMESTIC_MOBILE_RE = /\b01\d[-\s.]*\d{3,4}[-\s.]*\d{4}\b/g;
const PII_RES = [EMAIL_RE, INTL_MOBILE_RE, DOMESTIC_MOBILE_RE];

/** True if the text contains a phone number or email (used by the regression test). */
export function containsHarePii(value: string): boolean {
  return PII_RES.some((re) => value.search(re) !== -1);
}

/** Collapse internal whitespace runs and trim (no ReDoS-flagged regex). */
function collapseSpaces(part: string): string {
  return part.split(/\s+/).filter(Boolean).join(" ");
}

/**
 * Remove phone/email PII and tidy the separators left behind, so
 * "A +82 10-… & B" → "A & B" and "A +82 10-…, B" → "A, B". Comma/semicolon
 * tokenisation keeps "A & B" intact while normalising spacing. Returns
 * `undefined` when nothing meaningful remains.
 */
export function scrubHarePii(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  let stripped = value;
  for (const re of PII_RES) stripped = stripped.replace(re, "");
  const cleaned = stripped
    .split(/[,;]/)
    .map(collapseSpaces)
    .filter((part) => part.length > 0)
    .join(", ");
  return cleaned || undefined;
}
