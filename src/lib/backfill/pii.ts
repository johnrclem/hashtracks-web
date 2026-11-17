/**
 * PII scanner for backfill archives (docs/onboarding-backfill-automation-design.md 8.2, guard G8).
 *
 * One module, used by the implementer before it commits, by CI and by the
 * server, so the three can't disagree. It scans every string field of every
 * row, and URL-like strings again after percent-decoding (the Zagreb archive
 * had a phone number inside a Maps URL). It reports row index, field and
 * pattern id, never the matched text. It fails closed and has no allowlist.
 *
 * Out of scope (accepted risk, 8.2): home addresses and private individuals'
 * real names.
 */

export const PII_SCANNER_VERSION = 1;

export interface PiiHit {
  /** Index of the row in the archive file. */
  row: number;
  /** Dotted path of the field, e.g. "hares" or "externalLinks.0.url". */
  field: string;
  /** Which pattern matched (see PII_PATTERNS); never the matched text. */
  pattern: string;
  /** True when the hit was found only after percent-decoding the value. */
  decoded: boolean;
}

/**
 * Patterns, each a separate literal so it stays under Sonar's regex-complexity
 * budget. Digits are matched with explicit separators, never `.*`, so every
 * pattern is linear. Every pattern is global, for `matchAll`. Lookarounds keep a match from starting or ending inside a
 * longer digit run (a run number, a year range, a coordinate).
 */
const PII_PATTERNS: ReadonlyArray<{ id: string; re: RegExp }> = [
  // name@domain.tld, and the "name (at) domain (dot) tld" / "name [at] domain" forms.
  // The domain must end in a letter TLD, so "Expy@1.3 mi" in driving directions isn't an address.
  { id: "email", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g },
  { id: "email-at-word", re: /[\w.+-]+\s*[([{]\s*at\s*[)\]}]\s*[\w-]+(?:\s*(?:\.|[([{]\s*dot\s*[)\]}])\s*[\w-]+)+/gi },
  // International: +CC then 7–13 more digits with optional separators (E.164 floor of 8 digits).
  { id: "intl", re: /\+\d{1,3}[\s().\/-]*\d(?:[\s().\/-]*\d){6,13}/g },
  // North American, dashed / spaced / dotted / parenthesised: 555-123-4567, (555) 123 4567, 555.123.4567.
  { id: "na", re: /(?<![\d.])\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}(?![\d.])/g },
  { id: "na-paren", re: /\(\d{3}\)\s*\d{3}[\s.-]?\d{4}(?!\d)/g },
  // Bare 10 or 11 digits (5551234567, 15551234567).
  { id: "bare-10", re: /(?<![\d.])1?\d{10}(?![\d.])/g },
  // 7-digit local numbers: 286-0444, 286 0444, 286.0444.
  { id: "local-7", re: /(?<![\d.:/-])\d{3}[\s.-]\d{4}(?![\d.:/-])/g },
  // European / Croatian mobiles in national form: 091 234 5678, 098/123-456, 06 12 34 56 78, 0171 1234567.
  { id: "eu-mobile", re: /(?<![\d.])0\d{1,3}[\s\/.-]\d{2,4}(?:[\s\/.-]\d{2,4}){1,3}(?![\d.])/g },
];

/** A run of at least 7 digits once separators are removed: anything shorter can't be a phone number. */
function digitCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= "0" && ch <= "9") n++;
  return n;
}

/** Minimum digits per phone pattern: European national mobiles have 9–10, so a URL date path like "09/1274-25" (8) isn't one. */
const MIN_DIGITS: Record<string, number> = { "eu-mobile": 9 };

/** A decimal coordinate ("+126.914607" in a Maps URL, where "+" is an encoded space) isn't an international number. */
const COORDINATE_LIKE = /^\+?-?\d{1,3}\.\d{4,}$/;

/** Calendar dates written like numbers must not count as phones: 2014-10-04, 04.10.2014, 2014 10 04. */
const DATE_LIKE = /^(?:\d{4}[\s.\/-]\d{1,2}[\s.\/-]\d{1,2}|\d{1,2}[\s.\/-]\d{1,2}[\s.\/-]\d{4})$/;

/** True when a phone-pattern match is really a date, a coordinate or too short to be a number. */
function isExcusedPhone(id: string, text: string): boolean {
  const t = text.trim();
  return digitCount(t) < (MIN_DIGITS[id] ?? 7) || DATE_LIKE.test(t) || COORDINATE_LIKE.test(t);
}

/**
 * Every pattern that matches the value. Each pattern is tried at every
 * position: an excused first match (a date) must not hide a phone number
 * later in the same string.
 */
function matchingPatterns(value: string): string[] {
  const ids: string[] = [];
  for (const { id, re } of PII_PATTERNS) {
    const isPhone = id !== "email" && id !== "email-at-word";
    // matchAll clones the (global) pattern, so no shared lastIndex leaks between calls.
    for (const m of value.matchAll(re)) {
      if (!isPhone || !isExcusedPhone(id, m[0])) {
        ids.push(id);
        break;
      }
    }
  }
  return ids;
}

function safeDecode(value: string): string | null {
  if (!value.includes("%")) return null;
  try {
    // Decode repeatedly so double-encoded values (%2520) are caught too.
    let prev = value;
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(prev.replaceAll("+", " "));
      if (next === prev) break;
      prev = next;
    }
    return prev === value ? null : prev;
  } catch {
    // A malformed escape: scan the raw value only. Fail closed is the caller's
    // job (the raw value is still scanned).
    return null;
  }
}

function visit(value: unknown, path: string, row: number, hits: PiiHit[]): void {
  if (typeof value === "string") {
    for (const pattern of matchingPatterns(value)) hits.push({ row, field: path, pattern, decoded: false });
    const decoded = safeDecode(value);
    if (decoded !== null) {
      const already = new Set(hits.filter((h) => h.row === row && h.field === path).map((h) => h.pattern));
      for (const pattern of matchingPatterns(decoded)) {
        if (!already.has(pattern)) hits.push({ row, field: path, pattern, decoded: true });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => visit(v, path ? `${path}.${i}` : String(i), row, hits));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) visit(v, path ? `${path}.${k}` : k, row, hits);
  }
}

/** Scan every string of every row. An empty result is the only pass. */
export function scanArchiveForPii(rows: readonly unknown[]): PiiHit[] {
  const hits: PiiHit[] = [];
  rows.forEach((row, i) => visit(row, "", i, hits));
  return hits;
}

/** Hit counts by pattern, for summaries that must not show the matched text. */
export function summarizePiiHits(hits: readonly PiiHit[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of hits) out[h.pattern] = (out[h.pattern] ?? 0) + 1;
  return out;
}
