/**
 * Hash Rego field cleanup (kennel-external-ids plan, section 5.6, PR A).
 *
 * Hash Rego fills fields it has no value for with placeholders ("Start
 * Location TBA", hares "TBA", the joke price "$6969"), and some kennels type
 * the run date and Metro station into the event title. Placeholders come back
 * as `undefined`, never "" or null: merge reads "" and null as "clear this
 * field", while an omitted field keeps another source's value.
 *
 * Titles are cleaned with string operations rather than one large regex, to
 * stay inside Sonar's regex complexity and ReDoS limits.
 */

const PLACEHOLDER_LOCATIONS = new Set([
  "tba",
  "tbd",
  "tba/tbd",
  "tbd/tba",
  "start location tba",
  "start location tbd",
  "location tba",
  "location tbd",
]);

const PLACEHOLDER_HARES = new Set(["tba", "tbd", "na", "n/a", "none"]);

/** Lowercase, collapse spaces, drop trailing punctuation ("TBA." → "tba"). */
function normalizeToken(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").toLowerCase();
}

/** A real location, or undefined for a Hash Rego placeholder. */
export function cleanHashRegoLocation(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return PLACEHOLDER_LOCATIONS.has(normalizeToken(value)) ? undefined : value;
}

/**
 * Real hare names, or undefined for a placeholder. "Away: 3:30pm" is a
 * hare-away time typed into the hares field, not a name.
 */
export function cleanHashRegoHares(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const token = normalizeToken(value);
  if (PLACEHOLDER_HARES.has(token)) return undefined;
  if (token.startsWith("away:")) return undefined;
  return value;
}

/**
 * A real cost, or undefined for Hash Rego's joke price "$6969". "$0" stays:
 * some events really are free.
 */
export function cleanHashRegoCost(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const compact = value.replace(/\s/g, "");
  return compact === "$6969" || compact === "6969" ? undefined : value;
}

// ── Titles ──────────────────────────────────────────────────────────────

const MONTHS = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

const WEEKDAYS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
]);

/** Punctuation stripped from a word before it is classified. */
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function bare(word: string): string {
  return word.replace(EDGE_PUNCTUATION, "").toLowerCase();
}

function isYear(word: string): boolean {
  const w = bare(word);
  return w.length === 4 && (w.startsWith("19") || w.startsWith("20")) && /^\d{4}$/.test(w);
}

/** "4", "4th", "23rd", "1st", "2nd". */
function isDayOfMonth(word: string): boolean {
  const w = bare(word);
  const digits = w.replace(/(st|nd|rd|th)$/, "");
  if (!/^\d{1,2}$/.test(digits)) return false;
  const n = Number(digits);
  return n >= 1 && n <= 31;
}

/** "7/16/2026" or "7/16/26". */
function isNumericDate(word: string): boolean {
  const parts = bare(word).split("/");
  return parts.length === 3 && parts.every((p) => /^\d{1,4}$/.test(p)) && parts[2].length >= 2;
}

/**
 * Index of the word that starts a dated tail, or -1. A date counts only when
 * a year follows within two words, so a theme like "July 4th Hash" stays.
 * A weekday just before the date ("Thursday, October 8th, 2026") joins the
 * tail.
 */
function findDateTailStart(words: string[]): number {
  for (let i = 0; i < words.length; i++) {
    const w = bare(words[i]);
    let dateEnd = -1;
    if (isNumericDate(words[i])) {
      dateEnd = i;
    } else if (MONTHS.has(w) && i + 1 < words.length && isDayOfMonth(words[i + 1])) {
      dateEnd = i + 1; // "June 4", "July 23rd"
    } else if (isDayOfMonth(words[i]) && i + 1 < words.length && MONTHS.has(bare(words[i + 1]))) {
      dateEnd = i + 1; // "30 July"
    }
    if (dateEnd === -1) continue;
    const hasYear =
      isNumericDate(words[dateEnd]) ||
      words.slice(dateEnd + 1, dateEnd + 3).some(isYear);
    if (!hasYear) continue;
    const prev = i > 0 ? bare(words[i - 1]) : "";
    const start = WEEKDAYS.has(prev) ? i - 1 : i;
    // Only a date set off from the name ("Trail, June 4, 2026", "Earth!
    // August 27", "Trail - June 4 2026") is a dated tail. "Hashers on May 4
    // 2026 aka Star Wars" keeps its date.
    if (start > 0 && endsWithSeparator(words[start - 1])) return start;
  }
  return -1;
}

function endsWithSeparator(word: string): boolean {
  return word === "-" || word === "–" || word.endsWith(",") || word.endsWith("!");
}

const DANGLING_WORDS = new Set(["aka", "on", "at", "the", "of", "in", "and", "&", "for"]);

/** A cut must leave a whole name: balanced parentheses, no dangling "aka". */
function isWholeName(head: string): boolean {
  if (!/\p{L}{3}/u.test(head)) return false;
  const opens = head.split("(").length - 1;
  const closes = head.split(")").length - 1;
  if (opens !== closes) return false;
  const last = head.split(" ").at(-1) ?? "";
  return !DANGLING_WORDS.has(bare(last));
}

/** Trim separators left at the end once a tail is cut ("Trail," → "Trail"). */
function trimTrailingSeparators(value: string): string {
  let end = value.length;
  while (end > 0 && ",;:-–— ".includes(value[end - 1])) end--;
  return value.slice(0, end);
}

/** Remove "[UPDATED]" / "(UPDATED)" markers anywhere in the title. */
function stripUpdatedMarkers(title: string): string {
  let out = title;
  for (const marker of ["[updated]", "(updated)"]) {
    let idx = out.toLowerCase().indexOf(marker);
    while (idx !== -1) {
      out = out.slice(0, idx) + out.slice(idx + marker.length);
      idx = out.toLowerCase().indexOf(marker);
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Drop a " - <station> Metro (…)" tail: "The Graffiti Hash Trail - Columbia
 * Heights Metro (Green/Yellow)" → "The Graffiti Hash Trail".
 */
function stripMetroTail(title: string): string {
  const idx = title.lastIndexOf(" - ");
  if (idx <= 0) return title;
  let tail = title.slice(idx + 3).trim();
  // Drop a trailing "(Green/Yellow)" line list.
  if (tail.endsWith(")")) {
    const open = tail.lastIndexOf("(");
    if (open > 0) tail = tail.slice(0, open).trim();
  }
  const words = tail.split(/\s+/);
  // A station name: capitalized words ending in "Metro" ("Columbia Heights
  // Metro"), not prose like "Meet at the Metro".
  const isStation =
    words.length >= 2 &&
    bare(words.at(-1)!) === "metro" &&
    words.every((w) => /^\p{Lu}/u.test(w.replace(EDGE_PUNCTUATION, "")));
  return isStation ? title.slice(0, idx) : title;
}

/**
 * Collapse a doubled year: "Green Dress Weekend 2027 2027" → "… 2027" and
 * "2026 Oregon Spring Campout 2026" → "Oregon Spring Campout 2026".
 */
function collapseDoubledYear(title: string): string {
  const words = title.split(" ");
  if (words.length < 3) return title;
  const last = words.at(-1)!;
  if (!isYear(last)) return title;
  if (bare(words.at(-2)!) === bare(last)) return words.slice(0, -1).join(" ");
  if (bare(words[0]) === bare(last)) return words.slice(1).join(" ");
  return title;
}

/**
 * Clean a Hash Rego event title: drop "[UPDATED]" markers, cut a dated tail
 * (the date and everything after it, such as a Metro station), drop a
 * " - … Metro" tail, and collapse a doubled year. A cut that would leave
 * nothing meaningful is skipped, so the original title is never lost.
 */
export function cleanHashRegoTitle(title: string): string {
  if (!title) return title;
  let out = stripUpdatedMarkers(title);

  const words = out.split(" ");
  const cut = findDateTailStart(words);
  if (cut > 0) {
    const head = trimTrailingSeparators(words.slice(0, cut).join(" "));
    if (isWholeName(head)) out = head;
  }

  const noMetro = trimTrailingSeparators(stripMetroTail(out));
  if (isWholeName(noMetro)) out = noMetro;

  out = collapseDoubledYear(out);
  return out || title;
}
