import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { googleMapsSearchUrl, decodeEntities, stripHtmlTags, compilePatterns, HARE_BOILERPLATE_RE, EVENT_FIELD_LABEL_RE, appendDescriptionSuffix, isPlaceholder, parse12HourTime, stripNonEnglishCountry } from "../utils";

// Kennel patterns derived from actual Boston Hash Calendar event data.
// Longer/more-specific patterns first to avoid false matches.
// Output values are kennelCodes (immutable identifiers), not shortNames.
const BOSTON_KENNEL_PATTERNS: [RegExp, string][] = [
  [/Boston Ball\s*Buster/i, "bobbh3"],
  [/Ball\s*Buster/i, "bobbh3"],
  [/BoBBH3/i, "bobbh3"],
  [/B3H4/i, "bobbh3"],
  [/BBH3/i, "bobbh3"],
  [/Beantown/i, "beantown"],
  [/Pink Taco/i, "pink-taco"],
  [/PT2H3/i, "pink-taco"],
  [/Boston Moon/i, "bos-moon"],
  [/Bos Moo[mn]/i, "bos-moon"],
  [/Full Moon/i, "bos-moon"],
  [/\bMoon\b/i, "bos-moon"],
  [/Boston H3/i, "boh3"],
  [/Boston Hash/i, "boh3"],
  [/BoH3/i, "boh3"],
  [/BH3/i, "boh3"],
];

/** Extract kennel tag from a Google Calendar event summary using Boston Hash kennel patterns. Falls back to "boh3". */
export function extractKennelTag(summary: string): string {
  for (const [pattern, tag] of BOSTON_KENNEL_PATTERNS) {
    if (pattern.test(summary)) return tag;
  }
  return "boh3";
}

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
 */
export function extractRunNumber(
  summary: string,
  description?: string,
  customPatterns?: string[] | RegExp[],
): number | undefined {
  // 1. Check summary first (e.g., "Beantown #255: ...", "BH3: ... #2781")
  const summaryMatch = /#(\d+)/.exec(summary);
  if (summaryMatch) return Number.parseInt(summaryMatch[1], 10);

  if (!description) return undefined;

  // 2. Fall back to description patterns
  let patterns: RegExp[];
  if (customPatterns && customPatterns.length > 0) {
    patterns = typeof customPatterns[0] === "string"
      ? compilePatterns(customPatterns as string[])
      : customPatterns as RegExp[];
  } else {
    patterns = DEFAULT_RUN_NUMBER_PATTERNS;
  }

  for (const pattern of patterns) {
    const match = pattern.exec(description);
    if (match?.[1]) {
      const num = Number.parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > 0) return num;
    }
  }

  // Standalone run number in description (e.g., "#2792" on its own line)
  const standaloneMatch = /(?:^|\n)[ \t]*#(\d{3,})[ \t]*(?:\n|$)/m.exec(description);
  if (standaloneMatch) return Number.parseInt(standaloneMatch[1], 10);

  return undefined;
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

/** Strip leading day/date prefixes like "Wed April 1st", "Sat 3/28" from titles. */
export function stripDatePrefix(text: string): string {
  const stripped = text
    .replace(DATE_PREFIX_FULL_RE, "")
    .replace(DATE_PREFIX_NUMERIC_RE, "")
    .trim();
  return stripped || text;
}

/** Shared label names used in description field parsing (start-of-line detection + embedded truncation). */
const LABEL_NAMES = "Hares?|Who|Where|Location|When|Time|Start|What|Hash Cash|Cost|Price|Registration|On[ -]After|Directions|Pack\\s*Meet|Meet(?:ing)?|Circle|Chalk\\s*Talk";

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

// Pre-compiled regexes for extractLocationFromDescription
const LOCATION_LABEL_RE = /(?:^|\n)\s*(?:WHERE|Location|Start\s+Address|Address|Meet(?:ing)?\s*(?:spot|point|at)?)\s*:\s*(.+)/im;
// Fallback: bare label (no colon) with value on subsequent line, optionally after a URL line
const LOCATION_BARE_LABEL_RE = /(?:^|\n)\s*(?:WHERE|LOCATION)\s*\n(?:\s*https?:\/\/\S+\s*\n)?\s*(.+)/im;
// Secondary fallback: "Start:" as location label (lower priority — often contains time, not location)
const LOCATION_START_RE = /(?:^|\n)\s*Start\s*:\s*(.+)/im;
// Filters bare time values from location results (e.g., "6:30pm", "18:30", "7:00")
const LOCATION_TIME_ONLY_RE = /^\d{1,2}:\d{2}(\s*(?:am|pm))?\s*$/i;
const LOCATION_TRUNCATE_RE = new RegExp(`\\s+(?:${LABEL_NAMES})\\s*:.*`, "i");
const LOCATION_URL_RE = /\s*https?:\/\/\S+.*/i;
/** Google Maps short/full URL pattern — used to preserve Maps links as locationUrl for geocoding. */
const MAPS_URL_RE = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.\w+\/maps)\//i;

// Pre-compiled regex for extractTimeFromDescription
const TIME_LABEL_RE = /(?:^|\n)\s*(?:Pack\s*Meet|Circle|Time|Start|When|Chalk\s*Talk)\s*:?\s*.*?(\d{1,2}:\d{2}\s*[ap]m)/im;

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
const normalizeForCompare = (s: string) => s.replaceAll(/\s+/g, "").toLowerCase();

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
  if (isPlaceholder(location)) return undefined;
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

/** Default hare extraction patterns for Google Calendar descriptions. */
const DEFAULT_HARE_PATTERNS = [
  /(?:^|\n)[ \t]*Hare(?:\s*&\s*Co-Hares?)?\(?s?\)?:[ \t]*(.+)/im,  // Hare:, Hares:, Hare(s):, Hare & Co-Hares:
  /(?:^|\n)[ \t]*Who\s*\(?(?:hares?)?\)?:[ \t]*(.+)/im,  // Who:, WHO (hares):, Who(hare):
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
    if (match?.[1]) {
      let hares = match[1].trim();
      // Clean up trailing punctuation/whitespace
      hares = hares.split("\n")[0].trim();
      // Truncate at asterisk separators (e.g., "Denny's Sucks *** could use a co-hare")
      hares = hares.replace(/\s*\*{2,}\s*.*$/, "").trim();
      // Strip trailing co-hare commentary (e.g., "could use a co-hare", "need a co-hare")
      hares = hares.replace(/\s*(?:could|need)\s+.*?co-?hares?\b.*$/i, "").trim();
      // Truncate at boilerplate markers (description text leaking into hares)
      hares = hares.replace(HARE_BOILERPLATE_RE, "").trim();
      // Truncate at next embedded field label when HTML stripping collapsed fields
      // (e.g., "AmazonWhat: A beautiful trail …" → "Amazon"). The \b word boundary
      // in EVENT_FIELD_LABEL_RE prevents matching tokens inside other words.
      hares = hares.replace(EVENT_FIELD_LABEL_RE, "").trim();
      // Strip trailing US phone numbers (e.g., "719-360-3805", "(555) 123-4567")
      hares = hares.replace(/\s*\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\s*$/, "").trim();
      // Skip generic/non-hare "Who:" answers
      if (/^(?:that be you|your|all|everyone)/i.test(hares)) continue;
      // Filter hare strings starting with common prepositions/verbs (description text, not names)
      if (/^(?:away|at|from|drop|is|was|has|had|can|will|would|should|could|for|and|or|off)\b/i.test(hares)) continue;
      if (hares.length > 0 && hares.length < 200) return hares;
    }
  }

  return undefined;
}

const mapsUrl = googleMapsSearchUrl;

/** Instruction phrases that indicate a GCal location field contains directions, not an address. */
const NON_ADDRESS_RE = /^(?:use the|check the|see the|see description|click|follow the|refer to|details in|when:|why:|hare:|what:|who:|cost:)/i;

/** Returns true if text starts with instruction phrasing rather than an address. */
function isNonAddressText(text: string): boolean {
  return NON_ADDRESS_RE.test(text.trim());
}

/** Config shape for Google Calendar sources */
interface CalendarSourceConfig {
  kennelPatterns?: [string, string][];  // [[regex, kennelTag], ...]
  defaultKennelTag?: string;            // fallback for unrecognized events
  skipPatterns?: string[];              // regex strings — skip events whose summary matches
  harePatterns?: string[];              // regex strings to extract hares from descriptions
  runNumberPatterns?: string[];         // regex strings to extract run numbers from descriptions
  titleHarePattern?: string;            // regex to extract hare names from summary when description has none
  descriptionSuffix?: string;           // appended to every event description
  includeAllDayEvents?: boolean;        // if true, don't skip all-day events (some calendars use them for real runs)
  defaultTitle?: string;                // human-readable fallback title when event summary is just a kennel slug
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
 * Match event summary against config-driven kennel patterns.
 * Returns the kennel tag for the first matching pattern, or null.
 */
function matchConfigPatterns(summary: string, patterns: [string, string][]): string | null {
  for (const [regex, tag] of patterns) {
    try {
      if (new RegExp(regex, "i").test(summary)) return tag;
    } catch {
      // Skip malformed patterns from source config
    }
  }
  return null;
}

/** Subset of the Google Calendar API v3 event shape */
interface GCalEvent {
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
  status?: string;
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
function normalizeGCalDescription(rawDesc: string | undefined): { rawDescription: string | undefined; description: string | undefined } {
  if (!rawDesc) return { rawDescription: undefined, description: undefined };
  let rawDescription = stripHtmlTags(decodeEntities(rawDesc), "\n");
  // Strip mailto: link artifacts: "text (mailto:email)" → "text"
  rawDescription = rawDescription.replace(/\s*\(mailto:[^)]+\)/g, "");
  const description = rawDescription
    ? rawDescription.replace(/[ \t]+/g, " ").trim().substring(0, 2000) || undefined
    : undefined;
  return { rawDescription, description };
}

/** Resolve kennel tag from event summary using config patterns or Boston fallback. */
function resolveKennelTagFromSummary(
  summary: string,
  sourceConfig: CalendarSourceConfig | null,
): { kennelTag: string; useFullTitle: boolean } {
  if (sourceConfig?.kennelPatterns) {
    const kennelTag = matchConfigPatterns(summary, sourceConfig.kennelPatterns)
      ?? sourceConfig.defaultKennelTag
      ?? extractKennelTag(summary);
    return { kennelTag, useFullTitle: true };
  }
  if (sourceConfig?.defaultKennelTag) {
    return { kennelTag: sourceConfig.defaultKennelTag, useFullTitle: true };
  }
  return { kennelTag: extractKennelTag(summary), useFullTitle: false };
}

/** Parse source.config into CalendarSourceConfig or null. */
function parseCalendarSourceConfig(config: unknown): CalendarSourceConfig | null {
  return (config && typeof config === "object" && !Array.isArray(config))
    ? config as CalendarSourceConfig
    : null;
}

/** Build a RawEventData from a single Google Calendar event item. Returns null if the item should be skipped. */
export function buildRawEventFromGCalItem(
  item: GCalEvent,
  sourceConfig: CalendarSourceConfig | null,
  compiledHarePatterns?: RegExp[],
  compiledRunNumberPatterns?: RegExp[],
  compiledSkipPatterns?: RegExp[],
  compiledTitleHarePattern?: RegExp,
): RawEventData | null {
  if (item.status === "cancelled") return null;
  if (!item.summary) return null;
  if (!item.start?.dateTime && !item.start?.date) return null;
  // Skip all-day events unless config opts in (some calendars use all-day for real runs)
  if (item.start?.date && !item.start?.dateTime && !sourceConfig?.includeAllDayEvents) return null;

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
  const { rawDescription, description } = normalizeGCalDescription(item.description);
  let hares = rawDescription ? extractHares(rawDescription, compiledHarePatterns) : undefined;
  // Fall back to extracting hares from title when description has none
  let haresFromTitle = false;
  if (!hares && compiledTitleHarePattern) {
    const titleMatch = compiledTitleHarePattern.exec(summary);
    if (titleMatch?.[1]) {
      hares = titleMatch[1].trim() || undefined;
      haresFromTitle = !!hares;
    }
  }
  const { kennelTag, useFullTitle } = resolveKennelTagFromSummary(summary, sourceConfig);
  // Location: prefer item.location (unless placeholder or instruction text), fall back to description extraction
  let location = item.location ? stripNonEnglishCountry(decodeEntities(item.location).trim()) : undefined;
  if (location && (isPlaceholder(location) || isNonAddressText(location))) location = undefined;
  if (!location && rawDescription) {
    location = extractLocationFromDescription(rawDescription);
  }

  // Determine title: if title matches kennel tag, try description fallback
  let title = useFullTitle ? summary : extractTitle(summary);
  title = stripDatePrefix(title);
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
  // Strip only the hare-name capture group from the title, preserving the rest (e.g., "AH3 #2269")
  if (haresFromTitle && compiledTitleHarePattern) {
    const titleMatch = compiledTitleHarePattern.exec(title);
    if (titleMatch?.index === 0 && titleMatch[1]) {
      const cleaned = title.slice(titleMatch[1].length).trimStart();
      if (cleaned) title = cleaned;
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

  // " - Location TBD" suffix: "HareName - Location TBD" (EWH3 placeholder events)
  const locTbdMatch = TITLE_DASH_LOCATION_TBD_RE.exec(title);
  if (locTbdMatch) {
    const beforeDash = locTbdMatch[1].trim();
    // The text before " - Location TBD" is likely hare name(s) for future events
    if (!hares && beforeDash) hares = beforeDash;
    title = kennelTag;
  }

  // Strip " - LocationName" from title when location was already extracted
  if (location && title.toLowerCase().endsWith(` - ${location.toLowerCase()}`)) {
    title = title.slice(0, -(` - ${location}`).length).trim();
  }

  // Address-as-title: move to location, use kennel tag as title
  if (ADDRESS_AS_TITLE_RE.test(title)) {
    if (!location) location = title;
    title = kennelTag;
  }

  // Email-as-title: placeholder/recruitment summary — use kennel tag
  if (EMAIL_IN_TITLE_RE.test(title)) {
    title = kennelTag;
  }

  // defaultTitle fallback runs last, after all branches that may reset title to kennelTag
  if (titleMatchesKennelTag(title, kennelTag) && sourceConfig?.defaultTitle) {
    title = sourceConfig.defaultTitle;
  }

  // Start time: prefer dateTime-derived time, fall back to description extraction
  let resolvedStartTime = startTime;
  if (!resolvedStartTime && rawDescription) {
    resolvedStartTime = extractTimeFromDescription(rawDescription);
  }

  // Any URL as location (Maps or otherwise) gets routed to locationUrl for geocoding,
  // not stored as display location. resolveCoords handles URL → address resolution.
  const locationIsUrl = location && /^https?:\/\//i.test(location);
  return {
    date: dateISO,
    kennelTag,
    runNumber: extractRunNumber(summary, rawDescription, compiledRunNumberPatterns),
    title,
    description: appendDescriptionSuffix(description, sourceConfig?.descriptionSuffix),
    hares,
    location: locationIsUrl ? undefined : location,
    locationUrl: location ? (locationIsUrl ? location : mapsUrl(location)) : undefined,
    startTime: resolvedStartTime,
    // endTime is HH:MM only, so cross-date end timestamps (overnight runs) are dropped.
    endTime: endParts && endParts.dateISO === dateISO ? endParts.startTime : undefined,
    sourceUrl: item.htmlLink,
  };
}

/** Build diagnostic context for a parse error on a GCal item. */
function buildGCalDiagnosticContext(item: GCalEvent): string {
  const rawParts = [`Summary: ${item.summary ?? "unknown"}`];
  if (item.description) rawParts.push(`Description: ${item.description}`);
  if (item.location) rawParts.push(`Location: ${item.location}`);
  if (item.start) rawParts.push(`Start: ${item.start.dateTime ?? item.start.date ?? ""}`);
  return rawParts.join("\n").slice(0, 2000);
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

    const now = new Date();
    const timeMin = new Date(now.getTime() - days * 86_400_000).toISOString();
    const timeMax = new Date(now.getTime() + days * 86_400_000).toISOString();

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let pageToken: string | undefined;
    let totalItemsReturned = 0;
    let pagesProcessed = 0;
    const sourceConfig = parseCalendarSourceConfig(source.config);
    const compiledHarePatterns = sourceConfig?.harePatterns?.length
      ? compilePatterns(sourceConfig.harePatterns)
      : undefined;
    const compiledRunNumberPatterns = sourceConfig?.runNumberPatterns?.length
      ? compilePatterns(sourceConfig.runNumberPatterns)
      : undefined;
    const compiledSkipPatterns = sourceConfig?.skipPatterns?.length
      ? compilePatterns(sourceConfig.skipPatterns, "i")
      : undefined;
    const compiledTitleHarePattern = sourceConfig?.titleHarePattern
      ? compilePatterns([sourceConfig.titleHarePattern], "i")[0]
      : undefined;

    do {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
      );
      url.searchParams.set("key", apiKey);
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("hl", "en");
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
      const items = data.items ?? [];
      totalItemsReturned += items.length;
      let eventIndex = 0;

      for (const item of items) {
        try {
          const event = buildRawEventFromGCalItem(item, sourceConfig, compiledHarePatterns, compiledRunNumberPatterns, compiledSkipPatterns, compiledTitleHarePattern);
          if (event) events.push(event);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Event parse error (${item.summary ?? "unknown"}): ${message}`);
          errorDetails.parse = [...(errorDetails.parse ?? []), {
            row: eventIndex,
            section: "calendar_events",
            error: message,
            rawText: buildGCalDiagnosticContext(item),
            partialData: { kennelTag: item.summary ?? "unknown", date: item.start?.dateTime ?? item.start?.date },
          }];
        }
        eventIndex++;
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    // Some calendars (e.g. Chicagoland's 4X2H4 routing) only populate the
    // soonest-upcoming event's description; its hareline block carries the
    // future dates → hare mappings used to back-fill the rest.
    const backfillCount = applyInlineHarelineBackfill(
      events,
      sourceConfig?.inlineHarelinePattern,
      { now },
    );

    const hasErrorDetails = hasAnyErrors(errorDetails);

    // Dedup events with identical date+kennelTag+startTime+title from the same calendar
    // (upstream calendars sometimes contain duplicate entries)
    const seen = new Set<string>();
    const dedupedEvents = events.filter(e => {
      const key = `${e.date}|${e.kennelTag}|${e.startTime ?? ""}|${e.title ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      events: dedupedEvents,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        calendarId: decodeURIComponent(calendarId),
        pagesProcessed,
        itemsReturned: totalItemsReturned,
        ...(backfillCount > 0 && { inlineHarelineBackfilled: backfillCount }),
      },
    };
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
      e.kennelTag === targetKennel
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
    if (event.kennelTag !== targetKennel) continue;
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
