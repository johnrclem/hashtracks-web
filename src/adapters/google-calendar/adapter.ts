import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { googleMapsSearchUrl, decodeEntities, stripHtmlTags, compilePatterns, EVENT_FIELD_LABEL_RE, EVENT_FIELD_LABEL_UPPERCASE_RE, CTA_EMBEDDED_PATTERNS, appendDescriptionSuffix, isPlaceholder, parse12HourTime, formatAmPmTime, stripNonEnglishCountry, extractHashRunNumber, hasPlaceholderRunNumber } from "../utils";
import { matchKennelPatterns, matchCompiledKennelPatterns, compileKennelPatterns, type KennelPattern, type CompiledKennelPattern } from "../kennel-patterns";
import { LOCATION_EMAIL_CTA_RE } from "@/pipeline/audit-checks";
import { parseDMSFromLocation } from "@/lib/geo";
import { extractHares, PHONE_TRAILING_RE } from "../hare-extraction";

/**
 * Default cap on the future-window passed to Google Calendar's `timeMax`. With
 * `singleEvents=true`, the API materializes RRULE recurrences across the entire
 * `[timeMin, timeMax]` window. Without a cap, an audit-driven `days=1500` (or
 * any historical wide-window scrape) materializes ~8 years of weekly runs and
 * persists them as CONFIRMED events that fall outside reconcile's pruning
 * window — exactly how chicago-h3 ended up with `lastEventDate=2034` (#939).
 *
 * 365 keeps the realistic planning horizon (annual events post 6-12 months
 * out) while bounding the worst case. Past window stays at full `days` for
 * backfill. Per-source override via `CalendarSourceConfig.futureHorizonDays`.
 */
const DEFAULT_FUTURE_HORIZON_DAYS = 365;

/** Default description patterns for run number extraction (Boston Hash Calendar format). */
const DEFAULT_RUN_NUMBER_PATTERNS = [
  /BH3\s*#\s*(\d+)/i,
  /(?:^|\n)\s*#(\d{3,})\s*(?:\n|$)/m, // NOSONAR — safe: no nested quantifiers, \s* is single-class, bounded input
];

/**
 * Extract run number from summary (e.g. "#2781") or description.
 * Always checks summary first with `#(\d+)`. Then checks description with
 * custom patterns (if provided) or default patterns.
 * Accepts pre-compiled RegExp[] or raw string[] (compiled on the fly for one-off use).
 *
 * Returns:
 *   - `number` when a clean run number is found
 *   - `null` when the summary contains an explicit placeholder marker
 *     (`#NN[X|XX|X?|TBD|TBA|?]`) — merge.ts's tri-state treats null as
 *     "explicit clear" so stale runNumbers from prior scrapes get
 *     overwritten when a kennel admin retitles to a placeholder
 *     (#1272/#1274/#1275)
 *   - `undefined` when no run-number signal is present (preserve existing)
 */
export function extractRunNumber(
  summary: string,
  description?: string,
  customPatterns?: string[] | RegExp[],
): number | null | undefined {
  // 1. Check summary first (e.g., "Beantown #255: ...", "BH3: ... #2781", "Cunth # 40: ...").
  // Shared `extractHashRunNumber` enforces the delimiter guard (#1147) — "#30X?"
  // rejects rather than parsing as 30.
  const fromSummary = extractHashRunNumber(summary);
  if (fromSummary !== undefined) return fromSummary;

  // 2. Summary placeholder takes precedence over description fallback. A
  // partial retitle (`#30: …` → `#30X?: …` while description still says
  // "#30") would otherwise let the stale description number reassert
  // itself and re-anchor the cleared run on the next merge.
  if (hasPlaceholderRunNumber(summary)) return null;

  // 3. Fall back to description patterns
  return description
    ? extractRunNumberFromDescription(description, customPatterns)
    : undefined;
}

function resolveRunNumberPatterns(customPatterns?: string[] | RegExp[]): RegExp[] {
  if (!customPatterns || customPatterns.length === 0) return DEFAULT_RUN_NUMBER_PATTERNS;
  if (typeof customPatterns[0] === "string") return compilePatterns(customPatterns as string[]);
  return customPatterns as RegExp[];
}

function extractRunNumberFromDescription(
  description: string,
  customPatterns?: string[] | RegExp[],
): number | undefined {
  for (const pattern of resolveRunNumberPatterns(customPatterns)) {
    const match = pattern.exec(description);
    if (!match?.[1]) continue;
    const num = Number.parseInt(match[1], 10);
    if (Number.isFinite(num) && num > 0) return num;
  }

  // Standalone run number in description (e.g., "#2792" on its own line)
  const standaloneMatch = /(?:^|\n)[ \t]*#(\d{3,})[ \t]*(?:\n|$)/m.exec(description);
  return standaloneMatch ? Number.parseInt(standaloneMatch[1], 10) : undefined;
}

/** Strip the "Kennel: " or "Kennel #N: " prefix from a calendar summary to extract the event title. */
export function extractTitle(summary: string): string {
  // Strip "Kennel: " or "Kennel #123: " prefix to get the event name
  const stripped = summary.replace(/^[^:]+:\s*/, "").trim();
  return stripped || summary;
}

// Pre-compiled date prefix patterns for stripDatePrefix (split to stay under regex complexity limits)
const DATE_PREFIX_FULL_RE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*[,\s]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[,\s]+\d{1,2}(?:st|nd|rd|th)?[,\s]+/i;
const DATE_PREFIX_NUMERIC_RE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*[,\s]+\d{1,2}\/\d{1,2}[,\s]+/i;

/** Strict "HH:MM" 24-hour format — guards `CalendarSourceConfig.defaultStartTime` against typos. */
const VALID_HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Personal-calendar drift detector for the non-hash event filter (#1271).
 * One regex per intent keeps each pattern under SonarCloud's S5843
 * complexity budget. Anchored at `^` so a hash title that mentions
 * "lunch" mid-string never matches. FALSE-NEGATIVE bias — anything
 * outside the allowlist passes through `buildRawEventFromGCalItem` even
 * when other fields are sparse (campouts, named annual events, kennel
 * acronyms like "TGIF Friday").
 *
 * Deliberately NOT included: `meet at <venue>` — kennel admins commonly
 * encode the venue in the summary alone ("Meet at the Tipsy Cow, 7pm")
 * with no other fields. Only `meet for|with|up with` are unambiguous
 * personal verbs (Codex review on PR #1297).
 */
const PERSONAL_TITLE_PATTERNS: readonly RegExp[] = [
  /^\s*meet\s+(?:for|with|up\s+with)\b/i,
  /^\s*(?:lunch|dinner|brunch|breakfast|drinks|coffee)\s+with\b/i,
  /^\s*(?:doctor|dentist|optician|orthodontist|chiropractor)(?:'s)?(?:\s+(?:appointment|visit))?\b/i,
  /^\s*(?:appointment|interview)\s+(?:for|with|at)\b/i,
  /^\s*pick\s+up\s+\S/i,
  /^\s*drop\s+off\s+\S/i,
  /^\s*call\s+(?:with|to)\b/i,
];

/** Strip leading day/date prefixes like "Wed April 1st", "Sat 3/28" from titles. */
export function stripDatePrefix(text: string): string {
  const stripped = text
    .replace(DATE_PREFIX_FULL_RE, "")
    .replace(DATE_PREFIX_NUMERIC_RE, "")
    .trim();
  return stripped || text;
}

/** Shared label names used in description field parsing (start-of-line detection + embedded truncation). */
// `Why|How` (#1129): Flour City uses a `Hare/Where/When/Why/How` template, and
// an empty `Why:` line was promoted to the event title because the label name
// wasn't recognized.
const LABEL_NAMES = String.raw`Hares?|Who|Where|Location|When|Why|How|Time|Start|What|Hash Cash|Cost|Price|Registration|On[ -]After|Directions|Pack\s*Meet|Meet(?:ing)?|Circle|Chalk\s*Talk`;

/** Extended label names with additional title-only terms. */
const TITLE_LABEL_NAMES = `${LABEL_NAMES}|Trail Type|Distance|Length`;

// Pre-compiled regexes for extractTitleFromDescription (called per-event)
const TITLE_LABEL_RE = new RegExp(`^(?:${TITLE_LABEL_NAMES})\\s*:`, "i");
const TITLE_EMBEDDED_LABEL_RE = new RegExp(`\\s+(?:${LABEL_NAMES})\\s*:.*`, "i");
const TITLE_TRAILING_EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/gu;
const TITLE_MULTI_EXCL_RE = /[!]{2,}/g;
const TITLE_MULTI_QUEST_RE = /[?]{2,}/g;
const TITLE_URL_RE = /^https?:\/\//;
const TITLE_PURE_TIME_RE = /^\d{1,2}:\d{2}\s*[ap]m$/i;
// Schedule-line pattern: "Label: time" or "Label & Label: time" — skip as title candidates
const TITLE_SCHEDULE_LINE_RE = /:\s*\d{1,2}:\d{2}\s*(?:am|pm)/i;
// #1194 GAL: short all-caps tokens like BYOB, TBD, TBA, FYI, NSFW are CTAs/
// acronyms a kennel typed into the description, not real event titles. Reject
// as title candidates so a 4-char "BYOB" doesn't become the displayed title.
const TITLE_ACRONYM_ONLY_RE = /^[A-Z]{2,6}$/;

// Hash-vernacular CTAs we strip from locationName (#743): parenthetical
// suffixes like "(text for details)" that creep in via Google Calendar.
const LOCATION_TRAILING_CTA_RE = /\s*\((?:text|call|contact|ping)[^)]*\)\s*$/i;
// #798 ABQ: bare-email fallback for locationName (e.g. "abqh3misman@gmail.com"
// on its own). The broader "Inquire for location: …@…" form is shared with
// the audit-checks rule and imported above.
const LOCATION_BARE_EMAIL_RE = /^\s*\S+@\S+\.\S+\s*$/;
// Coord-only `item.location` values: parse to structured lat/lng AND keep the
// verbatim string as the display location (#1195 GAL). Pre-fix, the decimal
// branch set `location = undefined` so description fallback could surface a
// real address; both formats now preserve the source string and only fall
// back when description provides something better.
const LOCATION_COORDS_ONLY_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
// Anchored shape-check for DMS-only strings — actual parsing delegates to
// `parseDMSFromLocation` in `src/lib/geo.ts`, which is also used by the merge
// pipeline. The shape-check is the only adapter-local part: it ensures the
// entire string is coords (not "Venue, 34°...").
const LOCATION_DMS_ONLY_RE = /^\s*\d{1,3}°\d{1,2}'[\d.]+"[NS],?\s+\d{1,3}°\d{1,2}'[\d.]+"[EW]\s*$/;

/**
 * Parse a coord-only location string into structured lat/lng. Returns null
 * for anything that isn't a recognised coord format (decimal or DMS).
 *
 * Cheap structural prefilter rejects letter-leading addresses before the
 * regex engine traverses them — coord strings always start with digit, sign,
 * or whitespace.
 */
function parseCoordOnlyLocation(value: string): { lat: number; lng: number } | null {
  const first = value.codePointAt(0);
  if (first === undefined) return null;
  const isDigit = first >= 48 && first <= 57;
  const isSign = first === 45 /* - */ || first === 43 /* + */;
  const isSpace = first === 32 || first === 9;
  if (!isDigit && !isSign && !isSpace) return null;

  const decMatch = LOCATION_COORDS_ONLY_RE.exec(value);
  if (decMatch) {
    const lat = Number.parseFloat(decMatch[1]);
    const lng = Number.parseFloat(decMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
      return { lat, lng };
    }
    return null;
  }
  if (LOCATION_DMS_ONLY_RE.test(value)) {
    return parseDMSFromLocation(value);
  }
  return null;
}

// Pre-compiled regexes for extractLocationFromDescription.
// #742: hash-vernacular labels (De'erections, Direcshits, Where to gather) are synonyms for "Location".
// Assembled from a list to keep the alternation readable and below SonarCloud's regex-complexity limit.
const LOCATION_LABEL_TOKENS = [
  String.raw`WHERE`,
  String.raw`Location`,
  String.raw`On[\s-]Start`,
  String.raw`Start\s+Address`,
  String.raw`Address`,
  String.raw`Meet(?:ing)?\s*(?:spot|point|at)?`,
  String.raw`De'?erections`,
  String.raw`Direcshits`,
  String.raw`Where\s+to\s+gather`,
];
// `[ \t]*` after the label colon — NOT `\s*` — keeps the value capture on the
// same line as the label. With `\s*` an empty `Where: ` line was consuming the
// trailing newline and capturing the next line's content (e.g. Flour City's
// `When: 5:69` template line, #1129).
const LOCATION_LABEL_RE = new RegExp(
  String.raw`(?:^|\n)\s*(?:${LOCATION_LABEL_TOKENS.join("|")})[ \t]*:[ \t]*(.+)`,
  "im",
);
// Fallback: bare label (no colon) with value on subsequent line, optionally
// after a URL line. Uses `[ \t]*` for intra-line whitespace and explicit `\n`
// boundaries to keep the regex linear (no overlapping `\s*` runs that span
// newlines, which Sonar S5852 flags as super-linear).
const LOCATION_BARE_LABEL_RE = /(?:^|\n)[ \t]*(?:WHERE|LOCATION)[ \t]*\n(?:[ \t]*https?:\/\/\S+[ \t]*\n)?[ \t]*(\S.*)/im;
// Secondary fallback: "Start:" as location label (lower priority — often contains time, not location)
const LOCATION_START_RE = /(?:^|\n)[ \t]*Start[ \t]*:[ \t]*(.+)/im;
// Filters bare time values from location results (e.g., "6:30pm", "18:30", "7:00")
const LOCATION_TIME_ONLY_RE = /^\d{1,2}:\d{2}(\s*(?:am|pm))?\s*$/i;
// #924 Chicagoland: WHERE: lines often contain themed instruction prose
// ("Slashie themed, so start is Ola's on Damen. Carry your shit & bring cash")
// rather than a geocodable address. Anchored to noun-objects + thematic
// adjectives so legit venue names like "Dress Circle Pub" survive.
const LOCATION_INSTRUCTION_RE = /\b(?:themed|slashie|costume|byo|don't forget|remember to|carry your|bring (?:cash|gear|water|your|a))\b/i;
/** Length cap on description-derived locations — real venue+address strings are well under this. */
const LOCATION_MAX_LENGTH = 100;
const LOCATION_TRUNCATE_RE = new RegExp(`\\s+(?:${LABEL_NAMES})\\s*:.*`, "i");
const LOCATION_URL_RE = /\s*https?:\/\/\S+.*/i;
/** Google Maps short/full URL pattern — used to preserve Maps links as locationUrl for geocoding. */
const MAPS_URL_RE = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.\w+\/maps)\//i;

// Pre-compiled regex for extractTimeFromDescription
const TIME_LABEL_RE = /(?:^|\n)\s*(?:Pack\s*Meet|Circle|Time|Start|When|Chalk\s*Talk)\s*:?\s*.*?(\d{1,2}:\d{2}\s*[ap]m)/im;
// 12-hour times in titles. Optional `:MM` so both "6pm" and "7:30pm" match.
// `:30` capture group is undefined for the bare form.
const TITLE_TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;

// Pre-compiled regexes for title-embedded field extraction
// Only matches "w/" abbreviation (not "with") to avoid false positives on natural language titles
const TITLE_W_HARE_LOCATION_RE = / w\/ (.+?) - (.+)$/i;
const TITLE_TRAILING_PAREN_RE = /\s*\(([^)]+)\)$/;
const INSTRUCTIONAL_PAREN_RE = /\b(?:posted|website|email|check|details|usually|info)\b/i;
/** Reject parentheticals that look descriptive rather than name-like (e.g., "(A to B)", "(No Dogs)") */
const NON_NAME_PAREN_RE = /\b(?:to|from|no|not|only|all|free|via|and back)\b/i;
const MAX_HARE_PAREN_LENGTH = 40;

// Pre-compiled regexes for dash-separated title cleanup
/** " - Hare(s): Name" or " - Hare: Name" suffix in title */
const TITLE_DASH_HARE_RE = /\s+-\s+Hares?:\s*(.+)$/i;
/** " - Location TBD/TBA/TBC" suffix — strip and optionally extract preceding hare names */
const TITLE_DASH_LOCATION_TBD_RE = /^(.+?)\s+-\s+Location\s+(?:TBD|TBA|TBC)$/i;
/** "hared by Name" suffix in title (Voodoo H3 format) */
const TITLE_HARED_BY_RE = /\s+hared by\s+(.+)$/i;
/** Detect address-like titles (street number + road type + city) */
const ADDRESS_AS_TITLE_RE = /^\d+\s+\w+.+?(?:Road|Rd|Street|St|Avenue|Ave|Drive|Dr|Boulevard|Blvd|Way|Lane|Ln|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy),/i;
/** Detect email addresses in titles (recruitment/placeholder summaries) */
const EMAIL_IN_TITLE_RE = /(?:<[^@]+@[^>]+>|\S+@\S+\.\S+)/;

/**
 * Capture the value of a `What:` line. The leading `\b` rejects mid-word
 * matches like `SoWhat:` and `WhatNot:` that would otherwise slip through
 * because the value sits on a labeled line of its own.
 */
const WHAT_FIELD_RE = /(?:^|\n)[ \t]*\bWhat\s*:[ \t]*([^\n]+)/i;

/**
 * Extract the value of a `What:` line from a calendar event description.
 * Some calendar owners use this label as the canonical event name and leave
 * the SUMMARY as the bare kennel slug. Returns the trimmed value or undefined.
 */
export function extractWhatFieldFromDescription(description: string): string | undefined {
  const match = WHAT_FIELD_RE.exec(description);
  const value = match?.[1]?.trim();
  return value || undefined;
}

/** Collapse whitespace + lowercase, used for stale-default title detection. */
// Whitespace- AND hyphen-insensitive: "Moooouston H3" matches kennelTag "moooouston-h3".
const normalizeForCompare = (s: string) => s.replaceAll(/[\s-]+/g, "").toLowerCase();

/** Whitespace + case insensitive: `"4X2 H4"` matches `"4x2h4"`. */
function titleMatchesKennelTag(title: string, kennelTag: string): boolean {
  return normalizeForCompare(title) === normalizeForCompare(kennelTag);
}

/**
 * Try description-based title sources in priority order: a labeled `What:`
 * value first (canonical for some calendars), then the generic
 * first-non-label heuristic.
 */
function titleFromDescription(rawDescription: string): string | undefined {
  return extractWhatFieldFromDescription(rawDescription)
    ?? extractTitleFromDescription(rawDescription);
}

/** Match a hareline line like "Tue 5/5: Oh Die Mark!". Day abbrev + M/D + hares. */
// [^\n]+ instead of .+ closes a SonarQube ReDoS hotspot. The lines are
// pre-split on \n so the two are semantically identical for this input.
const HARELINE_LINE_RE = /^[A-Za-z]{3}\s+(\d{1,2})\/(\d{1,2})\s*:\s*([^\n]+)$/;

/** Placeholder hare values that mean "no hare assigned yet" and should be skipped. */
const HARELINE_PLACEHOLDER_RE = /^(?:tbd|tba|needed|none|pending)$/i;

/** Unpadded `M/D` key used as the intermediate shape for parsed hareline blocks. */
function toMonthDayKey(month: string, day: string): string {
  return `${parseInt(month, 10)}/${parseInt(day, 10)}`;
}

/**
 * Parse an inline hareline block from an event description. Returns a map
 * from `"M/D"` to the hare name(s) listed for that date. Non-matching and
 * empty lines are silently skipped, and the loop runs until end-of-description
 * so accidental blank lines inside the block don't truncate parsing.
 * Placeholder values like "TBD" / "Pending" are treated as empty.
 */
export function parseInlineHareline(description: string, blockHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  const headerIdx = description.indexOf(blockHeader);
  if (headerIdx === -1) return result;
  const afterHeader = description.slice(headerIdx + blockHeader.length);
  for (const rawLine of afterHeader.split("\n")) {
    const match = HARELINE_LINE_RE.exec(rawLine.trim());
    if (!match) continue;
    const [, monthStr, dayStr, hares] = match;
    const cleanHares = hares.trim();
    if (!cleanHares || HARELINE_PLACEHOLDER_RE.test(cleanHares)) continue;
    result[toMonthDayKey(monthStr, dayStr)] = cleanHares;
  }
  return result;
}

/**
 * Extract a meaningful event title from the description when the calendar event
 * title is just the kennel abbreviation (e.g., "C2H3").
 *
 * Takes the first non-empty line that isn't a known label (Hare:, Where:, etc.)
 * and cleans it up for display.
 */
export function extractTitleFromDescription(description: string): string | undefined {
  const lines = description.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (TITLE_LABEL_RE.test(line)) continue;
    // Truncate at the first embedded label pattern (e.g., "Green Dresses!! 👗 Hare: Ant Farmer!")
    let text = line.replace(TITLE_EMBEDDED_LABEL_RE, "");
    // Clean up: strip trailing emoji clusters and excessive punctuation
    text = text
      .replace(TITLE_TRAILING_EMOJI_RE, "")
      .replace(TITLE_MULTI_EXCL_RE, "!")
      .replace(TITLE_MULTI_QUEST_RE, "?")
      .trim();
    if (text.length < 3) continue;
    if (TITLE_URL_RE.test(text)) continue;
    if (TITLE_PURE_TIME_RE.test(text)) continue;
    if (TITLE_SCHEDULE_LINE_RE.test(text)) continue;
    if (TITLE_ACRONYM_ONLY_RE.test(text)) continue;
    return text;
  }
  return undefined;
}

/**
 * Extract a location from the event description when `item.location` is missing.
 * Looks for common label patterns (WHERE:, Location:, Address:, Meet at:, etc.)
 * and returns the first match, truncated at the next label or URL.
 */
export function extractLocationFromDescription(description: string): string | undefined {
  let match = LOCATION_LABEL_RE.exec(description);
  if (!match?.[1]) match = LOCATION_BARE_LABEL_RE.exec(description);
  if (!match?.[1]) match = LOCATION_START_RE.exec(description);
  if (!match?.[1]) return undefined;

  let location = match[1].trim();
  location = location.replace(LOCATION_TRUNCATE_RE, "");
  // If the entire location value is a Maps URL, return it as-is for downstream geocoding
  const firstLine = location.split("\n")[0].trim();
  if (MAPS_URL_RE.test(firstLine)) {
    return firstLine;
  }
  location = firstLine.replace(LOCATION_URL_RE, "").trim();

  if (location.length < 3) return undefined;
  if (location.length > LOCATION_MAX_LENGTH) return undefined;
  if (isPlaceholder(location)) return undefined;
  if (isNonAddressText(location)) return undefined;
  if (LOCATION_INSTRUCTION_RE.test(location)) return undefined;
  if (LOCATION_TIME_ONLY_RE.test(location)) return undefined;

  return location;
}

/**
 * Extract a start time from the event description when `item.start.dateTime` yields no time.
 * Looks for common label patterns (Pack Meet:, Circle:, Time:, Start:, When:, Chalk Talk:)
 * and parses the first 12-hour time found.
 */
export function extractTimeFromDescription(description: string): string | undefined {
  const match = TIME_LABEL_RE.exec(description);
  if (!match?.[1]) return undefined;
  return parse12HourTime(match[1]);
}

/**
 * Extract a start time embedded in a calendar event title.
 *
 * NOH3 (and other kennels) post social events as all-day GCal entries with the
 * time embedded in the title — e.g. "Social @ JBs Fuel Dock, 6pm" or
 * "Hash Run 7:30pm". Returns 24-hour "HH:MM" or undefined.
 */
export function extractTimeFromTitle(summary: string): string | undefined {
  const match = TITLE_TIME_RE.exec(summary);
  if (!match) return undefined;
  const hour = Number.parseInt(match[1], 10);
  const min = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (hour < 1 || hour > 12 || min < 0 || min > 59) return undefined;
  return formatAmPmTime(hour, min, match[3]);
}

const COST_LABELS = new Set([
  "how much",
  "hash cash",
  "what is the cost",
  "cost",
  "price",
]);

/**
 * Extract a cost value from a calendar description. Bare integers get a `$`
 * prefix to match the HashRego/OFH3 normalized format; values that already
 * carry a currency symbol, unit, or word ("Free") pass through verbatim.
 */
export function extractCostFromDescription(description: string): string | undefined {
  for (const line of description.split("\n")) {
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) continue;
    const label = trimmed.slice(0, colonIdx).toLowerCase().replace(/\s+/g, " ").trim();
    if (!COST_LABELS.has(label)) continue;
    let value = trimmed.slice(colonIdx + 1).trim();
    value = value.replace(EVENT_FIELD_LABEL_RE, "").replace(EVENT_FIELD_LABEL_UPPERCASE_RE, "").trim();
    if (!value || isPlaceholder(value)) return undefined;
    if (/^\d+(?:\.\d{1,2})?$/.test(value)) return `$${value}`;
    return value;
  }
  return undefined;
}

const mapsUrl = googleMapsSearchUrl;

/** Instruction phrases that indicate a GCal location field contains directions, not an address. */
const NON_ADDRESS_RE = /^(?:use the|check the|see the|see description|click|follow the|refer to|details in|when:|why:|hare:|what:|who:|cost:)/i;
/** Suffix phrase indicating the field is a placeholder like "DST start location". */
const NON_ADDRESS_SUFFIX_RE = /\bstart\s+location\s*$/i;

/** Returns true if text starts with instruction phrasing rather than an address. */
function isNonAddressText(text: string): boolean {
  const t = text.trim();
  return NON_ADDRESS_RE.test(t) || NON_ADDRESS_SUFFIX_RE.test(t);
}

/** Config shape for Google Calendar sources */
interface CalendarSourceConfig {
  /**
   * Per-event kennel routing. Each entry is `[regex, kennelTag | kennelTag[]]`.
   * Single-tag (string) entries preserve legacy first-match-wins behavior.
   * Array entries declare a true multi-kennel co-host (#1023 step 4); see
   * `src/adapters/kennel-patterns.ts` for the full precedence rules.
   */
  kennelPatterns?: KennelPattern[];
  defaultKennelTag?: string;            // fallback for unrecognized events
  /**
   * When true on a multi-kennel calendar (one with `kennelPatterns`), a summary
   * that matches NO pattern is dropped rather than routed to `defaultKennelTag`
   * / boston fallback. Prevents cross-kennel noise (e.g. non-hash "Lexi's
   * surgery" posts on WA Hash) from being ingested under an arbitrary kennel.
   * See issue #753.
   *
   * No-op without `kennelPatterns` — single-kennel calendars use
   * `defaultKennelTag` directly and never enter the pattern-matching branch.
   */
  strictKennelRouting?: boolean;
  skipPatterns?: string[];              // regex strings — skip events whose summary matches
  harePatterns?: string[];              // regex strings to extract hares from descriptions
  runNumberPatterns?: string[];         // regex strings to extract run numbers from descriptions
  /** Regex(es) to extract hare names from summary when description has none.
   *  Accepts a single pattern string or an array tried in order — first
   *  capture-group hit wins (#1208 DST + Stuttgart SH3 share a source;
   *  #1209/#1221 CH3 + RDH3 share a source). */
  titleHarePattern?: string | string[];
  /** Regex(es) to extract a location from the summary when item.location is
   *  empty or a placeholder. Tried after titleHarePattern; first capture-group
   *  hit wins. The matched span is stripped from the title. Candidates that
   *  trip `isPlaceholder()` (e.g. "venue TBC") are rejected (#1222). */
  titleLocationPattern?: string | string[];
  /**
   * Regex strings applied as `title.replace(re, "")` in sequence after hare
   * extraction and before the `defaultTitle` fallback. Compiled with `i`
   * (matches the rest of the adapter's pattern fields). Used for kennels
   * that wrap titles in fixed delimiters that aren't real title content
   * (#1189 Eugene H3: leading "🌲" and trailing "🍺 6:69 pm- Location TBD").
   */
  titleStripPatterns?: string[];
  descriptionSuffix?: string;           // appended to every event description
  includeAllDayEvents?: boolean;        // if true, don't skip all-day events (some calendars use them for real runs)
  defaultStartTime?: string;            // "HH:MM" fallback when neither the calendar item nor the description yields a start time (paired with includeAllDayEvents)
  /**
   * Per-source override for the future-window cap on `timeMax`. Default 180.
   * Increase for calendars that schedule legit non-RRULE events more than 6
   * months out (annual campouts). Don't increase blindly on RRULE-heavy
   * aggregator calendars — that's how #939 happened.
   */
  futureHorizonDays?: number;
  defaultTitle?: string;                // human-readable fallback title when event summary is just a kennel slug
  defaultTitles?: Record<string, string>; // per-kennelTag fallback titles (aggregator calendars)
  /** #1060: per-kennel list of "stale" alias strings whose presence as the
   *  full title should trigger the `defaultTitles` fallback. Useful when a
   *  kennel's calendar SUMMARY is a placeholder name that doesn't normalize
   *  to the canonical kennel tag (e.g. "Space City Hash" vs "space-city-h3"
   *  — the kennel pattern recognizes both but `titleMatchesKennelTag` only
   *  compares the normalized tag, so without an explicit list the fallback
   *  doesn't fire). Compared case-insensitively against the stripped title. */
  staleTitleAliases?: Record<string, readonly string[]>;
  // Some calendars only populate the soonest-upcoming event's description, which
  // carries an inline schedule listing future dates and hares. After the scrape
  // finishes, back-fill `hares` on other events for the same kennelTag by
  // matching on M/D. Non-destructive: never overwrites existing hares.
  inlineHarelinePattern?: {
    kennelTag: string;       // which kennel's events to back-fill
    blockHeader: string;     // e.g. "4x2 H4 Hareline:"
  };
}

/**
 * Match event summary against kennel patterns. Prefers pre-compiled patterns
 * (the hot path during a scrape) and falls back to compile-per-call for
 * direct test invocations. Always returns an array; see
 * `src/adapters/kennel-patterns.ts` for precedence rules.
 */
function matchConfigPatterns(
  summary: string,
  patterns: KennelPattern[],
  compiled?: CompiledKennelPattern[],
): string[] {
  if (compiled) return matchCompiledKennelPatterns(summary, compiled);
  return matchKennelPatterns(summary, patterns);
}

/** Subset of the Google Calendar API v3 event shape */
interface GCalEvent {
  /** Stable per-instance event id; same id appears in `singleEvents=true` and `singleEvents=false` responses. */
  id?: string;
  /** iCalendar UID — stable across cross-calendar copies; shared by master + all RECURRENCE-ID overrides. */
  iCalUID?: string;
  /**
   * Set on materialized RRULE instances and on RECURRENCE-ID override exceptions.
   * Points to the master event's id. Combined with `originalStartTime`, signals
   * "this item is an exception" — see issue #1021.
   */
  recurringEventId?: string;
  /**
   * The original recurrence-slot start time (RECURRENCE-ID equivalent). Present
   * on materialized instances and overrides; absent on standalone events. The
   * adapter only reads its presence, not its value — `start` is always used for
   * the user-visible event time.
   */
  originalStartTime?: { dateTime?: string; date?: string; timeZone?: string };
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
  status?: string;
  organizer?: { email?: string; displayName?: string };
  creator?: { email?: string };
}

interface GCalListResponse {
  items?: GCalEvent[];
  nextPageToken?: string;
  error?: { code: number; message: string };
}

/** Extract local date and time from a Google Calendar start object. */
function extractDateTimeFromGCalItem(start: { dateTime?: string; date?: string }): { dateISO: string; startTime: string | undefined } {
  if (start.dateTime) {
    const dtMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(
      start.dateTime,
    );
    if (dtMatch) {
      return { dateISO: dtMatch[1], startTime: `${dtMatch[2]}:${dtMatch[3]}` };
    }
    // Fallback: extract date portion directly from the string (avoids UTC date shift)
    const fallbackMatch = /(\d{4}-\d{2}-\d{2})/.exec(start.dateTime);
    if (fallbackMatch) {
      return { dateISO: fallbackMatch[0], startTime: undefined };
    }
    return { dateISO: "", startTime: undefined };
  }
  // All-day event: start.date is already YYYY-MM-DD
  return { dateISO: start.date ?? "", startTime: undefined };
}

/** Strip HTML from description, preserving newlines, and truncate. */
export function normalizeGCalDescription(rawDesc: string | undefined): { rawDescription: string | undefined; description: string | undefined } {
  if (!rawDesc) return { rawDescription: undefined, description: undefined };
  let rawDescription = stripHtmlTags(decodeEntities(rawDesc), "\n");
  // Strip mailto: link artifacts: "text (mailto:email)" → "text"
  rawDescription = rawDescription.replace(/\s*\(mailto:[^)]+\)/g, "");
  // Strip Harrier Central auto-generated header from GCal-synced events:
  // "{KennelName}\nLocation: {venue}\nDescription: {actual text}" → "{actual text}"
  rawDescription = rawDescription.replace(/^[^\n]*\nLocation:[^\n]*\nDescription:\s*/i, "");
  const description = rawDescription
    ? rawDescription.replace(/[ \t]+/g, " ").trim().substring(0, 2000) || undefined
    : undefined;
  return { rawDescription, description };
}

/**
 * Resolve kennel tag from event summary using config patterns.
 * Returns null when `strictKennelRouting` is enabled and no pattern matches —
 * caller should drop the event (see issue #753).
 * When no pattern matches and no default is set, returns the summary as kennelTag
 * so the merge pipeline records distinct UNMATCHED_TAG samples per unique title
 * (empty strings would collapse every unmatched event into a single alert).
 */
function resolveKennelTagFromSummary(
  summary: string,
  sourceConfig: CalendarSourceConfig | null,
  compiledKennelPatterns?: CompiledKennelPattern[],
): { kennelTags: string[]; useFullTitle: boolean } | null {
  if (sourceConfig?.kennelPatterns) {
    const matched = matchConfigPatterns(summary, sourceConfig.kennelPatterns, compiledKennelPatterns);
    if (matched.length > 0) return { kennelTags: matched, useFullTitle: true };
    if (sourceConfig.strictKennelRouting) return null;
    return { kennelTags: [sourceConfig.defaultKennelTag ?? summary], useFullTitle: true };
  }
  if (sourceConfig?.defaultKennelTag) {
    return { kennelTags: [sourceConfig.defaultKennelTag], useFullTitle: true };
  }
  return { kennelTags: [summary], useFullTitle: true };
}

/** Parse source.config into CalendarSourceConfig or null. */
function parseCalendarSourceConfig(config: unknown): CalendarSourceConfig | null {
  return (config && typeof config === "object" && !Array.isArray(config))
    ? config as CalendarSourceConfig
    : null;
}

/** Optional pre-compiled patterns + tracking map plumbed through the
 *  fetch loop. Bundled into one options object to keep
 *  buildRawEventFromGCalItem within the function-arity limit. Direct
 *  test invocations can omit this entirely. */
export interface BuildRawEventFromGCalItemOptions {
  compiledHarePatterns?: RegExp[];
  compiledRunNumberPatterns?: RegExp[];
  compiledSkipPatterns?: RegExp[];
  compiledTitleHarePatterns?: RegExp[];
  compiledTitleLocationPatterns?: RegExp[];
  compiledTitleStripPatterns?: RegExp[];
  /** Pre-compiled kennelPatterns. Production fetch path passes this so
   *  we don't re-compile every event; tests can omit. */
  compiledKennelPatterns?: CompiledKennelPattern[];
  /** id-tracking map; the adapter populates this so the cross-call
   *  dedup at the end of `fetch` can use stable GCal ids without
   *  changing the public RawEventData shape. */
  gcalIdMap?: WeakMap<RawEventData, string>;
  /** Set of RawEventData built from all-day GCal items. Used by
   *  `dedupGCalEvents` to drop placeholder all-day rows when a timed
   *  sibling exists for the same `(kennelTag, date)` (#1199 Giggity). */
  allDayEventSet?: WeakSet<RawEventData>;
}

/** Build a RawEventData from a single Google Calendar event item. Returns null if the item should be skipped. */
export function buildRawEventFromGCalItem(
  item: GCalEvent,
  sourceConfig: CalendarSourceConfig | null,
  options: BuildRawEventFromGCalItemOptions = {},
): RawEventData | null {
  const {
    compiledHarePatterns,
    compiledRunNumberPatterns,
    compiledSkipPatterns,
    compiledTitleHarePatterns,
    compiledTitleLocationPatterns,
    compiledTitleStripPatterns,
    compiledKennelPatterns,
    gcalIdMap,
    allDayEventSet,
  } = options;
  if (item.status === "cancelled") return null;
  if (!item.summary) return null;
  if (!item.start?.dateTime && !item.start?.date) return null;
  // Skip all-day events unless config opts in (some calendars use all-day for real runs).
  // Sources with all-day overrides (e.g. CUNTh on WA Hash) must set
  // `includeAllDayEvents: true` to admit them — including those recovered via the
  // secondary singleEvents=false call. We deliberately don't carve out
  // `recurringEventId` here: that field is also set on materialized RRULE instances,
  // so a carve-out would silently ingest unwanted all-day recurring instances on
  // sources that never opted in.
  const isAllDay = !!(item.start?.date && !item.start?.dateTime);
  if (isAllDay && !sourceConfig?.includeAllDayEvents) return null;

  const { dateISO, startTime } = extractDateTimeFromGCalItem(item.start);
  if (!dateISO) return null;
  const endParts = item.end ? extractDateTimeFromGCalItem(item.end) : undefined;
  const summary = decodeEntities(item.summary);

  // Skip events whose summary matches any configured skip pattern (e.g., cross-kennel posts)
  if (compiledSkipPatterns?.length) {
    for (const re of compiledSkipPatterns) {
      if (re.test(summary)) return null;
    }
  }
  // Skip placeholder recruitment events whose title is a CTA ("Hares needed",
  // "Hare wanted", etc.) — never real trails. Mirrors the `title-cta-text`
  // audit rule so placeholders never reach ingestion.
  for (const re of CTA_EMBEDDED_PATTERNS) {
    if (re.test(summary)) return null;
  }
  // Skip events from Google's imported holiday calendars (organizer.email has
  // the form `…holiday…@group.v.calendar.google.com`).
  const organizerEmail = item.organizer?.email ?? item.creator?.email;
  if (organizerEmail && /holiday.*@group\.v\.calendar\.google\.com$/i.test(organizerEmail)) {
    return null;
  }
  const { rawDescription, description } = normalizeGCalDescription(item.description);
  let hares = rawDescription ? extractHares(rawDescription, compiledHarePatterns) : undefined;
  // Fall back to extracting hares from title when description has none. Try
  // each pattern in order; first capture-group hit wins. Track which pattern
  // matched so the downstream title-cleanup block uses the same regex span.
  let haresFromTitle = false;
  let matchedTitleHarePattern: RegExp | undefined;
  if (!hares && compiledTitleHarePatterns?.length) {
    for (const re of compiledTitleHarePatterns) {
      const titleMatch = re.exec(summary);
      if (titleMatch?.[1]) {
        // #1210: lazy `^(.+?)\s+AH3\s+#` leaves a trailing " -" on titles like
        // "Alice and Bob - AH3 #2351". Anchored char-class strip is SonarCloud
        // safe (≤20 complexity, no nesting).
        const cleaned = titleMatch[1]
          .trim()
          .replace(/^\s*[-–—:]+\s*|\s*[-–—:]+\s*$/g, "") // NOSONAR — anchored char-class alternation
          .trim();
        if (cleaned) {
          hares = cleaned;
          haresFromTitle = true;
          matchedTitleHarePattern = re;
          break;
        }
      }
    }
  }
  const resolved = resolveKennelTagFromSummary(summary, sourceConfig, compiledKennelPatterns);
  if (!resolved) return null;
  const { kennelTags, useFullTitle } = resolved;
  // The first resolved tag is the primary kennel for routing/title fallback
  // logic below. Co-host secondaries (#1023) ride along in `kennelTags` and
  // are written to EventKennel rows by the merge pipeline.
  const kennelTag = kennelTags[0];
  // Location: prefer item.location (unless placeholder or instruction text), fall back to description extraction.
  // #743: strip trailing phone numbers and contact-CTA parentheticals from the
  // raw GCal location field. Trailing only — a bare "1 800 ..." in the middle
  // of a street fragment would otherwise be shredded.
  let location = item.location ? stripNonEnglishCountry(decodeEntities(item.location).trim()) : undefined;
  let latitude: number | undefined;
  let longitude: number | undefined;
  // When `item.location` is a coord-only string (decimal or DMS), parse it
  // into structured lat/lng. Stash the verbatim coord string and clear
  // `location` so the description-fallback branch can surface a real address
  // if the kennel typed one (#779 BMPH3 Rue de la Gare). If the description
  // doesn't yield anything, the coord string is restored at the bottom of
  // the location pipeline so the source signal survives (#1195 GAL).
  let coordOnlyDisplay: string | undefined;
  if (location) {
    const coords = parseCoordOnlyLocation(location);
    if (coords) {
      latitude = coords.lat;
      longitude = coords.lng;
      coordOnlyDisplay = location;
      location = undefined;
    }
  }
  // Skip phone/CTA strip when the field is a bare URL — Maps place IDs end in digit runs
  // that PHONE_TRAILING_RE would mangle.
  if (location && !/^https?:\/\//i.test(location)) {
    location = location
      .replace(LOCATION_TRAILING_CTA_RE, "")
      .replace(PHONE_TRAILING_RE, "")
      .trim() || undefined;
  }
  // #798: drop email-CTA-as-location values outright — no address to preserve.
  if (location && (LOCATION_EMAIL_CTA_RE.test(location) || LOCATION_BARE_EMAIL_RE.test(location))) {
    location = undefined;
  }
  if (location && (isPlaceholder(location) || isNonAddressText(location))) location = undefined;
  if (!location && rawDescription) {
    location = extractLocationFromDescription(rawDescription);
  }
  // Restore the verbatim coord string when description didn't provide a
  // better address. The source explicitly chose "no street name" so we'd
  // rather show the coords than the kennel-default fallback (#1195 GAL).
  if (!location && coordOnlyDisplay) location = coordOnlyDisplay;

  // Determine title: if title matches kennel tag, try description fallback
  let title = useFullTitle ? summary : extractTitle(summary);
  title = stripDatePrefix(title);
  // Strip a trailing dash/delimiter (#756 "Moooouston H3 Trail -" /
  // #1060 "Space City Hash:"). The subsequent defaultTitle path replaces
  // an empty string with a configured fallback; without this strip the
  // title shipped to users as "… -" / "… :".
  title = title.replace(/\s*[-–—:]\s*$/, "").trim(); // NOSONAR — anchored end-of-string strip, no nested quantifiers
  // Stale-default detection: equality is whitespace-insensitive so a SUMMARY
  // of "4X2 H4" still matches kennelTag "4x2h4".
  if (titleMatchesKennelTag(title, kennelTag) && rawDescription) {
    title = titleFromDescription(rawDescription) ?? title;
  }
  // If title looks like a bare kennel code (2-10 alphanumeric chars, no spaces),
  // try extracting a better title from the description
  if (/^[A-Za-z0-9]{2,10}$/.test(title) && rawDescription) {
    const descTitle = titleFromDescription(rawDescription);
    if (descTitle) title = descTitle;
  }
  // Strip the hare-name capture group from the title, preserving the rest.
  // Handles both prefix patterns (hares at start: "Hare1 & Hare2 - AH3 #2269")
  // and suffix patterns (hares at end: "AH3 #1833 - Location - Hare Name").
  // The prior code assumed prefix-only and did title.slice(captureGroup.length),
  // which mangled titles when the capture group was at the end.
  if (haresFromTitle && matchedTitleHarePattern) {
    const titleMatch = matchedTitleHarePattern.exec(title);
    if (titleMatch && titleMatch[1]) {
      const hareText = titleMatch[1];
      const start = titleMatch.index;
      const end = start + titleMatch[0].length;
      // Position-based classification. Content-based (startsWith/endsWith)
      // misfires when the hare name coincidentally equals the title's
      // leading/trailing substring — e.g. hareText="AH3" in
      // "AH3 #880 Hare: AH3".
      const spansEntireTitle = start === 0 && end === title.length;
      const captureStart = start + titleMatch[0].lastIndexOf(hareText);
      let cleaned: string;
      if (spansEntireTitle) {
        // Regex anchors entire title (Aloha `^AH3\s*#\d+.*-\s+(.+)$`):
        // strip only the capture group so the non-hare prefix survives.
        cleaned = title
          .slice(0, captureStart)
          .replace(/\s*[-–—]\s*$/, "")
          .trim();
      } else if (start === 0 && captureStart === 0) {
        // Pure prefix capture (e.g. "Alice AH3 #2269"): strip the hare
        // text from the start, preserve the match's trailing delimiter.
        cleaned = title.slice(hareText.length).trimStart();
      } else {
        // Mid- or partial-suffix match: strip the full regex span (label
        // + name) and collapse leftover delimiters. Handles Stuttgart
        // "SH3 #880 Hare: Kiss Me- Degerloch" → "SH3 #880 - Degerloch".
        cleaned = (title.slice(0, start) + title.slice(end))
          .replaceAll(/\s*[-–—]\s*[-–—]\s*/g, " - ")
          .replaceAll(/\s{2,}/g, " ")
          .replaceAll(/^\s*[-–—]\s*|\s*[-–—]\s*$/g, "")
          .trim();
      }
      if (cleaned) title = cleaned;
    }
  }

  // Title-embedded location extraction (#1222 Capital H3): the source has no
  // separate item.location and packs the address into the title after the
  // hare names. Try each pattern in order; first capture-group hit wins.
  // Reject placeholders like "venue TBC" via isPlaceholder().
  if (!location && compiledTitleLocationPatterns?.length) {
    for (const re of compiledTitleLocationPatterns) {
      const locMatch = re.exec(title);
      if (locMatch?.[1]) {
        const candidate = locMatch[1].trim().replace(/[.,;:\s]+$/, "").trim(); // NOSONAR — anchored end-of-string char-class
        if (candidate && !isPlaceholder(candidate)) {
          location = candidate;
          title = (title.slice(0, locMatch.index) + title.slice(locMatch.index + locMatch[0].length))
            .replaceAll(/^\s*[-–—:]+\s*|\s*[-–—:]+\s*$/g, "") // NOSONAR — anchored char-class alternation, mirrors title-hare strip
            .trim();
          break;
        }
      }
    }
  }

  // --- Title-embedded field extraction (hares, location) ---

  // Pattern: "Title w/ Hare1 & Hare2 - Location" (common in DC/EWH3 events).
  // The entire w/ suffix is always stripped from the title when matched, even if
  // only one of hares/location is missing — the suffix is not a meaningful title part.
  if (!hares || !location) {
    const wMatch = TITLE_W_HARE_LOCATION_RE.exec(title);
    if (wMatch) {
      const wHares = wMatch[1].trim();
      const wLocation = wMatch[2].trim();
      if (!hares && !isPlaceholder(wHares)) hares = wHares;
      if (!location && !isPlaceholder(wLocation)) location = wLocation;
      title = title.slice(0, wMatch.index).trim();
    }
  }

  // #799 Pedal Files: trailing "- tbd" / "- tba" placeholder after a delimiter
  // ("Bash - tbd" → "Bash"). Runs *after* w/ extraction so we don't consume the
  // " - TBA" tail of "Title w/ TBD - TBA" before the pattern can strip it.
  title = title.replace(/\s*[-–—]\s*(?:tbd|tba|tbc)\.?\s*$/i, "").trim();

  // Trailing "(Hare Name)" parenthetical (common in Boston/many kennels).
  // When hares are already set from description, the parenthetical is left in the title
  // since it may be a subtitle rather than a hare name.
  const parenMatch = TITLE_TRAILING_PAREN_RE.exec(title);
  if (parenMatch) {
    const inner = parenMatch[1].trim();
    const isInstructional = inner.length > MAX_HARE_PAREN_LENGTH || INSTRUCTIONAL_PAREN_RE.test(inner);
    const isNameLike = !NON_NAME_PAREN_RE.test(inner);
    if (!isInstructional && isNameLike && !hares) {
      hares = inner;
      title = title.slice(0, parenMatch.index).trim();
    } else if (isInstructional) {
      title = title.slice(0, parenMatch.index).trim();
    }
  }

  // Dash-separated hare suffix: "Title - Hare(s): Name" (H5, OCHHH)
  const dashHareMatch = TITLE_DASH_HARE_RE.exec(title);
  if (dashHareMatch) {
    if (!hares) hares = dashHareMatch[1].trim();
    title = title.slice(0, dashHareMatch.index).trim();
  }

  // "hared by Name" suffix: "Voodoo Trail #1032 hared by The Iceman" (Voodoo H3)
  const haredByMatch = TITLE_HARED_BY_RE.exec(title);
  if (haredByMatch) {
    if (!hares) hares = haredByMatch[1].trim();
    title = title.slice(0, haredByMatch.index).trim();
  }

  // " - Location TBD" suffix: "<title> - Location TBD" (EWH3 placeholder events).
  // The prefix is the trail title — never assume it's a hare name. Without an
  // explicit hare delimiter (`w/`, `Hare:`, `hared by`) we have no reliable
  // signal that the prefix names the hares. #1127: EWH3's "Autism Speaks for
  // Deities & Friends! - Location TBD" was wrongly being routed to `hares`
  // and the title replaced with the configured `defaultTitle`.
  const locTbdMatch = TITLE_DASH_LOCATION_TBD_RE.exec(title);
  if (locTbdMatch) {
    title = locTbdMatch[1].trim();
  }

  // Strip " - LocationName" from title when location was already extracted
  if (location && title.toLowerCase().endsWith(` - ${location.toLowerCase()}`)) {
    title = title.slice(0, -(` - ${location}`).length).trim();
  }
  // #815 GyNO: the endsWith strip above only fires on exact-location suffixes;
  // a normalized-variant location can leave a bare trailing delimiter behind.
  title = title.replace(/\s*[-–—]\s*$/, "").trim();

  // Address-as-title: move to location, use kennel tag as title
  if (ADDRESS_AS_TITLE_RE.test(title)) {
    if (!location) location = title;
    title = kennelTag;
  }

  // Email-as-title: placeholder/recruitment summary — use kennel tag
  if (EMAIL_IN_TITLE_RE.test(title)) {
    title = kennelTag;
  }

  // Per-source title strips (#1189): kennels that wrap titles in fixed
  // delimiters that aren't part of the actual title content. Eugene H3 uses
  // 🌲 as a leading marker and 🍺 to separate title from a time/location
  // tail. Runs after hare extraction so emoji delimiters are still present
  // when titleHarePattern executes.
  if (compiledTitleStripPatterns?.length) {
    for (const re of compiledTitleStripPatterns) {
      title = title.replace(re, "").trim();
    }
  }

  // defaultTitle fallback runs last, after all branches that may reset title to kennelTag.
  // Also fires when title collapsed to empty after trailing-dash strip (#756).
  const fallback = sourceConfig?.defaultTitles?.[kennelTag] ?? sourceConfig?.defaultTitle;
  if (fallback) {
    // #796 #800: titles like "wasatch #1144" or "DH3 #1663" are raw kennel-code
    // + run-number pairs, not real event names. Substitute the configured
    // default and preserve the run number so users see a readable trail name.
    // Guard: require the prefix to match either the resolved kennelTag or one
    // of the configured kennelPatterns — otherwise legit titles like
    // "Picnic 2026" get rewritten to "{defaultTitle} #2026".
    const bareKennelRunMatch = /^([A-Za-z][A-Za-z0-9-]{0,19})\s*#?\s*(\d+)$/.exec(title);
    const prefix = bareKennelRunMatch?.[1];
    const prefixMatchesKennel = !!prefix && (
      titleMatchesKennelTag(prefix, kennelTag)
      || (sourceConfig?.kennelPatterns
        ? matchConfigPatterns(prefix, sourceConfig.kennelPatterns, compiledKennelPatterns).includes(kennelTag)
        : false)
    );
    // #1060: an explicit alias list lets a kennel opt in to fallback for
    // multi-word placeholder titles like "Space City Hash" that wouldn't
    // normalize to the kennel tag. Substring matching against kennelPatterns
    // would over-fire on legit titles like "April Hash" (#796), so the alias
    // list is opt-in per kennel rather than auto-derived. Validate array +
    // string element types in case a malformed config slips past validation.
    const aliases = sourceConfig?.staleTitleAliases?.[kennelTag];
    const normalizedTitle = title.trim().toLowerCase();
    const titleMatchesAlias = !!title && Array.isArray(aliases) && aliases.some(
      (a) => typeof a === "string" && a.trim().toLowerCase() === normalizedTitle,
    );
    if (bareKennelRunMatch && prefixMatchesKennel) {
      title = `${fallback} #${bareKennelRunMatch[2]}`;
    } else if (!title || titleMatchesKennelTag(title, kennelTag) || titleMatchesAlias) {
      title = fallback;
    }
  }

  // Start time: prefer dateTime-derived time, then description extraction,
  // then a configured default. The default is the only path that fires for
  // all-day calendar entries whose description doesn't carry a recognizable
  // time label (e.g. ABQ H3's Tuesday CLiT trails), and keeps them from
  // rendering as all-day/noon events downstream. Format-guard the default
  // so a config typo can't silently inject a bad startTime string.
  let resolvedStartTime = startTime;
  // Title-embedded time wins over description because authors who put a time
  // in the title (NOH3 "Social @ ..., 6pm") almost always mean it as the
  // start time. Only fires for events that didn't have start.dateTime
  // (i.e. all-day entries).
  if (!resolvedStartTime) {
    resolvedStartTime = extractTimeFromTitle(summary);
  }
  if (!resolvedStartTime && rawDescription) {
    resolvedStartTime = extractTimeFromDescription(rawDescription);
  }
  if (!resolvedStartTime && sourceConfig?.defaultStartTime && VALID_HHMM_RE.test(sourceConfig.defaultStartTime)) {
    resolvedStartTime = sourceConfig.defaultStartTime;
  }

  // Any URL as location (Maps or otherwise) gets routed to locationUrl for geocoding,
  // not stored as display location. resolveCoords handles URL → address resolution.
  const locationIsUrl = location && /^https?:\/\//i.test(location);
  const cost = rawDescription ? extractCostFromDescription(rawDescription) : undefined;
  const runNumber = extractRunNumber(summary, rawDescription, compiledRunNumberPatterns);

  // #1271 — drop personal-calendar drift only when no structured signal.
  // `runNumber !== undefined` covers both clean numbers and placeholder
  // markers (kennel admin's intent was a hash run, even if number is TBD).
  const hasStructuredField = !!(
    runNumber !== undefined ||
    hares ||
    location ||
    description?.trim()
  );
  if (!hasStructuredField && PERSONAL_TITLE_PATTERNS.some((re) => re.test(summary))) {
    return null;
  }

  const event: RawEventData = {
    date: dateISO,
    // Pass the full multi-kennel set (#1023): for single-tag patterns this
    // is `[primary]`; for array patterns it's the union of all matched kennels.
    kennelTags,
    runNumber,
    title,
    description: appendDescriptionSuffix(description, sourceConfig?.descriptionSuffix),
    hares,
    location: locationIsUrl ? undefined : location,
    locationUrl: location ? (locationIsUrl ? location : mapsUrl(location)) : undefined,
    latitude,
    longitude,
    startTime: resolvedStartTime,
    // endTime is HH:MM only, so cross-date end timestamps (overnight runs) are dropped.
    endTime: endParts && endParts.dateISO === dateISO ? endParts.startTime : undefined,
    cost,
    sourceUrl: item.htmlLink,
  };
  if (gcalIdMap && item.id) gcalIdMap.set(event, item.id);
  if (allDayEventSet && isAllDay) allDayEventSet.add(event);
  return event;
}

/** Build diagnostic context for a parse error on a GCal item. */
function buildGCalDiagnosticContext(item: GCalEvent): string {
  const rawParts = [`Summary: ${item.summary ?? "unknown"}`];
  if (item.description) rawParts.push(`Description: ${item.description}`);
  if (item.location) rawParts.push(`Location: ${item.location}`);
  if (item.start) rawParts.push(`Start: ${item.start.dateTime ?? item.start.date ?? ""}`);
  return rawParts.join("\n").slice(0, 2000);
}

/** Compile every regex-string config field once per scrape so the per-event
 * build path doesn't re-compile. Returns an object with every compiled
 * pattern needed by `buildRawEventFromGCalItem` (or `undefined` when the
 * config didn't supply one).
 */
function compileMaybeArray(p: string | string[] | undefined, flags?: string): RegExp[] | undefined {
  if (!p) return undefined;
  return compilePatterns(Array.isArray(p) ? p : [p], flags);
}

function compileSourceConfigPatterns(sourceConfig: CalendarSourceConfig | null) {
  return {
    compiledHarePatterns: sourceConfig?.harePatterns?.length
      ? compilePatterns(sourceConfig.harePatterns)
      : undefined,
    compiledRunNumberPatterns: sourceConfig?.runNumberPatterns?.length
      ? compilePatterns(sourceConfig.runNumberPatterns)
      : undefined,
    compiledSkipPatterns: sourceConfig?.skipPatterns?.length
      ? compilePatterns(sourceConfig.skipPatterns, "i")
      : undefined,
    compiledTitleHarePatterns: compileMaybeArray(sourceConfig?.titleHarePattern, "i"),
    compiledTitleLocationPatterns: compileMaybeArray(sourceConfig?.titleLocationPattern, "i"),
    compiledTitleStripPatterns: sourceConfig?.titleStripPatterns?.length
      ? compilePatterns(sourceConfig.titleStripPatterns, "i")
      : undefined,
    compiledKennelPatterns: sourceConfig?.kennelPatterns?.length
      ? compileKennelPatterns(sourceConfig.kennelPatterns)
      : undefined,
  };
}

/**
 * Two-pass dedup for fetched events:
 *   1. id-first — GCal returns a stable per-instance id; collapse exact-id
 *      duplicates from the primary + secondary calls. Legacy composite-key
 *      fallback covers synthetic test fixtures without ids.
 *   2. composite-key (kennel|date|startTime|title) — catches parallel RRULE
 *      series that share key but differ in id (#1101 CFMH3). On collision
 *      the survivor inherits non-empty fields from the donor before drop.
 */
/** A placeholder all-day shell looks like "Giggity H3 #? (TBD)" — no real
 *  run number, no real hares/location, and a title containing `#?` or a
 *  TBD/TBA/TBC marker. Real all-day entries (campouts, away weekends) will
 *  have a populated title or numeric run number and must NOT be collapsed
 *  when a timed sibling exists on the same date. `runNumber === null` is an
 *  explicit placeholder-marker emission (#1272/#1274/#1275) and counts as
 *  evidence of a shell, not as a real number. */
function isPlaceholderShell(e: RawEventData): boolean {
  if (typeof e.runNumber === "number" && e.runNumber > 0) return false;
  const title = (e.title ?? "").trim();
  if (!title) return true;
  if (/#\s*\?/.test(title)) return true;
  if (/\b(?:TBD|TBA|TBC)\b/i.test(title)) return true;
  if (e.hares && isPlaceholder(e.hares)) return true;
  return false;
}

export function dedupGCalEvents(
  events: RawEventData[],
  gcalIdMap: WeakMap<RawEventData, string>,
  allDayEventSet: WeakSet<RawEventData>,
): { events: RawEventData[]; compositeDedupedCount: number; allDayCollapsedCount: number } {
  // #1199 pre-pass: drop placeholder all-day events when a timed sibling
  // exists for the same `(kennelTag, date)`. Sources with
  // `includeAllDayEvents: true` (WA Hash for CUNTh) admit both placeholder
  // shells like "Giggity H3 #? (TBD)" and real timed runs; the merge
  // pipeline collapses them into one canonical event by `(kennelId, date)`,
  // so whichever survives this dedup wins. Prefer the timed one — but ONLY
  // when the all-day event LOOKS like a placeholder. A real all-day event
  // (campout, away weekend, RDR) sharing the date with a timed trail must
  // survive so the merge pipeline can keep both via signature-based
  // multi-event handling. Placeholder evidence: missing run number AND
  // (title contains `#?`, "TBD"/"TBA"/"TBC" placeholder marker, or
  // hares/location are placeholder strings).
  const timedKeys = new Set<string>();
  for (const e of events) {
    if (!allDayEventSet.has(e)) timedKeys.add(`${e.kennelTags[0]}|${e.date}`);
  }
  let allDayCollapsedCount = 0;
  const timedFiltered = events.filter(e => {
    if (
      allDayEventSet.has(e)
      && timedKeys.has(`${e.kennelTags[0]}|${e.date}`)
      && isPlaceholderShell(e)
    ) {
      allDayCollapsedCount++;
      return false;
    }
    return true;
  });

  const seen = new Set<string>();
  const idDeduped = timedFiltered.filter(e => {
    const id = gcalIdMap.get(e);
    const key = id
      ? `id:${id}`
      : `legacy:${e.date}|${e.kennelTags[0]}|${e.startTime ?? ""}|${e.title ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const compositeMap = new Map<string, RawEventData>();
  for (const e of idDeduped) {
    const key = `${e.kennelTags[0]}|${e.date}|${e.startTime ?? ""}|${e.title ?? ""}`;
    const existing = compositeMap.get(key);
    if (existing) mergeRawEventInPlace(existing, e);
    else compositeMap.set(key, e);
  }
  const compositeDedupedCount = idDeduped.length - compositeMap.size;
  // Skip the rebuild when nothing collapsed — saves an O(n) array copy on
  // the typical scrape where parallel-series duplicates don't exist.
  const result = compositeDedupedCount === 0 ? idDeduped : [...compositeMap.values()];
  return { events: result, compositeDedupedCount, allDayCollapsedCount };
}

/** Google Calendar API v3 adapter. Fetches events from a public calendar and extracts kennel tags via configurable patterns. */
export class GoogleCalendarAdapter implements SourceAdapter {
  type = "GOOGLE_CALENDAR" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const days = options?.days ?? 90;
    const calendarId = encodeURIComponent(source.url);
    const apiKey = process.env.GOOGLE_CALENDAR_API_KEY;

    if (!apiKey) {
      throw new Error("GOOGLE_CALENDAR_API_KEY environment variable is not set");
    }

    const sourceConfig = parseCalendarSourceConfig(source.config);
    const now = new Date();
    // Guard against malformed config: a non-numeric futureHorizonDays would
    // produce NaN and crash `new Date()` with RangeError, aborting the scrape.
    const rawHorizon = sourceConfig?.futureHorizonDays;
    const horizonDays = (typeof rawHorizon === "number" && Number.isFinite(rawHorizon) && rawHorizon > 0)
      ? rawHorizon
      : DEFAULT_FUTURE_HORIZON_DAYS;
    const futureDays = Math.min(days, horizonDays);
    const timeMin = new Date(now.getTime() - days * 86_400_000).toISOString();
    const timeMax = new Date(now.getTime() + futureDays * 86_400_000).toISOString();

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let totalItemsReturned = 0;
    let pagesProcessed = 0;
    const compiled = compileSourceConfigPatterns(sourceConfig);
    const gcalIdMap = new WeakMap<RawEventData, string>();
    const allDayEventSet = new WeakSet<RawEventData>();

    const buildEvents = (items: GCalEvent[], filter?: (item: GCalEvent) => boolean): void => {
      let eventIndex = 0;
      for (const item of items) {
        if (filter && !filter(item)) {
          eventIndex++;
          continue;
        }
        try {
          const event = buildRawEventFromGCalItem(item, sourceConfig, { ...compiled, gcalIdMap, allDayEventSet });
          if (event) events.push(event);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Event parse error (${item.summary ?? "unknown"}): ${message}`);
          errorDetails.parse = [...(errorDetails.parse ?? []), {
            row: eventIndex,
            section: "calendar_events",
            error: message,
            rawText: buildGCalDiagnosticContext(item),
            partialData: { kennelTags: [item.summary ?? "unknown"], date: item.start?.dateTime ?? item.start?.date },
          }];
        }
        eventIndex++;
      }
    };

    const primary = await this.#fetchAllPages(
      calendarId, apiKey,
      { timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250", hl: "en" },
      errors, errorDetails,
    );
    pagesProcessed += primary.pagesProcessed;
    totalItemsReturned += primary.items.length;
    buildEvents(primary.items);

    // Secondary call recovers RECURRENCE-ID exceptions that the primary call
    // can't surface — e.g. orphan overrides on non-recurring masters with the
    // epoch RECURRENCE-ID 19691231T160000 pattern (#1021).
    // NB: orderBy=startTime is incompatible with singleEvents=false (API 400).
    let exceptionsRecovered = 0;
    try {
      const secondary = await this.#fetchAllPages(
        calendarId, apiKey,
        { timeMin, timeMax, singleEvents: "false", maxResults: "250", hl: "en" },
        errors, errorDetails,
      );
      pagesProcessed += secondary.pagesProcessed;
      const primaryIds = new Set(
        events.map(e => gcalIdMap.get(e)).filter((id): id is string => !!id),
      );
      const before = events.length;
      buildEvents(secondary.items, (item) => {
        if (!item.recurringEventId || !item.originalStartTime) return false;
        if (item.id && primaryIds.has(item.id)) return false;
        return true;
      });
      exceptionsRecovered = events.length - before;
    } catch (err) {
      // Never let the exception-recovery call break primary results — log and continue.
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Exception-recovery call failed: ${message}`);
      errorDetails.fetch = [...(errorDetails.fetch ?? []), { status: 0, message: `Exception-recovery call failed: ${message}` }];
    }

    // Some calendars (e.g. Chicagoland's 4X2H4 routing) only populate the
    // soonest-upcoming event's description; its hareline block carries the
    // future dates → hare mappings used to back-fill the rest.
    const backfillCount = applyInlineHarelineBackfill(
      events,
      sourceConfig?.inlineHarelinePattern,
      { now },
    );

    const hasErrorDetails = hasAnyErrors(errorDetails);

    const { events: compositeDeduped, compositeDedupedCount, allDayCollapsedCount } = dedupGCalEvents(events, gcalIdMap, allDayEventSet);

    return {
      events: compositeDeduped,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        calendarId: decodeURIComponent(calendarId),
        pagesProcessed,
        itemsReturned: totalItemsReturned,
        ...(backfillCount > 0 && { inlineHarelineBackfilled: backfillCount }),
        ...(exceptionsRecovered > 0 && { exceptionsRecovered }),
        ...(compositeDedupedCount > 0 && { compositeDeduped: compositeDedupedCount }),
        ...(allDayCollapsedCount > 0 && { allDayCollapsed: allDayCollapsedCount }),
      },
    };
  }

  /**
   * Paginated GET against `events.list`. Both primary (`singleEvents=true`)
   * and secondary (`singleEvents=false`) calls funnel through here so they
   * share fetch / error / page-token plumbing identically.
   *
   * Error handling: HTTP errors and JSON `data.error` responses are appended to
   * the passed-in `errors` and `errorDetails.fetch` arrays and the page loop
   * breaks — the method returns whatever items were collected so far. Only
   * transport-level exceptions (DNS failure, abort, network down) propagate
   * out of `fetch()`/`resp.json()`; callers wrap those in try/catch when they
   * care (e.g. the secondary call must not break primary results).
   */
  async #fetchAllPages(
    calendarId: string,
    apiKey: string,
    params: Record<string, string>,
    errors: string[],
    errorDetails: ErrorDetails,
  ): Promise<{ items: GCalEvent[]; pagesProcessed: number }> {
    const items: GCalEvent[] = [];
    let pagesProcessed = 0;
    let pageToken: string | undefined;
    do {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
      );
      url.searchParams.set("key", apiKey);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const resp = await fetch(url.toString(), {
        headers: { "User-Agent": "HashTracks-Scraper" },
      });

      if (!resp.ok) {
        const body = await resp.text();
        const message = `Google Calendar API ${resp.status}: ${body}`;
        errors.push(message);
        errorDetails.fetch = [...(errorDetails.fetch ?? []), { url: url.toString(), status: resp.status, message }];
        break;
      }

      const data: GCalListResponse = await resp.json();

      if (data.error) {
        const message = `Google Calendar API error ${data.error.code}: ${data.error.message}`;
        errors.push(message);
        errorDetails.fetch = [...(errorDetails.fetch ?? []), { url: url.toString(), status: data.error.code, message }];
        break;
      }

      pagesProcessed++;
      const pageItems = data.items ?? [];
      items.push(...pageItems);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return { items, pagesProcessed };
  }
}

/**
 * Fields filled in on a composite-dedup collision (#1101): when two duplicate
 * RRULE series produce events with the same kennel/date/title/startTime, the
 * first-seen wins but we backfill any missing field from the donor. Title is
 * intentionally absent — the composite key already includes it, so colliders
 * always share it. `kennelTags`/`date`/`startTime`/`sourceUrl` are part of the
 * key (or the source identity) and likewise off-limits.
 */
const MERGE_KEYS = [
  "description", "location", "locationUrl", "hares",
  "latitude", "longitude", "cost", "runNumber", "endTime",
] as const satisfies readonly (keyof RawEventData)[];

/**
 * Backfill missing fields on `target` from `donor`. Uses `== null` to treat
 * both `undefined` (numeric fields) and missing string values uniformly;
 * empty strings are also considered "missing" since none of the merged
 * fields use empty-string as a meaningful value.
 */
function mergeRawEventInPlace(target: RawEventData, donor: RawEventData): void {
  for (const k of MERGE_KEYS) {
    const tv = target[k];
    const dv = donor[k];
    if ((tv == null || tv === "") && dv != null && dv !== "") {
      (target as unknown as Record<string, unknown>)[k] = dv;
    }
  }
}

/**
 * Scan events for a hareline block belonging to the configured kennelTag and
 * back-fill matching dates. Returns the number of events updated. Non-
 * destructive: never overwrites an event that already has hares.
 *
 * Donor selection + year scoping protect against two silent-corruption paths:
 * 1. `orderBy=startTime` returns past events first, so a naive `.find()` would
 *    pick the oldest event whose description still carries a stale hareline.
 *    We instead pick the soonest-upcoming donor for the target kennel.
 * 2. The scrape window is typically ±365 days, so two events with the same
 *    month/day but different years can coexist. The parsed hareline is
 *    resolved against the donor's date into absolute `YYYY-MM-DD` keys before
 *    lookup, so entries never leak into neighboring years.
 *
 * Exported for testing — called internally by `GoogleCalendarAdapter.fetch()`.
 */
export function applyInlineHarelineBackfill(
  events: RawEventData[],
  pattern: CalendarSourceConfig["inlineHarelinePattern"] | null | undefined,
  options: { now?: Date } = {},
): number {
  if (!pattern || events.length === 0) return 0;
  const { kennelTag: targetKennel, blockHeader } = pattern;

  // 24h buffer mirrors src/adapters/html-scraper/sfh3-detail-enrichment.ts —
  // `event.date` is a local calendar date, but toISOString() is UTC, so without
  // the buffer an evening scrape (UTC past midnight) would drop the donor
  // event that's still happening "today" in the kennel's local timezone.
  const referenceTime = (options.now ?? new Date()).getTime();
  const todayIso = new Date(referenceTime - 86_400_000).toISOString().split("T")[0];
  const donor = events
    .filter((e) =>
      e.kennelTags[0] === targetKennel
      && e.date >= todayIso
      && !!e.description?.includes(blockHeader),
    )
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!donor?.description) return 0;

  const mdMap = parseInlineHareline(donor.description, blockHeader);
  if (Object.keys(mdMap).length === 0) return 0;

  const absoluteMap = resolveHarelineAgainstAnchorDate(mdMap, donor.date);

  let backfilled = 0;
  for (const event of events) {
    if (event.kennelTags[0] !== targetKennel) continue;
    if (event.hares) continue;
    const hares = absoluteMap[event.date];
    if (hares) {
      event.hares = hares;
      backfilled++;
    }
  }
  return backfilled;
}

/**
 * Resolve a `{ "M/D": hares }` map into `{ "YYYY-MM-DD": hares }` using the
 * donor's date as the anchor. Each M/D gets the first absolute date at or
 * after the anchor — if the anchor is late in the year, entries with earlier
 * months roll forward into the next year.
 *
 * Note: this is a string-level resolver, not a real calendar. A `2/29` entry
 * in a non-leap year will produce an invalid `YYYY-02-29` key that simply
 * won't match any event (back-fill no-op). Acceptable — 4X2H4 won't schedule
 * a trail on a date that doesn't exist.
 */
function resolveHarelineAgainstAnchorDate(
  mdMap: Record<string, string>,
  anchorDate: string,
): Record<string, string> {
  const anchorYear = parseInt(anchorDate.slice(0, 4), 10);
  const result: Record<string, string> = {};
  for (const [mdKey, hares] of Object.entries(mdMap)) {
    const [monthStr, dayStr] = mdKey.split("/");
    const mm = monthStr.padStart(2, "0");
    const dd = dayStr.padStart(2, "0");
    const sameYear = `${anchorYear}-${mm}-${dd}`;
    const absolute = sameYear >= anchorDate ? sameYear : `${anchorYear + 1}-${mm}-${dd}`;
    result[absolute] = hares;
  }
  return result;
}
