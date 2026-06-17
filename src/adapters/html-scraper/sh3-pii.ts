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
 * `scripts/data/sh3-kr-history.json` checks the exact pattern the scrubber removes.
 *
 * Regex notes: patterns are LITERALS (not `new RegExp(string)`) to avoid the
 * Codacy non-literal-regexp flag; the email uses `[\w-]+(?:\.[\w-]+)+` (the label
 * class excludes `.`) so there's no backtracking ambiguity (Sonar S5852); the
 * separator tidy-up uses string ops rather than `\s*`-heavy regexes the analyzer
 * flags as ReDoS. The `01x` / `+82` anchors spare false positives like
 * "Line 1 (10-15 min walk)" and year ranges such as "1995-1996".
 *
 * PII_DETECT (non-global, for `.test`) and PII_STRIP (global, for `.replace`)
 * MUST keep identical alternation bodies.
 */
const PII_DETECT =
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\+82[-\s]*1[0-9][-\s.]*\d{3,4}[-\s.]*\d{4}|\b01[0-9][-\s.]*\d{3,4}[-\s.]*\d{4}\b/;
const PII_STRIP =
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\+82[-\s]*1[0-9][-\s.]*\d{3,4}[-\s.]*\d{4}|\b01[0-9][-\s.]*\d{3,4}[-\s.]*\d{4}\b/g;

/** True if the text contains a phone number or email (used by the regression test). */
export function containsHarePii(value: string): boolean {
  return PII_DETECT.test(value);
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
  const cleaned = value
    .replace(PII_STRIP, "")
    .split(/[,;]/)
    .map(collapseSpaces)
    .filter((part) => part.length > 0)
    .join(", ");
  return cleaned || undefined;
}
