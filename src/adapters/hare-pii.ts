/**
 * Generic PII scrubbing for hare fields, applied at ingest by the merge
 * pipeline's `sanitizeHares` so EVERY adapter's `hares` output is protected —
 * not just the source it was first discovered on (Seoul H3, PR #2227).
 *
 * Many sources list hare phone numbers (and occasionally emails) inline in the
 * hare field, in domestic and international forms with inconsistent spacing.
 * `sanitizeHares` only strips TRAILING logistics — not mid-string phones — so
 * those leak into canonical, public-facing events without this scrubber.
 *
 * Lives in `src/adapters/` (next to `hare-extraction.ts`), NOT `utils.ts`,
 * because it imports `PHONE_NUMBER_RE` from `@/pipeline/audit-checks`, which
 * already imports from `utils.ts` — putting it in `utils.ts` would create an
 * import cycle (same constraint hare-extraction.ts documents).
 *
 * Regex notes: patterns are kept as separate per-type LITERALS in an array (not
 * one big alternation) so each stays under the Sonar S5843 complexity budget.
 * The email uses `[\w-]+(?:\.[\w-]+)+` (the label class excludes `.`) so there's
 * no backtracking ambiguity. The international pattern uses a DIGIT-count floor
 * (≥8 digits total, E.164) rather than a char-count floor, so the hash "+1"
 * plus-one convention ("+1 510 Crew") and short ranges ("+3-5 milers") can't be
 * clipped. The Korean `01x` pattern is LOAD-BEARING: the North American
 * `PHONE_NUMBER_RE` (3-3-4 or bare-10) does NOT match a Korean 3-4-4 number like
 * `010-2354-1741`. Detection uses `String.search` (which ignores the global
 * flag's `lastIndex`, unlike `RegExp.test`), so the global regexes are reused
 * safely across the merge hot path.
 */
import { PHONE_NUMBER_RE } from "@/pipeline/audit-checks";

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const INTL_PHONE_RE = /\+\d{1,3}[\s().-]*\d(?:[\s().-]*\d){6,13}/g;
const DOMESTIC_MOBILE_RE = /\b01\d[-\s.]*\d{3,4}[-\s.]*\d{4}\b/g;

// Reuse the audit's North American phone pattern as the single source of truth
// so the scrubber removes exactly what `checkHareQuality`'s `hare-phone-number`
// rule detects (otherwise `selfHealSanitizers` would re-flag forever). Needs the
// global flag so `.replace` strips ALL occurrences. Mirrors the suppression on
// hare-extraction.ts:28-30 — the source is a hard-coded constant from audit-checks.
// nosemgrep: detect-non-literal-regexp -- source is a hard-coded constant from audit-checks
// eslint-disable-next-line -- security/detect-non-literal-regexp + security-node/non-literal-reg-expr (Codacy ESLint plugins not loaded locally); source is a hard-coded constant
const NA_PHONE_GLOBAL_RE = new RegExp(PHONE_NUMBER_RE.source, "g"); // NOSONAR nosemgrep

export { EMAIL_RE, INTL_PHONE_RE, DOMESTIC_MOBILE_RE, NA_PHONE_GLOBAL_RE };

export const HARE_PII_RES = [
  EMAIL_RE,
  INTL_PHONE_RE,
  NA_PHONE_GLOBAL_RE,
  DOMESTIC_MOBILE_RE,
];

/** True if the text contains a phone number or email. */
export function containsHarePii(value: string): boolean {
  return HARE_PII_RES.some((re) => value.search(re) !== -1);
}

/** Collapse internal whitespace runs and trim (no ReDoS-flagged regex). */
function collapseSpaces(part: string): string {
  return part.split(/\s+/).filter(Boolean).join(" ");
}

/**
 * Tidy parenthesis artifacts left behind by PII removal so the common
 * "Name (contact)" shape collapses to "Name":
 *   - empty parens:   "DJO (a@b.com)" → "DJO ()" → "DJO"
 *   - orphaned paren: the NA phone pattern's optional `\(?` eats a leading "(",
 *     leaving a dangling ")" — "Just Jorge (973-760-5774)" → "Just Jorge )" → "Just Jorge"
 * Balanced, non-empty parens (e.g. "(1995-1996)") are preserved. The orphan pass
 * is a regex-free, surrogate-safe linear scan (no ReDoS surface).
 */
function stripParenArtifacts(input: string): string {
  const withoutEmpty = input.replace(/\(\s*\)/g, "");
  const chars = Array.from(withoutEmpty);
  // Pass 1: drop unmatched ")" (no open paren still on the stack).
  let depth = 0;
  const kept: string[] = [];
  for (const ch of chars) {
    if (ch === ")") {
      if (depth === 0) continue;
      depth--;
    } else if (ch === "(") {
      depth++;
    }
    kept.push(ch);
  }
  // Pass 2: drop the `depth` still-unmatched "(" (scanning from the end).
  for (let i = kept.length - 1; i >= 0 && depth > 0; i--) {
    if (kept[i] === "(") {
      kept.splice(i, 1);
      depth--;
    }
  }
  return kept.join("");
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
  for (const re of HARE_PII_RES) stripped = stripped.replace(re, "");
  stripped = stripParenArtifacts(stripped);
  const cleaned = stripped
    .split(/[,;]/)
    .map(collapseSpaces)
    .filter((part) => part.length > 0)
    .join(", ");
  return cleaned || undefined;
}
