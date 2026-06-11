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
  BARE_KENNEL_CODE_RE,
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
  /(?:^|\n)[ \t]*H{1,3}are(?:\s*&\s*Co-Hares?)?\(?s?\)?[ \t]*:[ \t]*(.*)/im,  // Hare:, Hares:, "Hare :" (space before colon, #1884 MH3-Mpls), HHHares: (Asheville's "HHH" = Hash House Harriers convention)
  // "WHO ARE THE HARES:" template variant — must match before the generic
  // "Who:" pattern so the full label prefix is consumed. Non-greedy capture
  // with a section-label lookahead terminator handles concatenated descriptions
  // (no newlines between WHO/WHAT/WHEN sections, e.g. EPH3 #2719) — without it,
  // `(.*)` swallows the entire post-label remainder. See #1082.
  /(?:^|\n)[ \t]*WHO\s+ARE\s+THE\s+HARES?\s*:[ \t]*(.+?)(?=(?:WHO|WHAT|WHEN|WHERE|HOW)\s+\w+|\n|$)/im, // NOSONAR — non-greedy, bounded by literal lookahead alternation; description is trusted GCal field
  /(?:^|\n)[ \t]*Who\s*\(?(?:hares?)?\)?:[ \t]*(.*)/im,  // Who:, WHO (hares):, Who(hare):
  /(?:^|\n)[ \t]*Hare[ \t]+([A-Z*].+)/im,  // "Hare C*ck Swap" (no colon, name starts uppercase/special)
  // Natural-language form (#1584 Austin H3 #2278, #1615 mid-sentence follow-up):
  // "Hares are Smegma Balls and Dry Hose." Anchored to start-of-line OR after a
  // sentence terminator (period/exclam/question + whitespace) so forms like
  // "Birthday Hash! Hares are Smegma Balls..." also match. Explicit-uppercase
  // guard on the capture (`[A-Z*]`) keeps "The hares are bringing dogs" out;
  // `HARES_ARE_PROSE_FIRST_WORD_RE` catches "Hares are Needed/Welcome/...".
  // The `[Hh]ares?` literal label avoids /i (which would let `[A-Z*]` also
  // match lowercase). The lazy `.+?` plus a sentence-end lookahead bound the
  // capture so we stop at the next sentence terminator or newline.
  /(?:^|\n|(?<=[.!?]\s))[ \t]*[Hh]ares?\s+are\s+([A-Z*].+?)(?=[.!?](?:\s|$)|\n|$)/m,  // NOSONAR — bounded non-greedy, anchored to sentence/line end
  // Role-header template family (#1981 Brasilia, 6th cross-kennel instance).
  // Each REQUIRES a colon so prose ("the hare set a cracking trail") can never
  // match; the leading [^\nA-Za-z]{0,4} tolerates an emoji/symbol banner prefix
  // (e.g. "🐾 The Hares:"). Header-only forms (name on the next line) flow
  // through collectContinuationLines exactly like the bare "Hares:" pattern.
  /(?:^|\n)[^\nA-Za-z]{0,4}The\s+Hares?\b[ \t]*:[ \t]*(.*)/im,  // NOSONAR — "The Hare:" / "The Hares:" label variant
  /(?:^|\n)[^\nA-Za-z]{0,4}Perpetrators?(?:\(s\))?[ \t]*:[ \t]*(.*)/im,  // NOSONAR — "Perpetrator(s):" hash-slang synonym for hare
  /(?:^|\n)[^\nA-Za-z]{0,4}This\s+week['’]s\s+(?:perpetrator|hare)s?[ \t]*:[ \t]*(.*)/im,  // NOSONAR — "This week's perpetrator:" (straight + curly apostrophe)
];
/* eslint-enable */

const MAX_CONTINUATION_LINES = 6;
const MAX_LINE_LEN = 80;
const MAX_HARES_LEN = 200;
const GENERIC_WHO_ANSWER_RE = /^(?:that be you|your|all|everyone)/i;
const PROSE_PREFIX_RE = /^(?:away|at|from|drop|is|was|has|had|can|will|would|should|could|for|and|or|off)\b/i;
// First-word prose denylist — captured "hares" text whose first token is one
// of these common kennel-prose words is grammatical filler, not a name list.
// Catches false positives from the natural-language "Hares are X" pattern
// (#1584) — e.g. "Hares are Needed for July volunteers", "Hares are Welcome
// at the pool party". Strictly capitalized first letter so legit names like
// "Banana", "Cookie", "Crusty" pass through (lowercase / verb forms wouldn't
// have reached this branch — the pattern's `[A-Z*]` anchor already rejects
// lowercase prose). Listed in NOSONAR to satisfy S5852 complexity budget.
// Placeholder tokens (TBD/TBA/TBC) are intentionally NOT in this list —
// extractHares returning the placeholder preserves the existing contract for
// the WHO ARE THE HARES: TBD case (#1082), and downstream filters
// (isPlaceholderText in utils.ts, merge.ts placeholder check) demote them
// without populating Event.haresText. Plural forms (Volunteers?, Needs?)
// matter — `Volunteer\b` does not match "Volunteers" because `s` is a word
// char (Gemini PR #1612 review). Case-insensitive via `/i` to reject the
// all-caps "Hares are NEEDED for July" form (Codex P2 review).
const HARES_ARE_PROSE_FIRST_WORD_RE = /^(?:Needed|Needs?|Wanted|Required|Welcome|Available|Looking|Volunteers?|Still|Always|Currently|Hiding|Setting|Going|Coming|Ready|Now|Out|Off)\b/i; // NOSONAR — anchored literal alternation
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
// Date-range shape rejection (#1547 ABQ): multi-day campouts embed lines like
// "Friday 5/22-Monday 5/25" as the first description line. The pre-existing
// hare extractor captured the whole string as `hares`. Real hare names don't
// contain `<digits>/<digits>` slash-separated date tokens.
const DATE_RANGE_RE = /\b\d{1,2}\s*\/\s*\d{1,2}\b/;
// #1999 — defensive leading-label strip. extractHares's DEFAULT_HARE_PATTERNS
// already consume the label, but a custom config pattern (or a future caller)
// can capture the label along with the value. Strip a residual
// "Hares:/Hare:/Who:/Sweep:/Hare Raiser:" prefix so it never surfaces.
const LEADING_HARE_LABEL_RE = /^(?:hares?|who|sweep|hare\s*raiser)\s*:\s*/i; // NOSONAR — anchored, bounded literal alternation
// #2008 PGH H3 — a bare kennel code ("Who: PGHH3") is the kennel name, never a
// hash name. Rejected via the shared BARE_KENNEL_CODE_RE (imported from utils).
// #2008 PGH H3 row 4 — a conversational "…and you, of course" tail is not part
// of the hare list. Anchored to end-of-string; bounded literal alternation.
const HARE_CONVERSATIONAL_TAIL_RE = /,?\s+and you,?\s+of course\.?$/i; // NOSONAR — anchored, literal tokens
// Description-sentence leak (#1551 Wasatch): kennel uses "hare: NAME. event
// description..." on one line. The greedy `(.*)` capture pulls the entire
// remainder. Truncate at the first sentence-boundary `. ` when the tail is
// sentence-shaped — 3+ tokens AND at least one token starts with a lowercase
// letter. Hash names use Title Case; sentence tails contain lowercase
// function words like "crossover", "is", "and".
//
// Periods after common honorifics ("Dr.", "Mr.", "St.", "Ms.", "Mrs.") are
// skipped via per-position scan in `findHareSentenceBoundary` so
// "Dr. Strange. A crossover event…" truncates at "A crossover" — not at
// "Strange" — and "Dr. Strange. Captain Hook" stays intact when the tail
// is all Title Case. (Claude bot / Gemini review on #1577.)
const HARE_SENTENCE_BOUNDARY_RE = /\.\s+/g;
const LOWERCASE_TOKEN_RE = /(?:^|\s)[a-z]/;
const HONORIFICS = new Set(["dr", "mr", "ms", "mrs", "st"]);

function findHareSentenceBoundary(text: string): number {
  // Reset lastIndex on a fresh scan — the regex literal is `g`-flagged.
  HARE_SENTENCE_BOUNDARY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HARE_SENTENCE_BOUNDARY_RE.exec(text)) !== null) {
    const preceding = text.slice(0, m.index).split(/\s+/).pop()?.toLowerCase() ?? "";
    if (!HONORIFICS.has(preceding)) return m.index;
  }
  return -1;
}
// Sibling Co-Hare label scan (#1212): when the primary `Hare:` capture
// succeeded, also look for separate `Co-Hare:` / `Co-Hares:` lines in the
// same description. Both forms exposed: single-match (used internally as a
// substring gate) and global-match (used by `mergeCoHareIfPresent` to
// iterate every line via `matchAll`). Declared as literals so Codacy's
// non-literal-RegExp rule (security/detect-non-literal-regexp) doesn't
// flag the construction.
const COHARE_LABEL_RE = /(?:^|\n)[ \t]*Co-?Hares?:[ \t]*([^\n]+)/im; // NOSONAR — anchored, capture is `[^\n]+` (no nesting)
const COHARE_LABEL_GLOBAL_RE = /(?:^|\n)[ \t]*Co-?Hares?:[ \t]*([^\n]+)/gim; // NOSONAR — same shape, global flag for matchAll
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
 *
 * Only a SINGLE leading blank line is skipped (the `\n` immediately after the
 * label). Sources that double-space the role-header from the name must collapse
 * those blanks before calling extractHares — keeping the skip at one preserves
 * the blank-line terminator for every other consumer (a label followed by two
 * blanks then prose must NOT bleed that prose into hares).
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
 * regexes, and the final prepositional/generic filters. Tri-state return:
 * - `string` — a usable hare candidate.
 * - `null` — the candidate is a bare kennel code (the one high-confidence
 *   non-hare: the hare field holds the kennel's own code). Signals the merge
 *   pipeline to CLEAR a stale canonical `haresText` (self-healing, #2032).
 * - `undefined` — no usable candidate, OR a low-confidence/ambiguous reject
 *   (generic "everyone", prose leak, date range, over-long text). "No signal"
 *   — the merge pipeline preserves any existing hare.
 *
 * Exported so adapters with a bespoke capture (e.g. the Google Calendar
 * mid-line `Hare:` fallback, #2122) reuse this robust cleaner instead of
 * re-implementing a weaker subset of its passes.
 */
export function cleanAndFilterHares(raw: string): string | null | undefined {
  let hares = raw
    .replace(LEADING_HARE_LABEL_RE, "")
    .trim()
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

  // Conversational "…and you, of course" tail strip (#2008 PGH H3). Runs as a
  // dedicated pass because the trailing period has no following whitespace, so
  // the sentence-boundary scan below never fires on it.
  hares = hares.replace(HARE_CONVERSATIONAL_TAIL_RE, "").trim();

  // Description-sentence trailer strip (#1551 Wasatch). Truncate at first
  // non-honorific sentence boundary when the tail is sentence-shaped (3+
  // tokens, at least one starting with a lowercase letter). Preserves
  // honorific-prefixed names like "Dr. Strange. A crossover event…"
  // (truncates at "A crossover", keeping "Dr. Strange").
  const periodIdx = findHareSentenceBoundary(hares);
  if (periodIdx >= 0) {
    const tail = hares.slice(periodIdx + 1).trimStart();
    const tailTokens = tail.split(/\s+/).filter(Boolean);
    if (tailTokens.length >= 3 && LOWERCASE_TOKEN_RE.test(tail)) {
      hares = hares.slice(0, periodIdx).trim();
    }
  }

  // Low-confidence rejects return `undefined` (no signal — merge PRESERVES any
  // existing hare). These are ambiguous/mis-capture cases, NOT proof the event
  // has no hare: a generic "Who: everyone" is an audience answer, a
  // prepositional "Hare: at the corner" is a location leak, a "Hares are
  // Welcome/Going" line can imply hares exist, and a date-range is a mis-field.
  // Promoting any of these to an explicit clear could wipe a real haresText set
  // by another field/source on a same-trust rescrape (Codex PR #2038 review).
  if (GENERIC_WHO_ANSWER_RE.test(hares)) return undefined;
  if (PROSE_PREFIX_RE.test(hares)) return undefined;
  if (HARES_ARE_PROSE_FIRST_WORD_RE.test(hares)) return undefined;
  // Bare kennel-code reject (#2008 PGH H3 "Who: PGHH3") returns `null` — an
  // EXPLICIT clear. This is the one high-confidence non-hare: the hare field
  // literally holds the kennel's own code, never a hash name. Emitting null
  // self-heals the stale residue scrubbed by hand after #2032 instead of
  // requiring a manual cleanup.
  if (BARE_KENNEL_CODE_RE.test(hares)) return null;
  // Date-range rejection (#1547 ABQ): "Friday 5/22-Monday 5/25" is a campout
  // date range, not a hare name. Low-confidence mis-field → preserve, don't clear.
  if (DATE_RANGE_RE.test(hares)) return undefined;
  // No usable candidate (empty after cleaning) or an over-long description leak.
  if (hares.length === 0 || hares.length >= MAX_HARES_LEN) return undefined;
  return hares;
}

/**
 * Extract hare names from the event description.
 * Accepts pre-compiled RegExp[] or raw string[] (compiled on the fly for one-off use).
 * The adapter fetch() pre-compiles once per scrape for efficiency.
 */
export function extractHares(description: string, customPatterns?: string[] | RegExp[]): string | null | undefined {
  const normalized = description.replaceAll(LABEL_COLON_REJOIN_RE, "$1:");
  const patterns = selectPatterns(customPatterns);

  // Tri-state: a real hare string wins immediately. A recognized non-hare
  // candidate sets `sawRejection`, so we emit an explicit `null` (clear) only
  // when no later pattern yields a real name; absent any candidate we return
  // `undefined` (no signal — merge preserves existing). See RawEventData.hares.
  let sawRejection = false;
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (!match) continue;

    // eslint-disable-next-line -- @typescript-eslint/no-unnecessary-condition: defensive — capture group can be undefined for some custom patterns
    let raw = (match[1] ?? "").trim().split("\n")[0].trim();
    if (!raw) raw = collectContinuationLines(normalized, match);

    const cleaned = cleanAndFilterHares(raw);
    if (typeof cleaned === "string") return mergeCoHareIfPresent(cleaned, normalized);
    if (cleaned === null) sawRejection = true;
  }

  return sawRejection ? null : undefined;
}

/** Token-set containment: every word in `b` already appears (case-insensitive)
 *  as a whole word in `a`. Avoids substring false-positives where "Ali" would
 *  match inside "Alice and Bob" and silently suppress a real co-hare. Splits
 *  on whitespace + commas so the primary's joined form ("Alice, Bob") still
 *  matches a co-hare candidate of "Bob". */
function tokensFullyContained(a: string, b: string): boolean {
  const aTokens = new Set(a.toLowerCase().split(/[\s,]+/).filter(Boolean));
  return b.toLowerCase().split(/[\s,]+/).filter(Boolean).every((t) => aTokens.has(t));
}

/** Append every sibling `Co-Hare:` / `Co-Hares:` capture to the primary hare
 *  string. Gated on a cheap substring check so consumers without Co-Hare
 *  labels (Meetup, Phoenix, most GCal) skip the regex iteration altogether.
 *  Each candidate is filtered through `cleanAndFilterHares` and added only
 *  if it's not already token-contained in the running result. Order is
 *  text-derived (deterministic) — no sort required for fingerprint
 *  stability. */
function mergeCoHareIfPresent(primary: string, normalized: string): string {
  if (!/co-?hare/i.test(normalized)) return primary;
  let result = primary;
  for (const match of normalized.matchAll(COHARE_LABEL_GLOBAL_RE)) {
    const coRaw = match[1]?.trim().split("\n")[0].trim();
    if (!coRaw) continue;
    const coCleaned = cleanAndFilterHares(coRaw);
    if (coCleaned && !tokensFullyContained(result, coCleaned)) {
      result = `${result}, ${coCleaned}`;
    }
  }
  return result;
}
