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
export const PHONE_TRAILING_RE = new RegExp(String.raw`\s*(?:${PHONE_NUMBER_RE.source})\s*$`);

/** Default hare extraction patterns for Google Calendar descriptions. */
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

/**
 * Extract hare names from the event description.
 * Accepts pre-compiled RegExp[] or raw string[] (compiled on the fly for one-off use).
 * The adapter fetch() pre-compiles once per scrape for efficiency.
 */
export function extractHares(description: string, customPatterns?: string[] | RegExp[]): string | undefined {
  // Pre-normalize: rejoin lines where HTML stripping split a label from its colon
  // e.g., "<b>WHO (hares)</b>: Name" → after stripHtmlTags → "WHO (hares)\n: Name"
  const normalized = description.replace(
    /(\b(?:Who|Hares?)\s*\(?[^)]*\)?)\s*\n\s*:/gim,
    "$1:",
  );
  let patterns: RegExp[];

  if (customPatterns && customPatterns.length > 0) {
    patterns = typeof customPatterns[0] === "string"
      ? compilePatterns(customPatterns as string[])
      : customPatterns as RegExp[];
  } else {
    patterns = DEFAULT_HARE_PATTERNS;
  }

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match) {
      let hares = (match[1] ?? "").trim();
      // Clean up trailing punctuation/whitespace
      hares = hares.split("\n")[0].trim();
      // Multi-line continuation: when the label line has NO inline content
      // (e.g., "Hares:\nAlice\nBob"), walk forward and concatenate names until
      // a blank line, next field label, URL, or boilerplate marker. Restricted
      // to label-only headers — text after an inline hare is almost always
      // free-form description, not a co-hare. Additional safeguards against
      // sweeping prose: cap line count, per-line length, and reject lines that
      // look like sentences rather than hash names.
      if (!hares) {
        const MAX_CONTINUATION_LINES = 6;
        const MAX_LINE_LEN = 80;
        const matchEnd = (match.index ?? 0) + match[0].length;
        const continuation = normalized.slice(matchEnd).split("\n");
        const startIdx = continuation[0] === "" ? 1 : 0;
        let added = 0;
        for (let i = startIdx; i < continuation.length && added < MAX_CONTINUATION_LINES; i++) {
          const line = continuation[i].trim();
          if (!line) break;
          if (EVENT_FIELD_LABEL_RE.test(line) || EVENT_FIELD_LABEL_UPPERCASE_RE.test(line)) break;
          if (HARE_BOILERPLATE_RE.test(line)) break;
          if (/^https?:\/\//i.test(line)) break;
          // Reject obviously non-name lines: colons (unrecognized field labels),
          // sentence-ending punctuation, or overly long lines.
          if (line.length > MAX_LINE_LEN) break;
          if (/[:.!?]\s/.test(line) || /[.!?]$/.test(line)) break;
          if (line.includes(":")) break;
          hares = hares ? `${hares}, ${line}` : line;
          added++;
        }
      }
      // Truncate at asterisk separators (e.g., "Denny's Sucks *** could use a co-hare")
      hares = hares.replace(/\s*\*{2,}\s*.*$/, "").trim();
      // Strip trailing co-hare commentary (e.g., "could use a co-hare", "need a co-hare")
      hares = hares.replace(/\s*(?:could|need)\s+.*?co-?hares?\b.*$/i, "").trim();
      // Truncate at boilerplate markers (description text leaking into hares)
      hares = hares.replace(HARE_BOILERPLATE_RE, "").trim();
      // Truncate at next embedded field label when HTML stripping collapsed fields
      // (e.g., "AmazonWhat: A beautiful trail …" → "Amazon"). The \b word boundary
      // in EVENT_FIELD_LABEL_RE prevents matching tokens inside other words.
      hares = hares.replace(EVENT_FIELD_LABEL_RE, "").replace(EVENT_FIELD_LABEL_UPPERCASE_RE, "").trim();
      // Strip trailing US phone numbers — both formatted ("(555) 123-4567",
      // "719-360-3805") and bare 10-digit runs ("2406185563" — see #742).
      hares = hares.replace(PHONE_TRAILING_RE, "").trim();
      // Truncate at mid-string phone numbers with trailing commentary (e.g.,
      // "Name, 2406185563 CALL for same day service" — #809). Real names
      // don't contain 10-digit runs.
      const phoneIdx = hares.search(PHONE_NUMBER_RE);
      if (phoneIdx >= 0) {
        hares = hares
          .slice(0, phoneIdx)
          .replace(/[,:;\s-]*(?:phone|tel|mobile|cell)\b\s*:?\s*$/i, "")
          .replace(/[,:;\s-]+$/, "")
          .trim();
      }
      // Skip generic/non-hare "Who:" answers
      if (/^(?:that be you|your|all|everyone)/i.test(hares)) continue;
      // Filter hare strings starting with common prepositions/verbs (description text, not names)
      if (/^(?:away|at|from|drop|is|was|has|had|can|will|would|should|could|for|and|or|off)\b/i.test(hares)) continue;
      if (hares.length > 0 && hares.length < 200) return hares;
    }
  }

  return undefined;
}
