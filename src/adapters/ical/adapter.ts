import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails, ParseError } from "../types";
import { hasAnyErrors } from "../types";
import { googleMapsSearchUrl, compilePatterns, appendDescriptionSuffix, isPlaceholder, extractHashRunNumber, hasPlaceholderRunNumber, cleanLocationName, eqTrimLc, EVENT_FIELD_LABEL_RE, EVENT_FIELD_LABEL_UPPERCASE_RE } from "../utils";
import { safeFetch } from "../safe-fetch";
import { enrichSFH3Events, markSFH3SeriesMembership } from "../html-scraper/sfh3-detail-enrichment";
import { enrichBerlinH3Events } from "../html-scraper/berlin-h3-detail-enrichment";
import { sync as icalSync } from "node-ical";
import type { VEvent, ParameterValue, DateWithTimeZone } from "node-ical";

/** Config shape for iCal feed sources */
export interface ICalSourceConfig {
  kennelPatterns?: [string, string][]; // [[regex, kennelTag], ...] — same as Google Calendar
  defaultKennelTag?: string;           // fallback for unrecognized events
  strictKennelRouting?: boolean;       // #2355 Stockholm HHH: a shared multi-series feed (SUH3, SAH3, BASH, SPOR&DIC, LYH3…) where only some series are tracked. When set, an event whose SUMMARY matches NO kennelPattern is SKIPPED rather than falling through to defaultKennelTag — otherwise every untracked series welds onto the default kennel. Reconcile-safe: every real tracked-series event still matches its own pattern. Mirrors Google Calendar's strictKennelRouting.
  skipPatterns?: string[];             // SUMMARY patterns to skip (e.g., "Hand Pump Workday")
  harePatterns?: string[];             // regex strings to extract hares from descriptions
  runNumberPatterns?: string[];        // regex strings to extract run numbers from descriptions
  locationPatterns?: string[];         // regex strings to extract location from descriptions (overrides default LOCATION_PATTERNS)
  costPatterns?: string[];             // regex strings to extract cost from descriptions (e.g. wordpress-hash-event-api "Hash Cash: 5€")
  titleHarePattern?: string;           // regex to extract hare names from SUMMARY when description has none
  descriptionSuffix?: string;          // static text appended to every event description
  enrichSFH3Details?: boolean;         // fetch sfh3.com/runs/{id} detail pages for canonical title + Comment field
  enrichBerlinH3Details?: boolean;     // fetch berlin-h3.eu event pages for Hares field from wp-event-manager
  allowEmptyBody?: boolean;            // treat an empty 200 body as an empty-success (0 events) instead of an error — The Events Calendar's ?ical=1 export returns 0 bytes when there are no upcoming events (ICH3 #1753)
  keepNonKennelTitlePrefix?: boolean;  // #1955: only strip a "Prefix:" from the SUMMARY title when the prefix identifies the kennel (run marker or matching tag); keep event-type prefixes like "Hash Lunch:". Off by default — most feeds (e.g. the Reading regional Localendar) use full kennel-name prefixes that SHOULD be stripped.
  coalesceEndpointDuplicates?: boolean; // collapse a same-date all-day /events/{n} VEVENT into its timed /runs/{m} twin, enriching hares/description/etc. — Oslo H3 publishes each run on both endpoints (#1828)
  rejectTitleHareThemeSuffix?: boolean; // #2004 Perth: drop a titleHarePattern capture that ends in an event-type word ("West Coast 4 seasons run") — it's a trail theme, not a hare. Opt-in so it never touches other titleHarePattern sources whose hares can legitimately end in such words.
  stripTitleHareSuffix?: boolean;      // #2216 Charm City: after extracting hares from the SUMMARY via titleHarePattern, remove the matched suffix (e.g. "~ <hares>") from the resolved title so hare names don't appear in both `title` and `haresText`. Opt-in (and gated on hareFromTitle) — full-line titleHarePattern sources (Perth's "^Run N - hares") would blank the whole title, and a rejected theme suffix must keep its title intact.
  titleStripPrefixAliases?: string[];  // #2148 Reading / #2160 ICH3: kennel-label variants ("RH3"/"ReadingH3", "ICH3") to strip from the START of the resolved title together with an immediately-following run marker ("#1203:", "# 60"). Opt-in per source — the run number is already extracted into its own field, so the prefix is pure noise. See stripTitleKennelRunPrefix.
  cleanDescriptionLocation?: boolean;  // #2159 Charm City: run a DESCRIPTION-derived location (not the VEVENT LOCATION field) through cleanLocationName — strips URLs/labels/CTA residue and rejects placeholders. Opt-in so feeds whose On-On venue path already emits clean names are untouched.
  dropImprobablePlaceholderTime?: boolean; // #2175 Charm City: clear startTime/endTime when a `#TBD`-style placeholder run also carries a junk late-night DTSTART (23:00–03:59) — the hare entered a throwaway time before the trail was scheduled. Opt-in so a legitimately late/early-morning trail on another feed that still uses a placeholder run number keeps its time.
}

/**
 * Extract the string value from a node-ical ParameterValue.
 * ParameterValue<T> can be T (string) or { val: T, params: P }.
 */
export function paramValue(pv: ParameterValue | undefined): string | undefined {
  if (pv == null) return undefined;
  if (typeof pv === "string") return pv;
  if (typeof pv === "object" && "val" in pv) return pv.val;
  return undefined;
}

/**
 * Parse an iCal SUMMARY field into kennel tag, run number, and title.
 *
 * Common patterns:
 *   "SFH3 #2285: A Very Heated Rivalry" → { kennel: "SFH3", run: 2285, title: "A Very Heated Rivalry" }
 *   "BARH3 #446"                        → { kennel: "BARH3", run: 446, title: undefined }
 *   "FHAC-U: BAWC 5"                    → { kennel: "FHAC-U", run: undefined, title: "BAWC 5" }
 *   "Hand Pump Workday"                 → { kennel: undefined, run: undefined, title: "Hand Pump Workday" }
 */
export function parseICalSummary(
  summary: string,
  kennelPatterns?: [string, string][],
  defaultKennelTag?: string,
  keepNonKennelTitlePrefix = false,
): { kennelTag: string; runNumber?: number; title?: string; matchedPattern: boolean } {
  let kennelTag: string | undefined;
  // Match against config patterns
  if (kennelPatterns) {
    for (const [regex, tag] of kennelPatterns) {
      const match = new RegExp(regex, "i").exec(summary);
      if (match) {
        kennelTag = tag;
        break;
      }
    }
  }

  // matchedPattern tells the caller whether an explicit kennelPattern hit (vs a
  // defaultKennelTag fallback) — strictKennelRouting uses it to drop untracked
  // series on shared feeds (#2355).
  const matchedPattern = kennelTag != null;
  if (!kennelTag) {
    kennelTag = defaultKennelTag ?? "UNKNOWN";
  }

  // Extract run number via the shared helper: enforces the #1147 delimiter
  // guard so an unconfirmed placeholder like Reading H3's "RH3: #120?"
  // (#1785) rejects instead of parsing as a bogus 120, and accepts the
  // fullwidth/`#:` colon variants for free.
  const runNumber = extractHashRunNumber(summary);

  // Extract title: everything after "#{number}: " or "{kennel}: " or "{kennel} #{number}: "
  let title: string | undefined;
  // Capture the pre-colon prefix (group 1), an optional run marker (group 2),
  // and the title (group 3). Group 1 is greedy but its char class excludes
  // both "#" and ":", so it always stops at the first run marker or colon —
  // the same split point a lazy quantifier would find. No `\s*` quantifier sits
  // adjacent to another (the post-colon whitespace is trimmed below instead),
  // so there's no super-linear backtracking shape. The prefix is stripped only
  // when it identifies the kennel — see below.
  const titleMatch = summary.match(
    /^([A-Za-z0-9 .'-]+)(#[\d.A-Za-z]+)?:(.+)$/,
  );
  if (titleMatch) {
    // #1955: when `keepNonKennelTitlePrefix` is set, only strip the prefix
    // when it is a kennel prefix — either it carries a "#<run>" marker
    // ("SFH3 #2285: Title") or it matches the resolved kennel ("FHAC-U: BAWC
    // 5", "RH3: #120? Kegs & Eggs"). An event-type prefix like "Hash Lunch:
    // Friday 5th June" matches neither, so we leave `title` undefined and let
    // the caller keep the full summary instead of surfacing a bare date.
    // Default (flag off): strip any prefix — most feeds (e.g. the Reading
    // regional Localendar) use full kennel-name prefixes that should go.
    const prefix = titleMatch[1].trim();
    const hasRunMarker = !!titleMatch[2];
    const stripPrefix =
      !keepNonKennelTitlePrefix || hasRunMarker || prefixMatchesKennel(prefix, kennelTag);
    if (stripPrefix) {
      // Drop a leading unconfirmed-run placeholder ("#120?") that the kennel
      // uses in place of a real run number (#1785): "RH3: #120? Kegs & Eggs" →
      // "Kegs & Eggs"; a bare "RH3: #120?" → undefined so the caller can
      // synthesize a default rather than surfacing the placeholder marker.
      // trimStart first because the regex no longer consumes post-colon space.
      title = titleMatch[3].trimStart().replace(/^#\d+\?+\s*/, "").trim() || undefined;
    }
  }

  return { kennelTag, runNumber, title, matchedPattern };
}

/** Normalize a kennel token for loose comparison: lowercase, drop everything
 *  that isn't a letter or digit ("FHAC-U" → "fhacu", "Marin H3" → "marinh3"). */
function normalizeKennelToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Does the pre-colon `prefix` identify the resolved `kennelTag`? Used by
 * `parseICalSummary` to decide whether a "Prefix: Title" summary is a kennel
 * prefix worth stripping. Because the resolved tag derives from the kennel's
 * name/code, a genuine kennel prefix normalizes to exactly the tag —
 * "SFH3"→"sfh3", "FHAC-U"→"fhacu", "Marin H3"→"marinh3". An event-type phrase
 * like "Hash Lunch"→"hashlunch" matches no kennel tag, so it's kept.
 *
 * Exact equality only (no prefix/substring match): a looser `startsWith` would
 * over-strip qualifiers that happen to share the kennel code, e.g. it would
 * reduce "RH3 Social: Pub Night" to "Pub Night", dropping the "Social"
 * qualifier the flag exists to preserve. Run-marker prefixes ("SFH3 #2285:")
 * are handled separately by the caller's `hasRunMarker` check.
 */
function prefixMatchesKennel(prefix: string, kennelTag: string): boolean {
  const np = normalizeKennelToken(prefix);
  const nk = normalizeKennelToken(kennelTag);
  return np !== "" && np === nk;
}

// #2148 / #2160 — leading-prefix tokenizer for `stripTitleKennelRunPrefix`.
// Each regex carries at most one zero-or-more quantifier over a single bounded
// char class, so the analyzer (Sonar S5852/S5843) sees them as provably linear
// — the same multi-pass shape the file uses elsewhere (cleanHaresValue,
// extractOnOnVenueFromDescription) instead of one mega-regex with adjacent
// `\s*`-after-alternation.
const TITLE_PREFIX_CONNECTOR_RE = /^[\s:/.\-–—]+/;
// Run marker: "#1203", "# 60" (spaced), "#1191A" (letter suffix), "#120?"
// (unconfirmed). `[ \t]*` then `\d+` are distinct classes — no adjacency.
const TITLE_PREFIX_RUN_MARKER_RE = /^[#＃][ \t]*\d+[A-Za-z]?\??/;

/**
 * Strip a leading kennel label + run marker from a title (#2148 Reading, #2160
 * ICH3). The run number is already captured in its own field, so the prefix is
 * redundant noise the source bakes into the SUMMARY:
 *   "RH3: #1203: Deja FuckYou Hash" → "Deja FuckYou Hash"
 *   "RH3 #1201 Some Bitches Be Getting Married Hash" → "Some Bitches…"
 *   "RH3 Pigs' Head Social" → "Pigs' Head Social"
 *   "RH3 #1197 / Rogue North H3 Joint Trail" → "Rogue North H3 Joint Trail"
 *   "ICH3# 60 Plea Barkin" → "Plea Barkin"
 *
 * Opt-in via `titleStripPrefixAliases`: only the listed kennel labels are
 * stripped, and only at the very start. A row from another kennel on the same
 * feed ("Philadelphia HHH" on Reading's regional Localendar) matches no alias
 * and is returned untouched. Returns `undefined` when nothing real remains so
 * the caller leaves the title for the merge synthesizer.
 *
 * Procedural single-pass-per-token (no mega-regex) to stay ReDoS-clean.
 */
export function stripTitleKennelRunPrefix(
  title: string,
  aliases: string[],
): string | undefined {
  let s = title.trim();
  // Longest alias first so "ReadingH3" wins over a hypothetical "Reading".
  const ordered = [...aliases].sort((a, b) => b.length - a.length);
  for (const alias of ordered) {
    if (!alias) continue;
    if (s.toLowerCase().startsWith(alias.toLowerCase())) {
      // Boundary guard: the char after the alias must NOT be alphanumeric, so
      // "RH3" never eats the "RH3" inside a sibling code like "RH3FM".
      const next = s.charAt(alias.length);
      if (next === "" || !/[\p{L}\p{N}]/u.test(next)) {
        s = s.slice(alias.length);
        break;
      }
    }
  }
  s = s.replace(TITLE_PREFIX_CONNECTOR_RE, "");
  s = s.replace(TITLE_PREFIX_RUN_MARKER_RE, "");
  s = s.replace(TITLE_PREFIX_CONNECTOR_RE, "");
  return s.trim() || undefined;
}


// #2175 Charm City: a `#TBD` placeholder VEVENT carries a junk DTSTART time
// (03:02) — the audit's `event-improbable-time` window is 23:00–04:00. Used
// only in combination with hasPlaceholderRunNumber so real late/early runs with
// a confirmed run number keep their time.
function isImprobableHashTime(hhmm: string | null | undefined): boolean {
  if (!hhmm) return false;
  const hour = Number.parseInt(hhmm.slice(0, 2), 10);
  if (Number.isNaN(hour)) return false;
  return hour >= 23 || hour < 4;
}

// Module-level patterns for description field extraction
const HARE_PATTERNS = [
  /(?:^|\n)\s*Hares?:\s*([^\n]+)/im,
  /(?:^|\n)\s*Hare\(s\):\s*([^\n]+)/im,
];
// #2312 Phoenix LBH: the whitespace AFTER the label must be horizontal-only
// (`[^\S\n]*`, not `\s*`). Events Manager emits an empty venue as
// "Where:\n\n\nWhy: Monday is a hashing day" — a `\s*` after "Where:" greedily
// eats the blank lines and the capture grabs the *next* field's line ("Why:
// Monday is a hashing day"). Horizontal-only whitespace stops at the newline, so
// an empty label yields no capture and the venue stays unset.
const LOCATION_PATTERNS = [
  /(?:^|\n)\s*Where:[^\S\n]*([^\n]+)/im,
  /(?:^|\n)\s*Location:[^\S\n]*([^\n]+)/im,
  /(?:^|\n)\s*Start(?:ing)?\s*(?:Location)?:[^\S\n]*([^\n]+)/im,
];
const COST_PATTERNS = [
  /(?:^|\n)\s*Hash\s*Cash:\s*([^\n]+)/im,
];
// #2004 Perth: a `titleHarePattern` capture that ends in an event-type word
// ("West Coast 4 seasons run") is a trail theme, not a hare. "hash"/"trail" are
// deliberately omitted so legit names like "Captain Hash" pass.
const TITLE_HARE_THEME_SUFFIX_RE = /\b(?:run|walk|jog|ride|bike|hike)$/i;
// `maps.app.goo.gl` is the modern Google Maps share-link host (hashnyc.com's
// iCal feed emits these in both the DESCRIPTION "Map:" line and the URL
// property); `goo.gl/maps` is the legacy short form. Both recognized so the
// map pin surfaces as locationUrl.
const MAPS_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps)\S*/i;

/** Normalize ICS escape sequences in a description string. */
function normalizeIcsDescription(description: string): string {
  return description.replaceAll("\\n", "\n").replaceAll("\\,", ",");
}

/**
 * Extract a labeled field value from an ICS-encoded description.
 * Matches patterns like "Label: value", takes the first line, and unescapes ICS sequences.
 */
function extractFieldFromDescription(
  description: string,
  patterns: RegExp[],
  options?: { maxLength?: number; stripUrls?: boolean },
): string | undefined {
  const normalized = normalizeIcsDescription(description);
  const maxLength = options?.maxLength ?? 200;

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match) {
      let value = match[1].trim();
      value = value.replaceAll("\\;", ";").replaceAll("\\,", ",");
      if (options?.stripUrls) value = value.replace(/https?:\/\/\S+/g, "").trim();
      if (value.length > 0 && value.length < maxLength) return value;
    }
  }

  return undefined;
}

/**
 * Extract hare names from an iCal DESCRIPTION field.
 * Accepts pre-compiled RegExp[] or raw string[] (compiled on the fly for one-off use).
 * The adapter fetch() pre-compiles once per scrape for efficiency.
 */
// Reading H3 (#1785) packs sibling fields onto the same DESCRIPTION line as
// the hares, with no newline to terminate the `Hares:` capture: both
// "Hares: Dances with Whores More details to cum" (a standing "details
// coming later" notice) and "Hares: Sex Toys & Silence of the Goats On-On:
// Reading Regional Airport Hash Cash: $5 …" (real fields running on). Clip the
// captured hares at the earliest inline field-label boundary OR standing
// trailer phrase, then drop any dangling separator.
//
// The field-label regexes are the shared set used by the GCal/HTML adapters;
// On-On is Reading-specific and added locally. The trailer phrases are matched
// procedurally (lowercase indexOf) to avoid the multi-`\s+` alternation shape
// Sonar S5852 flags (memory: feedback_sonar_s5852_procedural_over_regex).
const HARES_TRAILER_PHRASES = [
  "more details to cum",
  "more details to come",
  "more details to follow",
  "more to come",
  "details to follow",
];
// No `.*$` tail — cleanHaresValue only reads `.index` (the label start), and
// the trailing `\s*:.*$` shape trips Sonar S5852.
const HARES_ON_ON_LABEL_RE = /On[\s-]?On\s*:/i;
const HARES_FIELD_LABEL_RES = [EVENT_FIELD_LABEL_RE, EVENT_FIELD_LABEL_UPPERCASE_RE, HARES_ON_ON_LABEL_RE];
const HARES_TRAILER_SEPARATORS_RE = /[\s&,;-]+$/;
function cleanHaresValue(value: string): string {
  let cut = value.length;
  for (const re of HARES_FIELD_LABEL_RES) {
    // `search` is stateless (no `lastIndex`) — safe even if a shared regex
    // ever gains the global flag; we only need the match start index.
    const index = value.search(re);
    if (index >= 0 && index < cut) cut = index;
  }
  const lower = value.toLowerCase();
  for (const phrase of HARES_TRAILER_PHRASES) {
    const i = lower.indexOf(phrase);
    if (i >= 0 && i < cut) cut = i;
  }
  return value.slice(0, cut).replace(HARES_TRAILER_SEPARATORS_RE, "").trim();
}

export function extractHaresFromDescription(description: string, customPatterns?: string[] | RegExp[]): string | undefined {
  let patterns: RegExp[] = HARE_PATTERNS;
  if (customPatterns && customPatterns.length > 0) {
    patterns = typeof customPatterns[0] === "string"
      ? compilePatterns(customPatterns as string[])
      : (customPatterns as RegExp[]);
  }
  const hares = extractFieldFromDescription(description, patterns);
  return hares ? cleanHaresValue(hares) || undefined : undefined;
}

/**
 * Extract run number from an iCal DESCRIPTION field using custom patterns.
 * Each pattern must have a capture group matching digits.
 */
export function extractRunNumberFromDescription(
  description: string,
  compiledPatterns: RegExp[],
): number | undefined {
  for (const pattern of compiledPatterns) {
    const match = pattern.exec(description);
    if (match?.[1]) {
      const num = Number.parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > 0) return num;
    }
  }
  return undefined;
}

/**
 * Extract a location name from an iCal DESCRIPTION field.
 * Accepts pre-compiled RegExp[] for custom patterns; falls back to default LOCATION_PATTERNS.
 * Used as a fallback when the LOCATION field is empty.
 */
export function extractLocationFromDescription(description: string, customPatterns?: RegExp[]): string | undefined {
  return extractFieldFromDescription(description, customPatterns ?? LOCATION_PATTERNS, {
    maxLength: 300,
    stripUrls: true,
  });
}

// #801 Reading H3 format: "...On On: 6:15p Lower Access lot at Monocacy Hill Hares: ..."
// Two-pass extraction (single regex trips SonarCloud complexity cap):
//   1. Find the 'On On:' label.
//   2. Slice to the first sibling label (Hares:/Hash Cash:) or newline.
const ON_ON_LABEL_RE = /On[-\s]?On\s*:\s*/i;
const ON_ON_TERMINATOR_RE = /\s*Hares?:|\s*Hash\s*Cash:|\n/i;
// Guards against "On On On: Cozy Car" (after-run shorthand) false-positive.
const PRECEDING_ON_RE = /\bOn[-\s]$/i;
// Accepts 12-hour ("6:15p", "6:15 pm") and 24-hour ("18:30") leading times.
const LEADING_TIME_RE = /^(?:\d{1,2}(?::\d{2})?\s*[ap]\.?m?\.?|\d{1,2}:\d{2})\s+/i;
const TIME_ONLY_RE = /^(?:\d{1,2}(?::\d{2})?\s*[ap]\.?m?\.?|\d{1,2}:\d{2})$/i;

/**
 * Fallback for iCal DESCRIPTION bodies that embed the venue inline via
 * "On On: {time} {venue} Hares: ..." — common in Localendar-hosted feeds
 * (Reading H3 #801).
 */
export function extractOnOnVenueFromDescription(description: string): string | undefined {
  const normalized = normalizeIcsDescription(description);
  const labelMatch = ON_ON_LABEL_RE.exec(normalized);
  if (!labelMatch) return undefined;
  // Reject after-run "On On On:" shorthand — the leading "On " makes the
  // trailing "On On:" match the label even though it's not the start-point.
  if (labelMatch.index > 0 && PRECEDING_ON_RE.test(normalized.slice(0, labelMatch.index))) {
    return undefined;
  }
  const afterLabel = normalized.slice(labelMatch.index + labelMatch[0].length);
  const termMatch = ON_ON_TERMINATOR_RE.exec(afterLabel);
  const rawVenue = termMatch ? afterLabel.slice(0, termMatch.index) : afterLabel;
  let venue = rawVenue.replace(LEADING_TIME_RE, "").trim();
  venue = venue.replaceAll(String.raw`\;`, ";").replaceAll(String.raw`\,`, ",");
  if (venue.length < 3 || venue.length > 300) return undefined;
  // Reject captures that are nothing but a time or a stray punctuation fragment.
  if (TIME_ONLY_RE.test(venue)) return undefined;
  return venue;
}

/**
 * Extract a cost/hash-cash value from an iCal DESCRIPTION field.
 * Accepts pre-compiled RegExp[] for custom patterns; falls back to default COST_PATTERNS.
 * Short maxLength (100) guards against picking up multi-line paragraphs.
 */
export function extractCostFromDescription(description: string, customPatterns?: RegExp[]): string | undefined {
  return extractFieldFromDescription(description, customPatterns ?? COST_PATTERNS, {
    maxLength: 100,
  });
}

/**
 * Extract a Google Maps URL from an iCal DESCRIPTION field.
 * Used as a fallback when no locationUrl is available from LOCATION or GEO fields.
 */
export function extractMapsUrlFromDescription(description: string): string | undefined {
  const normalized = normalizeIcsDescription(description);

  const match = MAPS_URL_PATTERN.exec(normalized);
  if (match) {
    let url = match[0].replaceAll("\\;", "").replaceAll("\\,", ""); // Strip ICS escape sequences
    url = url.replace(/[),;]+$/, ""); // NOSONAR — bounded input from regex match, no backtracking risk
    return url;
  }

  return undefined;
}

/**
 * Format a DateWithTimeZone as YYYY-MM-DD date string in the event's original timezone.
 * node-ical stores dates as UTC JS Dates — we use Intl.DateTimeFormat to convert back
 * to the original TZID timezone for correct local date/time extraction.
 */
function formatDate(dt: DateWithTimeZone): string {
  if (dt.dateOnly) {
    return dt.toISOString().split("T")[0];
  }
  // Use the event's original timezone (or UTC fallback) to get the correct local date
  const tz = dt.tz || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Format a DateWithTimeZone as HH:MM time string in the event's original timezone.
 * Returns undefined for date-only events.
 */
function formatTime(dt: DateWithTimeZone): string | undefined {
  if (dt.dateOnly) return undefined;
  const tz = dt.tz || "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const h = parts.find((p) => p.type === "hour")!.value;
  const m = parts.find((p) => p.type === "minute")!.value;
  return `${h}:${m}`;
}

const mapsUrl = googleMapsSearchUrl;

/** Build the shared diagnosticContext shape for iCal error/success results. */
function icalDiagnostics(overrides: {
  url: string;
  fetchDurationMs: number;
  icsBytes?: number;
  contentType?: string;
  [key: string]: unknown;
}): Record<string, unknown> {
  const { url, fetchDurationMs, icsBytes = 0, contentType, ...rest } = overrides;
  return { url, totalVEvents: 0, eventsExtracted: 0, skippedDateRange: 0, skippedPattern: 0, fetchDurationMs, icsBytes, contentType, ...rest };
}

/** Fetch and validate ICS content from a URL. Returns icsText and contentType on success, or an error result. */
async function fetchAndValidateIcsContent(
  url: string,
  fetchStart: number,
  allowEmptyBody: boolean,
): Promise<{ icsText: string; contentType: string | undefined } | { error: ScrapeResult }> {
  let contentType: string | undefined;
  try {
    const resp = await safeFetch(url, {
      headers: { "User-Agent": "HashTracks-Scraper" },
    });

    contentType = resp.headers.get("content-type") ?? undefined;

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      const message = `iCal fetch failed ${resp.status}: ${body.substring(0, 500)}`;
      return {
        error: {
          events: [], errors: [message],
          errorDetails: { fetch: [{ url, status: resp.status, message }] },
          diagnosticContext: icalDiagnostics({ url, fetchDurationMs: Date.now() - fetchStart, contentType }),
        },
      };
    }

    const icsText = await resp.text();

    const trimmed = icsText.trimStart().replace(/^\uFEFF/, "");
    // The Events Calendar's ?ical=1 export returns HTTP 200 with a 0-byte body
    // when a kennel has no upcoming events (ICH3 #1753). Treat that as an
    // empty-success rather than a hard failure when the source opts in.
    if (trimmed === "" && allowEmptyBody) {
      return { icsText: "", contentType };
    }
    if (!trimmed.startsWith("BEGIN:VCALENDAR")) {
      const preview = icsText.substring(0, 200).replace(/\n/g, "\\n");
      const message = `Response is not valid ICS (content-type: ${contentType ?? "unknown"}, starts with: "${preview}")`;
      return {
        error: {
          events: [], errors: [message],
          errorDetails: { fetch: [{ url, message }] },
          diagnosticContext: icalDiagnostics({ url, fetchDurationMs: Date.now() - fetchStart, icsBytes: icsText.length, contentType, bodyPreview: preview }),
        },
      };
    }

    return { icsText, contentType };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: {
        events: [], errors: [`iCal fetch error: ${message}`],
        errorDetails: { fetch: [{ url, message }] },
        diagnosticContext: icalDiagnostics({ url, fetchDurationMs: Date.now() - fetchStart }),
      },
    };
  }
}

/** Parse ICS text into a calendar object. Returns the calendar or an error result. */
function parseIcsCalendar(
  icsText: string,
  url: string,
  fetchDurationMs: number,
  contentType: string | undefined,
): { calendar: ReturnType<typeof icalSync.parseICS> } | { error: ScrapeResult } {
  // An allowed empty body (ICH3 #1753) parses to an empty calendar — no VEVENTs,
  // no error. Short-circuit so we never depend on node-ical's empty-input behavior.
  if (icsText === "") return { calendar: {} };
  try {
    return { calendar: icalSync.parseICS(icsText) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: {
        events: [], errors: [`iCal parse error: ${message}`],
        errorDetails: { parse: [{ row: 0, error: message }] },
        diagnosticContext: icalDiagnostics({ url, fetchDurationMs, icsBytes: icsText.length, contentType }),
      },
    };
  }
}

/**
 * Resolve a locationUrl from GEO field, description Maps URL, a maps-shaped
 * event URL property, or a location-name search — most precise first. An exact
 * map pin (`eventMapUrl`, e.g. hashnyc's `URL:https://maps.app.goo.gl/…`) beats
 * the name-search fallback, which is why it's threaded through here rather than
 * left in `sourceUrl`.
 */
function resolveLocationUrl(
  geo: VEvent["geo"],
  location: string | undefined,
  description: string | undefined,
  eventMapUrl?: string,
): string | undefined {
  if (geo) {
    const { lat, lon } = geo;
    if (lat != null && lon != null) {
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    }
  }
  if (description) {
    const descUrl = extractMapsUrlFromDescription(description);
    if (descUrl) return descUrl;
  }
  if (eventMapUrl) return eventMapUrl;
  if (location) return mapsUrl(location);
  return undefined;
}

/** Build a RawEventData from a VEvent. Returns null if the event should be skipped. */
function buildRawEventFromVEvent(
  vevent: VEvent,
  config: ICalSourceConfig | null,
  compiledHarePatterns?: RegExp[],
  compiledRunNumberPatterns?: RegExp[],
  compiledTitleHarePattern?: RegExp,
  compiledLocationPatterns?: RegExp[],
  compiledCostPatterns?: RegExp[],
): RawEventData | null {
  if (vevent.status === "CANCELLED") return null;

  const summary = paramValue(vevent.summary);
  if (!summary) return null;
  if (!vevent.start) return null;

  const parsed = parseICalSummary(
    summary,
    config?.kennelPatterns,
    config?.defaultKennelTag,
    config?.keepNonKennelTitlePrefix,
  );

  // #2355 Stockholm HHH: on a shared multi-series feed, an event matching no
  // kennelPattern must be dropped, not routed to defaultKennelTag — otherwise
  // every untracked series (BASH, SPOR&DIC, LYH3…) welds onto SUH3.
  if (config?.strictKennelRouting && !parsed.matchedPattern) return null;

  // Computed once and reused across the run-number, junk-time, and title
  // branches below (the summary doesn't change within this event).
  const hasPlaceholderRun = hasPlaceholderRunNumber(summary);

  const dateStr = formatDate(vevent.start);
  // Tri-state: `undefined` = preserve, `null` = explicit clear (merge.ts only
  // writes startTime/endTime when the field is not `undefined`).
  let startTime: string | null | undefined = formatTime(vevent.start);
  // endTime is HH:MM only, so cross-date DTEND values (overnight runs) are dropped.
  const endDt = vevent.end as DateWithTimeZone | undefined;
  let endTime: string | null | undefined = endDt && formatDate(endDt) === dateStr ? formatTime(endDt) : undefined;
  // endDate (#1560) — populated only for multi-day ALL-DAY VEVENTs (DTSTART
  // and DTEND both VALUE=DATE, spanning >1 day). RFC 5545 makes all-day DTEND
  // exclusive (an event May 14–17 has DTEND=May 18), so the inclusive last day
  // is DTEND minus one day. Timed events that just cross midnight (overnight
  // trails) are deliberately excluded — they're single-day events with a late
  // end, not multi-day campouts.
  let endDate: string | undefined;
  if (endDt && (vevent.start as DateWithTimeZone).dateOnly && endDt.dateOnly) {
    const startMs = (vevent.start as DateWithTimeZone).getTime();
    const endMs = endDt.getTime();
    const DAY_MS = 86_400_000;
    if (endMs - startMs > DAY_MS + 60_000) {
      const inclusiveEnd = new Date(endMs - DAY_MS) as DateWithTimeZone;
      // Preserve dateOnly flag so formatDate takes the dateOnly branch.
      (inclusiveEnd as { dateOnly?: boolean }).dateOnly = true;
      endDate = formatDate(inclusiveEnd);
    }
  }
  const description = paramValue(vevent.description);
  let hares = description ? extractHaresFromDescription(description, compiledHarePatterns) : undefined;
  // Track whether the hare came from the SUMMARY (titleHarePattern) vs the
  // description — the #2160 title-is-hare suppression below only fires for
  // title-sourced hares, so a description hare can never blank a real theme.
  let hareFromTitle = false;

  // Fall back to extracting hares from title when description has none
  if (!hares && compiledTitleHarePattern) {
    const titleMatch = compiledTitleHarePattern.exec(summary);
    if (titleMatch?.[1]) {
      const candidate = titleMatch[1].trim();
      // Opt-in (#2004 Perth): reject a bare event-type theme ("West Coast 4
      // seasons run") whose capture ends in a run/walk/ride-style word. Gated
      // by `rejectTitleHareThemeSuffix` so other titleHarePattern sources —
      // whose hares could legitimately end in such a word — are untouched.
      const isTheme = config?.rejectTitleHareThemeSuffix === true && TITLE_HARE_THEME_SUFFIX_RE.test(candidate);
      hares = candidate && !isTheme ? candidate : undefined;
      if (hares) hareFromTitle = true;
    }
  }

  // Tri-state: `undefined` = preserve, `null` = explicit clear (merge.ts #1516).
  // A placeholder LOCATION ("TBD") is the source actively saying "no venue yet",
  // so emit `null` to wipe a stale venue — the description fallback below still
  // runs (null is falsy) and overwrites it when a real venue is present.
  let location: string | null | undefined = paramValue(vevent.location);
  if (location && isPlaceholder(location)) {
    location = null;
  }

  if (!location && description) {
    const rawDescLocation = extractLocationFromDescription(description, compiledLocationPatterns)
      ?? extractOnOnVenueFromDescription(description);
    // #2159 Charm City: scrub a DESCRIPTION-derived venue (trailing labels,
    // URLs, CTA residue) and reject placeholders. Opt-in so other feeds' venue
    // paths are untouched. cleanLocationName's `null` (a "Location\nTBD" venue)
    // is preserved as an explicit clear. Only overwrite when a venue line
    // actually matched — otherwise leave `location` as the prior value (a `null`
    // clear from a placeholder LOCATION, or `undefined` = preserve).
    if (rawDescLocation) {
      location = config?.cleanDescriptionLocation ? cleanLocationName(rawDescLocation) : rawDescLocation;
    }
  }

  // A URL property that is itself a Google Maps link (hashnyc.com's feed) is a
  // map pin, not an event page — route it to locationUrl and keep it out of
  // sourceUrl. Real event-page URLs (EBH3 `URL:https://www.ebh3.com/runs/…`)
  // don't match, so their sourceUrl behavior is unchanged.
  const eventUrl = paramValue(vevent.url) ?? undefined;
  const eventUrlIsMap = eventUrl ? MAPS_URL_PATTERN.test(eventUrl) : false;
  const locationUrl = resolveLocationUrl(
    vevent.geo,
    location ?? undefined,
    description,
    eventUrlIsMap ? eventUrl : undefined,
  );

  // Run number: prefer the shared `#`-delimited summary extraction (parsed),
  // then custom patterns.
  let runNumber: number | null | undefined = parsed.runNumber;
  // A placeholder marker ("OH3 #20xx", "#TBD") must emit an explicit null clear
  // so the merge tri-state wipes a stale runNumber from a prior scrape rather
  // than preserving it via undefined (#1824). extractHashRunNumber already
  // rejects "#20xx" (delimiter guard); the explicit clear has to take
  // precedence over the custom summary scan below, otherwise a loose custom
  // pattern ("^Run #?(\d+)") would parse the "20" out of "Run #20xx" and
  // defeat the clear.
  if (runNumber == null && hasPlaceholderRun) {
    runNumber = null;
  } else if (runNumber == null && compiledRunNumberPatterns?.length) {
    // #2003 Perth publishes "Run NNNN" (no `#`) in the SUMMARY, so scan the
    // summary with the custom patterns before the description.
    runNumber =
      extractRunNumberFromDescription(summary, compiledRunNumberPatterns) ??
      (description ? extractRunNumberFromDescription(description, compiledRunNumberPatterns) : undefined);
  }

  const cost = description ? extractCostFromDescription(description, compiledCostPatterns) : undefined;

  // #2175 Charm City: a `#TBD` placeholder run carries a junk late-night DTSTART
  // (03:02) the hare entered before the trail was scheduled. Drop the time when
  // all three signals fire — opt-in flag + placeholder run + improbable window —
  // so a confirmed-run late/early trail (or another feed's placeholder event at
  // a real late time) keeps its time.
  if (config?.dropImprobablePlaceholderTime && hasPlaceholderRun && isImprobableHashTime(startTime)) {
    // `null` (not `undefined`) so the merge tri-state wipes a junk time already
    // persisted on an existing row, instead of preserving it (#2175).
    startTime = null;
    endTime = null;
  }

  // A summary that is only kennel + an unconfirmed-run placeholder ("RH3: #120?")
  // has no real title — leave it undefined so the merge pipeline synthesizes a
  // default rather than surfacing the marker (#1785).
  let title = parsed.title ?? (hasPlaceholderRun ? undefined : summary);
  // #2148 Reading / #2160 ICH3: strip a leading kennel label + run marker the
  // source bakes into the title ("RH3: #1203:", "ICH3# 60"). Opt-in per source.
  if (title && config?.titleStripPrefixAliases?.length) {
    title = stripTitleKennelRunPrefix(title, config.titleStripPrefixAliases);
  }
  // #2216 Charm City — when the hare was pulled from the SUMMARY via
  // `titleHarePattern`, the matched "~ <hares>" suffix is still embedded in the
  // title ("CCH3# TBD~ MoreMen Pukes Tonight"). Strip it so the hares don't
  // appear in both `title` and `haresText`. Opt-in (`stripTitleHareSuffix`):
  // CCH3's pattern is a suffix match, but full-line patterns (Perth's
  // "^Run N - hares") would blank the entire title, so other sources are left
  // untouched. Also gated on `hareFromTitle`, so a rejected theme suffix
  // (rejectTitleHareThemeSuffix) keeps its full title. Empty remainder falls
  // back to `undefined` so merge synthesizes "<Kennel> Trail #N".
  if (config?.stripTitleHareSuffix && hareFromTitle && title && compiledTitleHarePattern) {
    title = title.replace(compiledTitleHarePattern, "").trim() || undefined;
  }
  // #2160 hard rule — the title must NEVER be the hare name. When the hare was
  // pulled from the SUMMARY (titleHarePattern) and the stripped title is just
  // that hare (ICH3 "ICH3# 60 Plea Barkin" → title "Plea Barkin" == hare), drop
  // the title so merge synthesizes "<Kennel> Trail #N" instead.
  if (hareFromTitle && title && hares && eqTrimLc(title, hares)) {
    title = undefined;
  }
  // #2316 hard rule — the title must NEVER be the venue. Oslo "OH3: Ommen" has
  // title "Ommen" == location "Ommen"; drop the title so merge synthesizes the
  // default and the venue still renders from `location`.
  if (title && location && eqTrimLc(title, location)) {
    title = undefined;
  }

  return {
    date: dateStr,
    kennelTags: [parsed.kennelTag],
    runNumber,
    title,
    description: appendDescriptionSuffix(description?.substring(0, 2000) || undefined, config?.descriptionSuffix),
    hares,
    location,
    locationUrl,
    startTime,
    endTime,
    cost,
    sourceUrl: eventUrlIsMap ? undefined : eventUrl,
    endDate,
  };
}

/** Build diagnostic context string for a VEvent parse error. */
function buildICalDiagnosticContext(vevent: VEvent): { rawText: string; summary: string } {
  const summary = paramValue(vevent.summary) ?? "unknown";
  const rawParts = [`Summary: ${summary}`];
  if (vevent.description) rawParts.push(`Description: ${paramValue(vevent.description) ?? ""}`);
  if (vevent.location) rawParts.push(`Location: ${paramValue(vevent.location) ?? ""}`);
  if (vevent.start) rawParts.push(`Start: ${String(vevent.start)}`);
  return { rawText: rawParts.join("\n").slice(0, 2000), summary };
}

const RUNS_ENDPOINT_RE = /\/runs\/\d+/i;
const EVENTS_ENDPOINT_RE = /\/events\/\d+/i;

/**
 * Collapse cross-endpoint duplicates within a single feed (#1828).
 *
 * Oslo H3 publishes the same run twice in calendar.ics: a timed `/runs/{m}`
 * VEVENT (has the start time, the "#NNNN" run number, and a title) and an
 * all-day `/events/{n}` VEVENT (no time/number, but a richer description and
 * the authoritative hares). Keyed on `kennelTag|date`, each `/events/` entry
 * that shares a date with a `/runs/` twin enriches that twin in place
 * (hares/description/cost/location win from the events listing) and is dropped;
 * standalone `/events/` entries with no run twin are kept untouched.
 */
export function coalesceEndpointDuplicates(events: RawEventData[]): RawEventData[] {
  const runByKey = new Map<string, RawEventData>();
  for (const e of events) {
    if (e.sourceUrl && RUNS_ENDPOINT_RE.test(e.sourceUrl)) {
      const key = `${e.kennelTags.join(",")}|${e.date}`;
      if (!runByKey.has(key)) runByKey.set(key, e);
    }
  }
  if (runByKey.size === 0) return events;

  const dropped = new Set<RawEventData>();
  for (const e of events) {
    if (!e.sourceUrl || !EVENTS_ENDPOINT_RE.test(e.sourceUrl)) continue;
    const twin = runByKey.get(`${e.kennelTags.join(",")}|${e.date}`);
    if (!twin) continue; // standalone special event — no run duplicate to merge
    if (e.hares) twin.hares = e.hares;
    if (e.description) twin.description = e.description;
    if (e.cost) twin.cost = e.cost;
    if (e.location) twin.location = e.location;
    // Preserve the events/ map link independently of the venue name: the twin
    // can carry a Maps URL parsed from its description with no location name, so
    // a name-gated copy would silently drop the only link.
    if (e.locationUrl) twin.locationUrl = e.locationUrl;
    dropped.add(e);
  }
  return dropped.size > 0 ? events.filter((e) => !dropped.has(e)) : events;
}

/** iCal feed adapter. Parses .ics feeds using node-ical, supports kennel pattern matching and multi-kennel feeds. */
export class ICalAdapter implements SourceAdapter {
  type = "ICAL_FEED" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    // Honor options.days so admin one-shot wide-window scrapes
    // (e.g. ICH3 #1339 historical recovery) actually pick up past events.
    // CRITICAL: scrapeSource() passes the same `days` to both fetch and
    // reconcileStaleEvents — if fetch caps narrower than reconcile, reconcile
    // would cancel every event in the gap as "missing from scrape". Falls
    // back to source.scrapeDays then 90 (preserving prior default).
    const days = options?.days ?? source.scrapeDays ?? 90;
    const lookbackDays = days;
    const lookforwardDays = options?.days ?? source.scrapeDays ?? 365;
    const fetchStart = Date.now();

    const now = new Date();
    const minDate = new Date(now.getTime() - lookbackDays * 86_400_000);
    const maxDate = new Date(now.getTime() + lookforwardDays * 86_400_000);

    const config = (source.config && typeof source.config === "object" && !Array.isArray(source.config))
      ? source.config as ICalSourceConfig
      : null;

    // Step 1: Fetch the ICS content
    const fetchResult = await fetchAndValidateIcsContent(source.url, fetchStart, config?.allowEmptyBody ?? false);
    if ("error" in fetchResult) return fetchResult.error;

    const { icsText, contentType } = fetchResult;
    const fetchDurationMs = Date.now() - fetchStart;

    // Step 2: Parse the ICS content
    const parseResult = parseIcsCalendar(icsText, source.url, fetchDurationMs, contentType);
    if ("error" in parseResult) return parseResult.error;

    const { calendar } = parseResult;

    // Step 3: Process VEVENT entries
    const skipPatterns = config?.skipPatterns?.length
      ? compilePatterns(config.skipPatterns, "i")
      : undefined;
    const compiledHarePatterns = config?.harePatterns?.length
      ? compilePatterns(config.harePatterns)
      : undefined;
    const compiledRunNumberPatterns = config?.runNumberPatterns?.length
      ? compilePatterns(config.runNumberPatterns)
      : undefined;
    const compiledLocationPatterns = config?.locationPatterns?.length
      ? compilePatterns(config.locationPatterns)
      : undefined;
    const compiledCostPatterns = config?.costPatterns?.length
      ? compilePatterns(config.costPatterns)
      : undefined;
    const compiledTitleHarePattern = config?.titleHarePattern
      ? compilePatterns([config.titleHarePattern], "i")[0]
      : undefined;

    let events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let totalVEvents = 0;
    let skippedDateRange = 0;
    let skippedPattern = 0;
    let eventIndex = 0;
    const parseErrors: ParseError[] = [];

    for (const key of Object.keys(calendar)) {
      const component = calendar[key];
      if (!component || typeof component !== "object" || !("type" in component)) continue;
      if (component.type !== "VEVENT") continue;

      const vevent = component as VEvent;
      totalVEvents++;
      eventIndex++;

      try {
        const summary = paramValue(vevent.summary);
        if (!summary) continue;
        if (vevent.status === "CANCELLED") continue;

        if (skipPatterns?.some((p) => p.test(summary))) {
          skippedPattern++;
          continue;
        }

        if (!vevent.start) continue;
        if (vevent.start < minDate || vevent.start > maxDate) {
          skippedDateRange++;
          continue;
        }

        const event = buildRawEventFromVEvent(vevent, config, compiledHarePatterns, compiledRunNumberPatterns, compiledTitleHarePattern, compiledLocationPatterns, compiledCostPatterns);
        if (event) events.push(event);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const diag = buildICalDiagnosticContext(vevent);
        errors.push(`Event parse error (${diag.summary}): ${message}`);
        parseErrors.push({
          row: eventIndex,
          section: "vevent",
          error: message,
          rawText: diag.rawText,
          partialData: {
            kennelTags: [diag.summary],
            date: vevent.start ? formatDate(vevent.start) : undefined,
          },
        });
      }
    }

    if (parseErrors.length > 0) {
      errorDetails.parse = parseErrors;
    }

    // Oslo H3 (#1828): the same run lands on both /runs/ and /events/ — collapse
    // the all-day events/ duplicate into its timed runs/ twin before merge sees
    // two RawEvents for one trail. No-op for feeds without both endpoint shapes.
    if (config?.coalesceEndpointDuplicates) {
      events = coalesceEndpointDuplicates(events);
    }

    // SFH3 publishes multi-day campouts as a /events/{n} umbrella VEVENT plus
    // per-day /runs/{m} trail VEVENTs. Mark series membership in place
    // (#1560 — replaces the pre-existing umbrella-suppression hack from
    // #1421). The umbrella becomes the series parent so its rich description
    // (theme, registration, lodging) lands on the canonical parent Event;
    // trails fall under it via parentEventId after merge.
    // No-op for feeds without sfh3.com/events URLs, so unconditional is safe.
    markSFH3SeriesMembership(events);

    // SFH3-specific enrichment: the .ics SUMMARY omits "Run" and has no Comment
    // field. Pull the canonical title + Comment from /runs/{id} so the merge
    // pipeline has enriched values on both the iCal and HTML_SCRAPER RawEvents
    // and whichever source wins ends up correct.
    let enrichmentEnriched: number | undefined;
    let enrichmentFailures: number | undefined;
    if (config?.enrichSFH3Details) {
      const enrichResult = await enrichSFH3Events(events, { now: new Date(fetchStart) });
      enrichmentEnriched = enrichResult.enriched;
      enrichmentFailures = enrichResult.failures.length;
      if (enrichResult.failures.length > 0) {
        errorDetails.fetch ??= [];
        for (const failure of enrichResult.failures) {
          errorDetails.fetch.push({ url: failure.url, message: failure.message });
        }
        // Single summary line in `errors` — per-fetch details live in errorDetails.fetch
        // and the count is in diagnosticContext.enrichmentFailures.
        errors.push(`enrichment: ${enrichResult.failures.length} detail-page fetch(es) failed`);
      }
    }

    // Berlin H3 enrichment: the .ics DESCRIPTION lacks structured Hares — the
    // wp-event-manager event page has them as <strong>Hares -</strong> {name}.
    if (config?.enrichBerlinH3Details) {
      const enrichResult = await enrichBerlinH3Events(events, { now: new Date(fetchStart) });
      enrichmentEnriched = (enrichmentEnriched ?? 0) + enrichResult.enriched;
      enrichmentFailures = (enrichmentFailures ?? 0) + enrichResult.failures.length;
      if (enrichResult.failures.length > 0) {
        errorDetails.fetch ??= [];
        for (const failure of enrichResult.failures) {
          errorDetails.fetch.push({ url: failure.url, message: failure.message });
        }
        errors.push(`berlin-h3 enrichment: ${enrichResult.failures.length} detail-page fetch(es) failed`);
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        url: source.url,
        totalVEvents,
        eventsExtracted: events.length,
        skippedDateRange,
        skippedPattern,
        fetchDurationMs,
        icsBytes: icsText.length,
        contentType,
        ...(enrichmentEnriched !== undefined && { enrichmentEnriched }),
        ...(enrichmentFailures !== undefined && { enrichmentFailures }),
      },
    };
  }
}
