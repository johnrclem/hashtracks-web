/**
 * Shared hare-extraction utilities.
 *
 * Hosts `extractHares` (and its trailing-phone strip) for adapters that parse
 * hare names out of free-form event descriptions. Currently used by
 * `google-calendar/adapter.ts`, `meetup/adapter.ts`, and `html-scraper/phoenixhhh.ts`.
 *
 * Lives outside `utils.ts` because it depends on `PHONE_NUMBER_RE` from
 * `@/pipeline/audit-checks`, which already imports from `utils.ts` — moving
 * the function into `utils.ts` would create an import cycle.
 *
 * The iCal adapter (`ical/adapter.ts`) has a sibling `extractHaresFromDescription`
 * that has diverged in shape; consolidating it here is a candidate follow-up.
 */
import { PHONE_NUMBER_RE } from "@/pipeline/audit-checks";
import {
  EVENT_FIELD_LABEL_RE,
  EVENT_FIELD_LABEL_UPPERCASE_RE,
  HARE_BOILERPLATE_RE,
  compilePatterns,
} from "./utils";

// End-of-string trailing-phone strip used by hare extraction (#742 "Slug 2406185563")
// and by extractLocationFromDescription in google-calendar/adapter.ts (#743
// "123 Main St 555-123-4567"). Anchored to end-of-string — a global strip
// would eat "800" out of address fragments like "Suite 1 800".
// nosemgrep: detect-non-literal-regexp — source is a hard-coded constant from audit-checks (mirrors utils.ts:151 suppression)
// eslint-disable-next-line -- security/detect-non-literal-regexp + security-node/non-literal-reg-expr (Codacy ESLint plugins not loaded locally); source is a hard-coded constant
export const PHONE_TRAILING_RE = new RegExp(String.raw`\s*(?:${PHONE_NUMBER_RE.source})\s*$`); // NOSONAR nosemgrep

/** Default hare extraction patterns for Google Calendar descriptions. */
/* eslint-disable -- security/detect-unsafe-regex (Codacy ESLint plugin not loaded locally); patterns operate on trusted GCal description fields with bounded line slicing in extractHares */
const DEFAULT_HARE_PATTERNS = [
  /(?:^|\n)[ \t]*H{1,3}are(?:\s*&\s*Co-Hares?)?\(?s?\)?:[ \t]*(.*)/im,  // Hare:, Hares:, HHHares: (Asheville's "HHH" = Hash House Harriers convention)
  // "WHO ARE THE HARES:" template variant — must match before the generic
  // "Who:" pattern so the full label prefix is consumed. Non-greedy capture
  // with a section-label lookahead terminator handles concatenated descriptions
  // (no newlines between WHO/WHAT/WHEN sections, e.g. EPH3 #2719) — without it,
  // `(.*)` swallows the entire post-label remainder. See #1082.
  /(?:^|\n)[ \t]*WHO\s+ARE\s+THE\s+HARES?\s*:[ \t]*(.+?)(?=(?:WHO|WHAT|WHEN|WHERE|HOW)\s+\w+|\n|$)/im, // NOSONAR — non-greedy, bounded by literal lookahead alternation; description is trusted GCal field
  /(?:^|\n)[ \t]*Who\s*\(?(?:hares?)?\)?:[ \t]*(.*)/im,  // Who:, WHO (hares):, Who(hare):
  /(?:^|\n)[ \t]*Hare[ \t]+([A-Z*].+)/im,  // "Hare C*ck Swap" (no colon, name starts uppercase/special)
];
/* eslint-enable */

const MAX_CONTINUATION_LINES = 6;
const MAX_LINE_LEN = 80;
const MAX_HARES_LEN = 200;
const GENERIC_WHO_ANSWER_RE = /^(?:that be you|your|all|everyone)/i;
const PROSE_PREFIX_RE = /^(?:away|at|from|drop|is|was|has|had|can|will|would|should|could|for|and|or|off)\b/i;
const URL_PREFIX_RE = /^https?:\/\//i;
const SENTENCE_PUNCT_RE = /[:.!?]\s/;
const SENTENCE_END_RE = /[.!?]$/;
const PHONE_LABEL_TRAILING_RE = /[,:;\s-]*(?:phone|tel|mobile|cell)\b\s*:?\s*$/i; // NOSONAR — bounded char class + literal alternation + `$` anchor
const PUNCT_TRAILING_RE = /[,:;\s-]+$/; // NOSONAR — single char class + `$` anchor
const ASTERISK_TAIL_RE = /\s*\*{2,}\s*.*$/; // NOSONAR — bounded `.*$` on first-line slice (no nesting); input ≤200 chars
const COHARE_COMMENTARY_RE = /\s*(?:could|need)\s+.*?co-?hares?\b.*$/i; // NOSONAR — non-greedy `.*?` anchored to literal `co-?hares?\b`
// Strip trailing " - lowercase commentary" annotations like
// "Just Ayaka - it's her first time haring!" (#1212 GLH3). Anchored to
// end-of-string; `[a-z]` rules out names whose 2nd token starts uppercase
// (e.g. "Alice - Bob" — second hare survives the existing comma split).
const TRAILING_LOWERCASE_COMMENTARY_RE = /\s+[-–—]\s+[a-z][^A-Z]*$/; // NOSONAR — anchored, single char class
// Sibling Co-Hare label scan (#1212): when the primary `Hare:` capture
// succeeded, also look for a separate `Co-Hare:` / `Co-Hares:` line in the
// same description. Non-greedy until end of line.
const COHARE_LABEL_RE = /(?:^|\n)[ \t]*Co-?Hares?:[ \t]*([^\n]+)/im; // NOSONAR — anchored, capture is `[^\n]+` (no nesting)
// Pre-normalize: rejoin lines where HTML stripping split a label from its colon
// e.g., "<b>WHO (hares)</b>: Name" → after stripHtmlTags → "WHO (hares)\n: Name"
const LABEL_COLON_REJOIN_RE = /(\b(?:Who|Hares?)\s*\(?[^)]*\)?)\s*\n\s*:/gim; // NOSONAR — bounded by literal `\n` and char classes; capture is `[^)]*` (no nesting)

function selectPatterns(customPatterns?: string[] | RegExp[]): RegExp[] {
  if (!customPatterns || customPatterns.length === 0) return DEFAULT_HARE_PATTERNS;
  return typeof customPatterns[0] === "string"
    ? compilePatterns(customPatterns as string[])
    : (customPatterns as RegExp[]);
}

/** Returns true if the line should terminate continuation collection. */
function isContinuationTerminator(line: string): boolean {
  if (!line) return true;
  if (EVENT_FIELD_LABEL_RE.test(line)) return true;
  if (EVENT_FIELD_LABEL_UPPERCASE_RE.test(line)) return true;
  if (HARE_BOILERPLATE_RE.test(line)) return true;
  if (URL_PREFIX_RE.test(line)) return true;
  if (line.length > MAX_LINE_LEN) return true;
  if (SENTENCE_PUNCT_RE.test(line) || SENTENCE_END_RE.test(line)) return true;
  if (line.includes(":")) return true;
  return false;
}

/**
 * Multi-line continuation: when the label line has NO inline content
 * (e.g., "Hares:\nAlice\nBob"), walk forward and concatenate names until a
 * blank line, next field label, URL, or boilerplate marker. Restricted to
 * label-only headers — text after an inline hare is almost always free-form
 * description, not a co-hare. Caps line count and per-line length, and
 * rejects sentence-shaped lines.
 */
function collectContinuationLines(normalized: string, match: RegExpExecArray): string {
  // eslint-disable-next-line -- @typescript-eslint/no-unnecessary-condition: defensive against engines where match.index can be undefined
  const matchEnd = (match.index ?? 0) + match[0].length;
  const continuation = normalized.slice(matchEnd).split("\n");
  const startIdx = continuation[0] === "" ? 1 : 0;
  let collected = "";
  let added = 0;
  for (let i = startIdx; i < continuation.length && added < MAX_CONTINUATION_LINES; i++) {
    // eslint-disable-next-line -- security/detect-object-injection (Codacy ESLint plugin not loaded locally); `i` is a numeric loop index, not user input
    const line = continuation[i].trim();
    if (isContinuationTerminator(line)) break;
    collected = collected ? `${collected}, ${line}` : line;
    added++;
  }
  return collected;
}

/**
 * Apply trimming, punctuation/asterisk truncation, boilerplate/phone/label
 * regexes, and the final prepositional/generic filters. Returns undefined if
 * the candidate fails a filter (caller should try the next pattern).
 */
function cleanAndFilterHares(raw: string): string | undefined {
  let hares = raw
    .replace(ASTERISK_TAIL_RE, "")
    .trim()
    .replace(COHARE_COMMENTARY_RE, "")
    .trim()
    .replace(HARE_BOILERPLATE_RE, "")
    .trim()
    .replace(EVENT_FIELD_LABEL_RE, "")
    .replace(EVENT_FIELD_LABEL_UPPERCASE_RE, "")
    .trim()
    .replace(PHONE_TRAILING_RE, "")
    .trim();

  // Truncate at mid-string phone numbers with trailing commentary (e.g.,
  // "Name, 2406185563 CALL for same day service" — #809). Real names don't
  // contain 10-digit runs.
  const phoneIdx = hares.search(PHONE_NUMBER_RE);
  if (phoneIdx >= 0) {
    hares = hares
      .slice(0, phoneIdx)
      .replace(PHONE_LABEL_TRAILING_RE, "")
      .replace(PUNCT_TRAILING_RE, "")
      .trim();
  }

  // Trailing " - lowercase commentary" annotation strip (#1212 GLH3).
  // Runs after punctuation/phone trimming so the dash is reliably present.
  // Cheap substring gate skips the regex for the vast majority of inputs.
  if (/\s[-–—]\s/.test(hares)) {
    hares = hares.replace(TRAILING_LOWERCASE_COMMENTARY_RE, "").trim();
  }

  if (GENERIC_WHO_ANSWER_RE.test(hares)) return undefined;
  if (PROSE_PREFIX_RE.test(hares)) return undefined;
  if (hares.length === 0 || hares.length >= MAX_HARES_LEN) return undefined;
  return hares;
}

/**
 * Extract hare names from the event description.
 * Accepts pre-compiled RegExp[] or raw string[] (compiled on the fly for one-off use).
 * The adapter fetch() pre-compiles once per scrape for efficiency.
 */
export function extractHares(description: string, customPatterns?: string[] | RegExp[]): string | undefined {
  const normalized = description.replaceAll(LABEL_COLON_REJOIN_RE, "$1:");
  const patterns = selectPatterns(customPatterns);

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (!match) continue;

    // eslint-disable-next-line -- @typescript-eslint/no-unnecessary-condition: defensive — capture group can be undefined for some custom patterns
    let raw = (match[1] ?? "").trim().split("\n")[0].trim();
    if (!raw) raw = collectContinuationLines(normalized, match);

    const cleaned = cleanAndFilterHares(raw);
    if (cleaned) return mergeCoHareIfPresent(cleaned, normalized);
  }

  return undefined;
}

/** Token-set containment: every word in `b` already appears (case-insensitive)
 *  as a whole word in `a`. Avoids substring false-positives where "Ali" would
 *  match inside "Alice and Bob" and silently suppress a real co-hare. */
function tokensFullyContained(a: string, b: string): boolean {
  const aTokens = new Set(a.toLowerCase().split(/\s+/));
  return b.toLowerCase().split(/\s+/).every((t) => aTokens.has(t));
}

/** Append a sibling `Co-Hare:` / `Co-Hares:` capture to the primary hare
 *  string when one exists in the description. Gated on a cheap substring
 *  check so consumers without Co-Hare labels (Meetup, Phoenix, most GCal)
 *  skip the regex altogether. Order is text-derived (deterministic) — no
 *  sort required for fingerprint stability. */
function mergeCoHareIfPresent(primary: string, normalized: string): string {
  if (!/co-?hare/i.test(normalized)) return primary;
  const coMatch = COHARE_LABEL_RE.exec(normalized);
  if (!coMatch?.[1]) return primary;
  const coRaw = coMatch[1].trim().split("\n")[0].trim();
  const coCleaned = cleanAndFilterHares(coRaw);
  if (!coCleaned || tokensFullyContained(primary, coCleaned)) return primary;
  return `${primary}, ${coCleaned}`;
}
