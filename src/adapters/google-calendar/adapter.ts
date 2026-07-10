import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { googleMapsSearchUrl, decodeEntities, stripHtmlTags, compilePatterns, EVENT_FIELD_LABEL_RE, EVENT_FIELD_LABEL_UPPERCASE_RE, CTA_EMBEDDED_PATTERNS, appendDescriptionSuffix, dedupeRepeatedDescription, isPlaceholder, parse12HourTime, formatAmPmTime, stripNonEnglishCountry, extractHashRunNumber, hasPlaceholderRunNumber, isThemelessPlaceholderTitle, normalizeCostSigil, BARE_KENNEL_CODE_RE } from "../utils";
import { matchKennelPatterns, matchCompiledKennelPatterns, compileKennelPatterns, type KennelPattern, type CompiledKennelPattern } from "../kennel-patterns";
import { LOCATION_EMAIL_CTA_RE } from "@/pipeline/audit-checks";
import { parseDMSFromLocation } from "@/lib/geo";
import { extractHares, PHONE_TRAILING_RE, cleanAndFilterHares } from "../hare-extraction";
import { MEDICAL_SKIP_RES } from "../skip-rules";

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
 * Leading "Hash NNNN:" run marker that omits the `#` (#2007 PGH H3 — "Hash
 * 2188: Squirreleo"). Colon-anchored so it stays tight: a bare year in prose
 * ("Hash 2024 was great") has no trailing colon and won't match. The `#` is
 * tolerated but optional; the `#`-prefixed variant still routes through the
 * shared `extractHashRunNumber` delimiter guard first.
 *
 * Known limitation: a year-labeled admin title in the exact "Hash YYYY: <text>"
 * shape ("Hash 2026: AGM") would parse the year as a run number. This matcher
 * is global (PGH's source row is owned by a parallel workstream and can't carry
 * per-source config), so the shape can't be scoped to PGH. The collision is
 * rare in practice — kennels overwhelmingly use "#" for run numbers — and the
 * blast radius is one spurious runNumber on an otherwise-correct event.
 */
const LEADING_HASH_WORD_RE = /^Hash\s+(?:#\s*)?(\d{2,})\s*:/i;

/**
 * Leading "Trail NNN:" run marker that omits the `#` (#2184 Reno H3 — "Trail
 * 802: Sir Rubs a lot's short n sweet trail"). Reno's dominant title form, but
 * the parser only saw the `#NN` shape, so every "Trail NNN" event extracted no
 * run number. Colon-anchored and start-anchored — the same tight shape as
 * LEADING_HASH_WORD_RE — so it stays additive across the ~40 GCal sources: only
 * a title that literally starts with "Trail NNN:" matches. The trailing
 * `(?!\d)` rejects a clock time ("Trail 10:00 AM …") — the colon there is a
 * time separator, not the run-number delimiter — so the global pattern can't
 * mine an hour as a run number. The `#`-prefixed variants ("Trail #802:",
 * "Sloppy Trail #46") already resolve through the shared `extractHashRunNumber`
 * delimiter guard before this is reached.
 */
const LEADING_TRAIL_WORD_RE = /^Trail\s+(?:#\s*)?(\d{2,})\s*:(?!\d)/i;

/** Run the capture-group-1 digits of a leading-word run-number regex (e.g.
 *  LEADING_HASH_WORD_RE / LEADING_TRAIL_WORD_RE) against `summary`, returning the
 *  positive integer or `undefined`. */
function matchLeadingWordRunNumber(re: RegExp, summary: string): number | undefined {
  const m = re.exec(summary);
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

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
  summaryPatterns?: string[] | RegExp[],
): number | null | undefined {
  // 1. Check summary first (e.g., "Beantown #255: ...", "BH3: ... #2781", "Cunth # 40: ...").
  // Shared `extractHashRunNumber` enforces the delimiter guard (#1147) — "#30X?"
  // rejects rather than parsing as 30. The fallback re-runs the same parser with
  // "!" normalized to whitespace so a bang-terminated run number ("PH4 - #1269!",
  // and the numerology "#1322 Centum!" titles) still parses — "!" isn't in the
  // shared lookahead delimiter set (utils.ts is read-only) (#2089). Normalizing
  // "!"→space only helps the lookahead; it can't manufacture a number where the
  // first pass already saw a clean run, and "#30X?" still falls through to the
  // placeholder check below.
  const fromSummary = extractHashRunNumber(summary)
    ?? (summary.includes("!") ? extractHashRunNumber(summary.replaceAll("!", " ")) : undefined);
  if (fromSummary !== undefined) return fromSummary;

  // 1a. Per-source SUMMARY run-number patterns (#2349 Stuttgart "SH3 871"): only
  // reached when the shared `#`-delimited parser found nothing, so a `#`-style
  // number always wins. Anchored, capture-group patterns from source config.
  if (summaryPatterns?.length) {
    const fromSummaryPattern = extractRunNumberFromDescription(summary, summaryPatterns);
    if (fromSummaryPattern !== undefined) return fromSummaryPattern;
  }

  // 1b/1c. Leading "<word> NNNN:" run markers that omit the `#`, colon-anchored
  // so a year-shaped digit run in prose can't false-match: "Hash NNNN:" (#2007
  // PGH H3) and "Trail NNN:" (#2184 Reno H3).
  const fromLeadingWord =
    matchLeadingWordRunNumber(LEADING_HASH_WORD_RE, summary)
    ?? matchLeadingWordRunNumber(LEADING_TRAIL_WORD_RE, summary);
  if (fromLeadingWord !== undefined) return fromLeadingWord;

  // 2. Summary placeholder takes precedence over description fallback. A
  // partial retitle (`#30: …` → `#30X?: …` while description still says
  // "#30") would otherwise let the stale description number reassert
  // itself and re-anchor the cleared run on the next merge.
  if (hasPlaceholderRunNumber(summary)) return null;

  // 3. Dark / cancelled notices ("N2H3 is Dark", "N2H3 DARK", "No hash this
  // week") carry no run. Emit null (explicit clear) so a stale number from a
  // prior occurrence in the same RRULE series can't bleed onto the notice row
  // (#1717). Narrow by design — see DARK_NOTICE_RE / BARE_DARK_RE.
  if (DARK_NOTICE_RE.test(summary) || BARE_DARK_RE.test(summary)) return null;

  // 4. Fall back to description patterns
  return description
    ? extractRunNumberFromDescription(description, customPatterns)
    : undefined;
}

/**
 * Unambiguous "the run is off this week" phrasing. Whole-word, and the set is
 * deliberately tight — "no run"/"no trail" were dropped because they over-match
 * real titles ("No Trail Left Behind Hash"). Used by extractRunNumber to clear
 * (not preserve) a run number on notice rows (#1717).
 */
const DARK_NOTICE_RE = /\bis\s+dark\b|\bno\s+hash\b|\bcancell?ed\b/i;

/**
 * The bare "<kennel> DARK" form (live N2H3 summary). Case-SENSITIVE all-caps
 * DARK + single-token prefix so mixed-case themed titles like "Glow Run After
 * Dark" or "Dark Side of the Moon Hash" never trip it.
 */
const BARE_DARK_RE = /^\S+\s+DARK[\s!.]*$/;

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

// #1787 Capital H3 — strip a leading "Run #NNNN" token plus a "Public
// Holiday" boilerplate phrase from an all-day run descriptor, leaving just
// the theme. Each regex uses a single char-class / `\s+` run with no
// alternation adjacency, so Sonar S5852/S5843 read them as linear.
const RUN_DESCRIPTOR_PREFIX_RE = /^\s*Run\b[\s#:]*\d+\s*/i;
const PUBLIC_HOLIDAY_BOILERPLATE_RE = /\bPublic\s+Holiday\b/i;
// Leading / trailing delimiters stripped as two separate anchored single
// char-class passes — a combined `^X+|X+$` alternation trips Sonar S5852.
const DESCRIPTOR_LEADING_DELIMS_RE = /^[\s\-–—:.]+/;
const DESCRIPTOR_TRAILING_DELIMS_RE = /[\s\-–—:.]+$/;
export function extractRunDescriptorTheme(summary: string): string {
  let theme = summary.replace(RUN_DESCRIPTOR_PREFIX_RE, "");
  theme = theme.replace(PUBLIC_HOLIDAY_BOILERPLATE_RE, "");
  theme = theme.replace(DESCRIPTOR_LEADING_DELIMS_RE, "").replace(DESCRIPTOR_TRAILING_DELIMS_RE, "");
  return theme.trim();
}

/** #1787 — split a Capital H3 timed-event summary into hare (+ optional
 *  location). The summary is the hare name, optionally "Hare - Location".
 *  Pure `indexOf`/`slice` (no regex) — ReDoS N/A. */
export function splitTimedSummaryHareLocation(title: string): { hare: string; location?: string } {
  const i = title.indexOf(" - ");
  if (i < 0) return { hare: title.trim() };
  return { hare: title.slice(0, i).trim(), location: title.slice(i + 3).trim() || undefined };
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
  // #1418 Aloha: "Ciara training" — proper-noun + personal activity word.
  // Case-sensitive `[A-Z][a-z]+` enforces the "proper noun" semantic so
  // bare lowercase summaries like "hash practice" or "trail class" never
  // match (Codex review). The activity-word alternation keeps `/i` so
  // mixed-case typos like "Practice" still register.
  /^\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:training|practice|lesson|class|workout|tutoring|rehearsal)\b/,
];

// Medical / telehealth appointment patterns (#1690 Houston PII) now live in
// the shared `skip-rules` module as MEDICAL_SKIP_RES (#1739), so per-source
// `silentlySkipPatterns` and this global heuristic share one definition. The
// gate below is unchanged: kept separate from PERSONAL_TITLE_PATTERNS because a
// real contributor adding their own medical appointment will type description
// prose; only runNumber / hares / the literal "hash" override (a real
// "Sleep Study Trail" with a hare still ingests).

/**
 * Non-hash domain markers (#1426). Pairing a sport with a game/practice
 * qualifier strongly suggests a non-hash sports event. Used together with
 * the runNumber/hares/hash-keyword gate at the call site — when ANY of
 * those three hash-confirming signals is present, the filter is skipped
 * (Codex review on this PR).
 *
 * Bare sport names ("Rugby") are deliberately NOT in this list — kennel
 * names and punning titles sometimes contain them. Always require the
 * qualifier pairing.
 */
const NON_HASH_DOMAIN_PATTERNS: readonly RegExp[] = [
  /\b(?:rugby|soccer|basketball|baseball|football|hockey|lacrosse|volleyball|tennis|cricket|softball)\s+(?:game|match|practice|tournament|league|scrimmage)\b/i,
];

/**
 * Title-level "hash" keyword. Used as a third hash-confirming signal when
 * the sport+qualifier filter would otherwise drop a themed hash event.
 *
 * Deliberately just the literal word `hash` — the original draft also
 * accepted `h3` / `h4` / `h5` / `hhh`, but those false-matched kennel-code
 * prefixes like `H4-TX: Soccer Practice` (Codex review). The `H4-TX`
 * prefix is so common across multi-kennel calendars that the false
 * positives outweighed the rare themed-hash titles using a bare
 * `H4`-style keyword.
 */
const HASH_KEYWORD_RE = /\bhash\b/i;

/**
 * #1632 — known synthetic-test / internal-admin titles that should never
 * surface as runs. Compared after stripping whitespace and `#` from a
 * lowercased summary so all the `Trail # Test Event` / `Trail #Test
 * Event` / `trail test event` variants collapse to the same key.
 * Deliberately Set-based, not a regex with `\s*` / `#?` adjacency —
 * Sonar S5852 flags those as ReDoS-shaped even for linear inputs
 * (see `feedback_sonar_s5852_procedural_over_regex`).
 *
 * MH3-MN's calendar carried `Trail # Test Event` (with `123 Fake St`
 * location) and `PC Meeting`; both were leaking through to
 * /kennels/mh3-mn before this filter landed.
 *
 * #1736 — a post-merge re-scrape recreated two leaks the equality check
 * missed, handled by two distinct match modes:
 *
 *   - PREFIX stems (`trailtestevent`, `pcmeeting`): the source pasted a
 *     multi-field admin blob into one SUMMARY (`Trail # Test Event Hare:
 *     L4 Location: 123Fake St…` → the whole blob appends past the stem, so
 *     exact equality failed but the `trailtestevent` lead still matches).
 *     These stems are admin-internal phrases that never lead a real run
 *     title, so `startsWith` is safe.
 *
 *   - EXACT titles (`mh3-mn`): an empty-SUMMARY row fell back to the
 *     literal kennelTag. This is matched by exact equality, NOT prefix —
 *     `mh3-mn` is the kennel's own tag, so a real title like `MH3-MN Red
 *     Dress Run` (normalizes to `mh3-mnreddress`) must NOT be dropped
 *     (Codex review). Only the bare fallback title is an artifact.
 */
const TEST_ARTIFACT_TITLE_PREFIXES = new Set([
  "trailtestevent",
  "pcmeeting",
]);

const TEST_ARTIFACT_TITLE_EXACT = new Set([
  "mh3-mn",
]);

function isTestArtifactTitle(summary: string): boolean {
  const normalized = summary.toLowerCase().replaceAll(/[\s#]+/g, "");
  if (TEST_ARTIFACT_TITLE_EXACT.has(normalized)) return true;
  for (const prefix of TEST_ARTIFACT_TITLE_PREFIXES) {
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * #1691 — kebab-case shape detector. Matches lowercase alphanumeric
 * strings with at least one hyphen and no spaces. This shape is
 * AMBIGUOUS by itself — both kennel URL slugs ("flour-city", "lvh3-cin")
 * and legitimate theme titles ("red-dress-run", "pre-lube", "hash-trash")
 * fit it. Callers MUST gate this check on a kennel-tag equivalence
 * (titleMatchesKennelTag) so only the slug case actually triggers
 * title clearing.
 */
const URL_SLUG_TITLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

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
// #1677 Moooouston: kennel admins use `**update**` / `**EDIT**` / `**note**`
// as "this got revised" markers at the top of descriptions. They render as
// literal markdown bolds when surfaced as a title. Reject any candidate whose
// non-marker payload is a single edit/update/note/notice token — same shape
// the FB ADMIN_NOTICE_PATTERNS handles for sentence-level admin posts.
// Anchored start/end + bounded payload length keeps backtracking linear.
const TITLE_MARKDOWN_ADMIN_MARKER_RE = /^\*{1,3}\s*(?:update|edit|note|notice)\s*\*{1,3}$/i;

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
// Decimal-degrees with cardinal letters (#1328 DeMon): `"42.34269 N, 83.0328069 W"`.
// Distinct from `LOCATION_COORDS_ONLY_RE` (signed decimals, no letters) and
// `LOCATION_DMS_ONLY_RE` (°'" symbols). Letters are mandatory here so signed
// decimals aren't double-handled.
const LOCATION_DECIMAL_CARDINAL_RE = /^\s*(\d{1,3}(?:\.\d+)?)\s*([NS]),?\s*(\d{1,3}(?:\.\d+)?)\s*([EW])\s*$/i;

/**
 * Parse a coord-only location string into structured lat/lng. Returns null
 * for anything that isn't a recognised coord format (decimal or DMS).
 *
 * Cheap structural prefilter rejects letter-leading addresses before the
 * regex engine traverses them — coord strings always start with digit, sign,
 * or whitespace.
 */
function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    (lat !== 0 || lng !== 0)
  );
}

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
    return isValidCoord(lat, lng) ? { lat, lng } : null;
  }
  // Decimal-with-cardinal-letters shape (#1328 DeMon: `"42.34269 N, 83.0328069 W"`).
  // Before falling through to DMS, parse the decimal-cardinal form so the
  // raw coord string clears `location` and description-fallback can surface
  // a human-readable address.
  const cardMatch = LOCATION_DECIMAL_CARDINAL_RE.exec(value);
  if (cardMatch) {
    const latSign = cardMatch[2].toUpperCase() === "S" ? -1 : 1;
    const lngSign = cardMatch[4].toUpperCase() === "W" ? -1 : 1;
    const lat = latSign * Number.parseFloat(cardMatch[1]);
    const lng = lngSign * Number.parseFloat(cardMatch[3]);
    return isValidCoord(lat, lng) ? { lat, lng } : null;
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
// `[ \t]*` after the colon (NOT `\s*`) keeps the value capture on the same
// line as the label; `\s*` would consume the trailing newline and grab the
// next line's content (#1129). `(.*)` (NOT `(.+)`) matches the empty-value
// shape so `extractLocationFromDescription` can discard it explicitly rather
// than relying on a silent no-match.
const LOCATION_LABEL_RE = new RegExp(
  String.raw`(?:^|\n)\s*(?:${LOCATION_LABEL_TOKENS.join("|")})[ \t]*:[ \t]*(.*)`,
  "im",
);
// Fallback: bare label (with optional trailing colon) on a line by itself,
// value on the subsequent non-empty line — covers both `WHERE\n<addr>` and
// `WHERE:\n<addr>` (#1328 DeMon). Uses `[ \t]*` for intra-line whitespace and
// explicit `\n` boundaries to keep the regex linear (no overlapping `\s*` runs
// that span newlines, which Sonar S5852 flags as super-linear). The trailing
// `:?` is the one-character extension; the capture-rejection filter at line
// 406 (`isNonAddressText`) still kicks in if the captured value is a sibling
// label like `When: 5:69` (#1329).
// NOSONAR S5852 — `[ \t]*` runs are bounded by explicit `\n` boundaries
// (not `\s*`, deliberately), so backtracking can't span across newlines.
// The trailing `:?` is the one-character #1328 extension; pattern stays linear.
const LOCATION_BARE_LABEL_RE = /(?:^|\n)[ \t]*(?:WHERE|LOCATION)[ \t]*:?[ \t]*\n(?:[ \t]*https?:\/\/\S+[ \t]*\n)?[ \t]*(\S.*)/im; // NOSONAR
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
// #1999 BAH3: a Start: venue can carry a trailing "(lat, lng)" parenthetical
// ("Park in Branch Ave Metro (38.82…, -76.91…)"). Strip the trailing coord
// pair so the display name is the venue; the coords are captured separately by
// the structured/coord-only paths. Anchored to end-of-string — leading bare
// coords (KAW!H3 "30.29, -97.77, the corner of…") are untouched.
const TRAILING_COORD_PAREN_RE = /\s*\(\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*\)\s*$/; // NOSONAR — anchored to `$`, single-class \s quantifiers, no alternation
/** Google Maps short/full URL pattern — used to preserve Maps links as locationUrl for geocoding. */
const MAPS_URL_RE = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.\w+\/maps)\//i;

// Pre-compiled regex for extractTimeFromDescription
const TIME_LABEL_RE = /(?:^|\n)\s*(?:Pack\s*Meet|Circle|Time|Start|When|Chalk\s*Talk)\s*:?\s*.*?(\d{1,2}:\d{2}\s*[ap]m)/im;
// "go" time (#1775): NOH3 (and other kennels) publish "6pm show, 6:30pm go" in
// the description body — the "go" time is the actual start. Capture the time
// immediately preceding the literal "go" so it wins over the "show" time and
// over a `Start: TBA` label that carries no concrete location. Mirrors the
// optional-`:MM` shape of TITLE_TIME_RE (bare "7pm go" and "6:30pm go" both).
// "go" must end its clause — followed by punctuation or end-of-line — so phrases
// like "8pm go home" / "5pm go-kart" don't promote a non-start time (CodeRabbit
// review). NOH3's real form "6:30pm go. $8 hash cash" matches via the "go." case.
const GO_TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+go(?:[.!?,;:]|\s*$)/i;
// 12-hour times in titles. Optional `:MM` so both "6pm" and "7:30pm" match.
// `:30` capture group is undefined for the bare form.
const TITLE_TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;

// Pre-compiled regexes for title-embedded field extraction
// Only matches "w/" abbreviation (not "with") to avoid false positives on natural language titles
const TITLE_W_HARE_LOCATION_RE = / w\/ (.+?) - (.+)$/i;
const TITLE_TRAILING_PAREN_RE = /\s*\(([^)]+)\)$/;
const INSTRUCTIONAL_PAREN_RE = /\b(?:posted|website|email|check|details|usually|info)\b/i;
/**
 * Reject parentheticals that look descriptive rather than name-like
 * (e.g. "(A to B)", "(No Dogs)"). Extended in #1444 with status words
 * ("(canceled)", "(postponed)") that were slipping through and being
 * stored as hare names.
 */
const NON_NAME_PAREN_RE = /\b(?:to|from|no|not|only|all|free|via|and back|cancel(?:l?ed)?|postponed)\b/i;
/**
 * Allowlist of acronym/numeric tokens that are CTAs or units, never hash
 * names: "(5K)", "(10K)", "(AM)", "(PM)", "(BYOB)", "(TBD)", "(TBA)",
 * "(TBC)", "(FYI)", "(NSFW)". The list is deliberately enumerated rather
 * than `[A-Z]{2,5}` (#1444 Codex review) — hashers DO use 2-3-char hash
 * names like "DJ", "MJ", "FBI", and a blanket all-caps reject would FN
 * them.
 */
const ACRONYM_PAREN_RE = /^(?:\d+\s*[a-z]{0,2}|AM|PM|BYOB|TBD|TBA|TBC|FYI|NSFW|DNF|DNS|RIP)$/i;
/**
 * Event-type / theme parentheticals that are never hare names: an event-type
 * combo like "(Run/Walk)" or "(Run / Walk / Bike)" (#2000 Dayton H4), a single
 * bare event-type word, or a theme ending in "trail" like "(Hangover trail)"
 * (#2008 PGH H3). Two separate anchored alternations keep each below the Sonar
 * S5843 regex-complexity threshold and avoid `\s*`-adjacent alternation.
 */
const EVENT_TYPE_PAREN_RE = /^(?:run|walk|jog|bike|ride|hike)(?:\s*[/&+]\s*(?:run|walk|jog|bike|ride|hike))*$/i; // NOSONAR — anchored, bounded literal alternation
// Lowercase final "trail" only (case-SENSITIVE): the leaked PGH theme is
// "(Hangover trail)" with a lowercase t. Title-Case hash names like "(Happy
// Trail)" / "(Snail Trail)" capitalize "Trail" and must survive as hares.
const THEME_TRAIL_PAREN_RE = /\btrail$/;
function isEventTypeOrThemeParen(inner: string): boolean {
  const t = inner.trim();
  return EVENT_TYPE_PAREN_RE.test(t) || THEME_TRAIL_PAREN_RE.test(t);
}
// #1547 ABQ: parenthetical date-range strings like "(Friday 5/22-Monday 5/25)"
// are multi-day campout date hints, not hare names. M/D digit pair is the
// reliable signal — real hare names never contain slash-separated date
// tokens. Mirrors the same DATE_RANGE_RE in hare-extraction.ts.
const DATE_RANGE_PAREN_RE = /\b\d{1,2}\s*\/\s*\d{1,2}\b/;
// #2235 SEH3: a trailing parenthetical venue qualifier — "(special location)",
// "(new location)", "(location TBD)" — is a location note, never a hare name.
// Treated as instructional so it's stripped from the title and never promoted
// to hares. Joins the same global reject family as NON_NAME / ACRONYM / etc.
const LOCATION_QUALIFIER_PAREN_RE = /\blocation\b/i;
const MAX_HARE_PAREN_LENGTH = 40;

/**
 * Narrow reject-gate applied wherever the adapter routes *title-derived* text
 * into `haresText`. Rejects only what is unambiguously NOT a hash name:
 * placeholders ("vacant", "TBD", "Hares Needed", …) and bare kennel-code
 * tokens. It deliberately has NO fuzzy theme/word-count/punctuation heuristic —
 * hash names are routinely multi-word, "&"/"and"/comma-joined, and exclamatory
 * (e.g. "Jaba the Slut & Stop, Drop, and Puke", "Just the Tip!"), so any such
 * heuristic would false-reject real names. Run themes that aren't hares (e.g.
 * EWH3 "Autism Speaks for Deities & Friends!") are kept out of `haresText` by
 * NOT configuring a `titleHarePattern` for that source, not by this gate.
 *
 * Not applied to description-derived hares (extractHares), which come from
 * explicit "Hare:" labels already filtered in hare-extraction.ts.
 */
export function looksLikeHareName(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isPlaceholder(t)) return false;
  if (BARE_KENNEL_CODE_RE.test(t)) return false;
  return true;
}

/**
 * A "this slot has no real value" token — used per-token inside a location
 * candidate. Deliberately NARROW (only vacancy markers), NOT the full
 * `isPlaceholder` vocabulary: that set includes ordinary venue words like
 * "volunteer"/"registration" which appear in real place names ("Volunteer
 * Park"). See the Codex review note on #1882.
 */
const VACANCY_TOKEN_RE = /^(?:vacant|tbd|tba|tbc|n\/a)$/i;

/**
 * True when any dash/whitespace-delimited token of `text` is a vacancy marker.
 * Rejects titleLocationPattern / merge captures like "3 - vacant" (#1882
 * Capital H3: the `(\d+\s+.+)` address pattern grabs the "3" out of
 * "CH3 - vacant") and "Location TBD" — which the anchored whole-string
 * `isPlaceholder` check misses — without dropping real multi-word venues.
 */
function containsPlaceholderToken(text: string): boolean {
  return text.split(/[\s–—-]+/).some((tok) => VACANCY_TOKEN_RE.test(tok));
}

/**
 * #1444 Larryville: detect "initials wordplay" parentheticals like
 * `LH3 #670 DP (dirtier pickle)` where the parenthetical is a punning
 * lowercase expansion of the uppercase token immediately preceding it.
 * The signal stack — uppercase initials + lowercase first letter +
 * matching first-letter sequence + matching word count — is highly
 * specific to wordplay; it leaves Title-Case hash names like
 * `JB (Just Bob)` and unrelated lowercase parens like `(banana boat)`
 * untouched.
 */
function isInitialsWordplay(title: string, inner: string, parenIndex: number): boolean {
  const beforeParen = title.slice(0, parenIndex).trim();
  // Walk backward to the last whitespace boundary instead of `/\S+$/` —
  // Sonar S5852 flags greedy `\S+` followed by an end anchor as a
  // potential ReDoS shape even though it's linear in practice.
  const lastSpace = Math.max(
    beforeParen.lastIndexOf(" "),
    beforeParen.lastIndexOf("\t"),
    beforeParen.lastIndexOf("\n"),
  );
  const initials = lastSpace >= 0 ? beforeParen.slice(lastSpace + 1) : beforeParen;
  if (!initials || !/^[A-Z]{2,5}$/.test(initials)) return false;
  const trimmedInner = inner.trim();
  if (!/^[a-z]/.test(trimmedInner)) return false;
  const innerWords = trimmedInner.split(/\s+/);
  if (innerWords.length !== initials.length) return false;
  const innerInitials = innerWords.map((w) => w[0]?.toLowerCase() ?? "").join("");
  return innerInitials === initials.toLowerCase();
}

/**
 * Minimum plausible hash-event title length. Below this, with no other
 * structured field, the summary is almost certainly a data-entry artifact
 * (e.g. #1303 Houston had a hare's initials "PC" typed into the summary).
 */
const MIN_PLAUSIBLE_HASH_TITLE_LEN = 3;

// Pre-compiled regexes for dash-separated title cleanup
/** " - Hare(s): Name" or " - Hare: Name" suffix in title */
const TITLE_DASH_HARE_RE = /\s+-\s+Hares?:\s*(.+)$/i;
/** " - Location TBD/TBA/TBC" suffix — strip and optionally extract preceding hare names */
const TITLE_DASH_LOCATION_TBD_RE = /^(.+?)\s+-\s+Location\s+(?:TBD|TBA|TBC)$/i;
/** "hared by Name" suffix in title (Voodoo H3 format) */
const TITLE_HARED_BY_RE = /\s+hared by\s+(.+)$/i;
/**
 * Trailing dangling hare label with no name ("…Walkers. Hare:" / "…Walkers.
 * Hare") — stripped only under `stripDanglingHareLabel` when no hare was
 * extracted (#2146 RDH3). The leading `\.` is required so a title that simply
 * ends in the word "Hare" (no period separator) is never truncated.
 * `(?::\s*)?` groups the colon+trailing-space as an atomic optional so the
 * two `\s*` on either side of `:?` are never adjacent (fixes ReDoS S5852). */
const TRAILING_EMPTY_HARE_LABEL_RE = /\s*\.\s*Hares?\s*(?::\s*)?$/i;
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
    // #1677: reject `**update**` / `**EDIT**` admin markers — they render
    // as literal markdown when surfaced as a title and never describe a trail.
    if (TITLE_MARKDOWN_ADMIN_MARKER_RE.test(text)) continue;
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
  // Discard whitespace-only `Where:` captures so multi-line venues
  // (`WHERE:\n<addr>`) reach BARE_LABEL_RE. Sibling-label leaks on the
  // next line (`How: $5 cash`, `Venmo or PayPal: …`) are filtered by
  // isNonAddressText below.
  if (match && !match[1]?.trim()) match = null;
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
  // Strip a trailing "(lat, lng)" coordinate parenthetical (#1999 BAH3).
  location = location.replace(TRAILING_COORD_PAREN_RE, "").trim();

  if (location.length < 3) return undefined;
  if (location.length > LOCATION_MAX_LENGTH) return undefined;
  if (isPlaceholder(location)) return undefined;
  if (isNonAddressText(location)) return undefined;
  if (LOCATION_INSTRUCTION_RE.test(location)) return undefined;
  if (LOCATION_TIME_ONLY_RE.test(location)) return undefined;
  // Coord-shaped captures (#1328 DeMon #22): the description's first line
  // under WHERE: is sometimes raw coords with the human-readable venue
  // immediately after. We reject the coord shape so the kennel-centroid
  // fallback (or a downstream geocoder) wins instead of surfacing coords
  // as the display name. The structured lat/lng path on `item.location`
  // captures the numeric value separately when present.
  if (parseCoordOnlyLocation(location) !== null) return undefined;

  return location;
}

/**
 * #1827 — some kennel admins type the venue into the GCal LOCATION field and
 * then paste a chunk of the run description (parking / navigation notes) right
 * after it with NO separator, e.g.
 *   location:    "Holiday Inn Austin-Town Lake by IHGUnder I35 by Holiday Inn Townlake"
 *   description: "…Bring money and ID. Park under I35 by Holiday Inn Townlake."
 * The trailing run ("Under I35 by Holiday Inn Townlake") is a verbatim echo of
 * the description that got glued onto the venue mid-word ("IHG│Under"). Left
 * intact it both leaks description text into the venue name and defeats
 * geocoding.
 *
 * Strip the longest trailing slice of `location` that:
 *   (a) begins at a GLUED-WORD boundary in the location: the char before the cut
 *       is alphanumeric (no separator) AND the char at the cut is an UPPERCASE
 *       letter. That's the fingerprint of the no-separator glue ("IHG│Under") —
 *       a capitalised word jammed onto the venue. The uppercase requirement is
 *       what keeps a single lowercase-continuing word intact: "Westin Hotel …"
 *       would cut at "West│in", but 'i' is lowercase so it's rejected (likewise
 *       "Eastman"→"East", "Northbound"→"North"); and
 *   (b) appears in `description` at a WORD BOUNDARY (case-insensitive). The
 *       boundary check on the description side rejects coincidental sub-token
 *       matches: "Smith Park near the river" would otherwise cut at "n│ear the
 *       river" because "ear the river" is a substring of "near the river", but
 *       there that match is preceded by a word char, so it's discarded.
 * Pure string ops — no regex over the input (ReDoS-safe, Sonar S5852/S5843).
 */
export function stripGluedDescriptionEcho(
  location: string,
  description: string | null | undefined,
): string {
  if (!location || !description) return location;
  const locLower = location.toLowerCase();
  const descLower = description.toLowerCase();
  const isWordChar = (ch: string) => (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
  const isUpper = (ch: string) => ch >= "A" && ch <= "Z";
  const echoesAtWordBoundary = (needle: string): boolean => {
    let from = descLower.indexOf(needle);
    while (from !== -1) {
      if (from === 0 || !isWordChar(descLower[from - 1])) return true;
      from = descLower.indexOf(needle, from + 1);
    }
    return false;
  };
  // Ascending i ⇒ the first qualifying cut is the LONGEST echoed suffix.
  for (let i = 1; i < location.length; i++) {
    if (!isWordChar(locLower[i - 1]) || !isUpper(location[i])) continue;
    const candidate = locLower.slice(i);
    if (candidate.length < 12) break; // remaining tails only get shorter
    if (!echoesAtWordBoundary(candidate)) continue;
    const removed = location.slice(i).trim();
    if (removed.split(/\s+/).length < 2) return location;
    const head = location.slice(0, i).trim();
    return head.length >= 4 ? head : location;
  }
  return location;
}

/**
 * Extract a start time from the event description when `item.start.dateTime` yields no time.
 * Parses common label patterns (Pack Meet:, Circle:, Time:, Start:, When:, Chalk Talk:).
 *
 * When `goTimeWins` is set (NOH3 only, #1775), the hash "go" time ("6:30pm go")
 * — the actual start — is consulted FIRST. This is gated per-source because the
 * "show/go" convention is NOH3-specific; firing it on the ~200 other calendars
 * would mis-read prose like "drinks at 8pm, go home whenever" as a start time.
 */
export function extractTimeFromDescription(
  description: string,
  goTimeWins = false,
): string | undefined {
  if (goTimeWins) {
    const goTime = timeFromAmPmMatch(GO_TIME_RE.exec(description));
    if (goTime) return goTime;
  }
  const match = TIME_LABEL_RE.exec(description);
  if (!match?.[1]) return undefined;
  return parse12HourTime(match[1]);
}

/**
 * Parse a start time stated as "… at 6pm" / "… at 6:30 PM" in free text,
 * including the bare-hour form `parse12HourTime` rejects. Requires the "at "
 * lead-in so an unrelated time in the body (a kennel blurb "bar open til 11pm",
 * an on-after note) isn't mistaken for the start. Used only by the
 * placeholder-summary promotion path (#1761).
 */
export function parseLooseAmPmTime(text: string): string | undefined {
  const m = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i.exec(text);
  if (!m) return undefined;
  let hours = Number.parseInt(m[1], 10);
  if (hours < 1 || hours > 12) return undefined;
  const mins = m[2] ?? "00";
  const isPm = m[3].toLowerCase() === "p";
  if (isPm && hours !== 12) hours += 12;
  if (!isPm && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${mins}`;
}

/**
 * Build "HH:MM" (24h) from a 12-hour regex match whose groups are
 * [_, hour, minute?, am/pm] (the shape shared by TITLE_TIME_RE and GO_TIME_RE).
 * Returns undefined for no match or an out-of-range hour/minute.
 */
function timeFromAmPmMatch(match: RegExpExecArray | null): string | undefined {
  if (!match) return undefined;
  const hour = Number.parseInt(match[1], 10);
  const min = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (hour < 1 || hour > 12 || min < 0 || min > 59) return undefined;
  return formatAmPmTime(hour, min, match[3]);
}

/**
 * Extract a start time embedded in a calendar event title.
 *
 * NOH3 (and other kennels) post social events as all-day GCal entries with the
 * time embedded in the title — e.g. "Social @ JBs Fuel Dock, 6pm" or
 * "Hash Run 7:30pm". Returns 24-hour "HH:MM" or undefined.
 */
export function extractTimeFromTitle(summary: string): string | undefined {
  return timeFromAmPmMatch(TITLE_TIME_RE.exec(summary));
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
    return normalizeCostSigil(value);
  }
  return undefined;
}

/**
 * Last-resort hare extraction for a mid-line `Hare: Name` label that the shared
 * line-anchored `extractHares` patterns miss (#2122 PPH4 — description
 * "Iron Girth with your Hare: NIPS"). Only used when description + title hare
 * extraction yielded nothing; without it the title parenthetical
 * ("(Last Trail for the week)") gets wrongly promoted to hares.
 *
 * Requires a literal capital `Hare`/`Hares` preceded by whitespace/`(`/start
 * and a capture starting with an uppercase letter or `*`, so lowercase
 * lookalikes ("…we share: cookies", "welfare: …") can't match. The line-bounded
 * capture is run through the shared {@link cleanAndFilterHares} (phone strip,
 * sentence-boundary truncation, conversational-tail strip, etc. — the same
 * cleaner `extractHares` uses) so a same-line prose tail can't persist as a
 * hare, then through `looksLikeHareName` as a final placeholder/kennel-code gate
 * (cleanAndFilterHares passes "TBD" through; this rejects it). A null/undefined
 * cleaner result means "no usable hare" → undefined.
 */
// #2213 Thirstday — `[ \t]*` (not `\s*`) after the label so an empty `Hares:`
// label can't let the post-colon whitespace match cross a newline and capture
// the NEXT line's label (`Hares: \nNotes:` → "Notes:"). This is a mid-line
// `Hare: Name` extractor by design, so same-line whitespace is correct.
const INLINE_HARE_LABEL_RE = /(?:^|[\s(])Hares?[ \t]*:[ \t]*([A-Z*][^\n]*)/;
export function extractInlineHareFromDescription(description: string): string | undefined {
  const match = INLINE_HARE_LABEL_RE.exec(description);
  if (!match?.[1]) return undefined;
  const cleaned = cleanAndFilterHares(match[1]);
  if (typeof cleaned !== "string" || !cleaned) return undefined;
  return looksLikeHareName(cleaned) ? cleaned : undefined;
}

const mapsUrl = googleMapsSearchUrl;

/** Instruction phrases that indicate a GCal location field is direction text. */
const NON_ADDRESS_INSTRUCTION_RE = /^(?:use the|check the|see the|see description|click|follow the|refer to|details in)/i;
/** Single-word sibling labels — leak when `WHERE:` is left blank in a template
 *  (#1329 Flour City: `Where:\nWhen: 5:69` would otherwise capture "When: 5:69").
 *  `hare(?:s|\(s\))?` catches the plural / parenthesized variants
 *  (`Hares:`, `Hare(s):`) that the cleanup script's prefix list already covers. */
const NON_ADDRESS_SINGLE_LABEL_RE = /^(?:when|why|hare(?:s|\(s\))?|what|who|cost|how)\s*:/i;
/** Multi-word sibling labels — split into two smaller regexes so each stays
 *  under SonarQube S5843's complexity threshold of 20. */
const NON_ADDRESS_LABEL_CASH_RE = /^(?:how\s+much|hash\s+cash|on[\s-]?after)\s*:/i;
const NON_ADDRESS_LABEL_TRAIL_RE = /^(?:pack\s*meet|pre[\s-]?lube|trail\s*(?:type|length))\s*:/i;
/** Bare payment keywords — `Venmo or PayPal: …` etc. */
const NON_ADDRESS_PAYMENT_RE = /^(?:venmo|pay\s*pal|cash\s*app|zelle)\b/i;
/** Suffix phrase indicating the field is a placeholder like "DST start location". */
const NON_ADDRESS_SUFFIX_RE = /\bstart\s+location\s*$/i;
/** Literal "No location provided" placeholder some kennels type into the GCal
 *  LOCATION field instead of leaving it blank (#2081 Morgantown). Anchored
 *  whole-string so a real venue containing the word "provided" survives. */
const NON_ADDRESS_NO_LOCATION_RE = /^no location provided$/i;

/** Returns true if text starts with instruction phrasing rather than an address.
 *  Patterns are split across multiple small regexes so each stays under
 *  SonarQube's S5843 complexity threshold of 20. */
function isNonAddressText(text: string): boolean {
  const t = text.trim();
  return (
    NON_ADDRESS_INSTRUCTION_RE.test(t) ||
    NON_ADDRESS_SINGLE_LABEL_RE.test(t) ||
    NON_ADDRESS_LABEL_CASH_RE.test(t) ||
    NON_ADDRESS_LABEL_TRAIL_RE.test(t) ||
    NON_ADDRESS_PAYMENT_RE.test(t) ||
    NON_ADDRESS_SUFFIX_RE.test(t) ||
    NON_ADDRESS_NO_LOCATION_RE.test(t)
  );
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
  /** #2349 Stuttgart SH3: regex(es) (capture group = digits) to pull a run
   *  number from the SUMMARY when it omits the `#` ("SH3 871", "SH3 879 Lone
   *  Thrills"). Distinct from `runNumberPatterns` (description-only) — these
   *  scan the summary, tried only after the shared `#`-delimited parser misses.
   *  Anchor them (`^SH3\s*#?\s*(\d{2,4})`) so a digit run in a theme can't win. */
  summaryRunNumberPatterns?: string[];
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
   * When true, the `titleHarePattern` span is stripped from the title even when
   * the canonical hare came from the description (#1884 MH3-Mpls: title
   * "MH3 #1984 - B Knuckles" + description "Hare : Butt Knuckles" — keep the
   * description hare, but still strip the "- B Knuckles" suffix off the title).
   * Default (off) preserves the description-priority-keeps-title contract for
   * every other titleHarePattern kennel.
   */
  alwaysStripTitleHareSpan?: boolean;
  /**
   * When true, strip a trailing dangling hare label ("…Walkers. Hare:" /
   * "…Walkers. Hare") from the title when NO hare was extracted (#2146 RDH3:
   * TBA rows are "RDH3 XX Walkers. Hare: " with an empty hare, so the
   * `titleHarePattern` — which requires a non-empty capture — never fires and
   * leaves the label behind). Opt-in per source; the strip requires a literal
   * period before "Hare" so a title that genuinely ends in the word "Hare"
   * isn't truncated.
   */
  stripDanglingHareLabel?: boolean;
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
  goTimeWins?: boolean;                 // #1775 NOH3 — promote the "go" time ("6:30pm go") over the Start:/Circle: label time. Scoped per-source (the "show/go" convention is NOH3-specific) so it can't mis-fire on the ~200 other calendars.
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
  /**
   * #1708: iCalUID values of dormant recurring series — abandoned unbounded
   * `FREQ=WEEKLY` RRULEs (no UNTIL) the kennel left in the calendar but no
   * longer curates. Google's API keeps materializing stale-titled phantoms
   * across the whole `[timeMin, timeMax]` window (the `futureHorizonDays` cap
   * can't help when the phantoms fall inside the window). Instances whose
   * `iCalUID` matches are dropped; the kennel's real per-occurrence VEVENTs
   * (separately created events) carry distinct UIDs and flow through untouched.
   * Matched case-insensitively. NOTE: a RECURRENCE-ID override edited *in place*
   * on the suppressed series shares its iCalUID and would also be dropped — an
   * accepted tradeoff for a fully-abandoned series. Reversible: remove the UID
   * and re-scrape if the series ever goes live again.
   */
  suppressICalUids?: readonly string[];
  /**
   * #1787 Capital H3 (Canberra): this calendar publishes the run number (+ an
   * optional theme) on an ALL-DAY descriptor event ("Run #2397 Public Holiday
   * - King's birthday") and the start time / hares / location on a SEPARATE
   * same-date TIMED event ("Scarlet", "Greasenipple - Park in Beagle St").
   * When true:
   *   1. an all-day event whose summary yields a run number is admitted even
   *      without `includeAllDayEvents`, and its title is reduced to the theme;
   *   2. in `dedupGCalEvents`, such a descriptor is merged into its same-date
   *      (earliest-start) timed sibling — the descriptor contributes runNumber
   *      + theme title, the timed event keeps its startTime and contributes
   *      hares (+ location) parsed from its summary. Descriptors with no timed
   *      sibling survive standalone (the run number still shows).
   * All-day events with NO run number (campouts, "weekend away") keep their
   * existing behavior (dropped unless `includeAllDayEvents`).
   */
  mergeAllDayRunDescriptor?: boolean;
  // Some calendars only populate the soonest-upcoming event's description, which
  // carries an inline schedule listing future dates and hares. After the scrape
  // finishes, back-fill `hares` on other events for the same kennelTag by
  // matching on M/D. Non-destructive: never overwrites existing hares.
  inlineHarelinePattern?: {
    kennelTag: string;       // which kennel's events to back-fill
    blockHeader: string;     // e.g. "4x2 H4 Hareline:"
  };
  /**
   * IANA timezone name. Required for calendars that publish `dateTime` as
   * UTC (`...Z`) — without it the wall-clock slice misreads the UTC hour
   * as local and trips `event-improbable-time` on every late run (#964).
   * Undefined preserves the legacy raw-slice behavior.
   */
  timezone?: string;
  /**
   * Opt-in: strip a doubled kennelCode prefix from the start of the title
   * (e.g. "MoA2H3 MoA2H3 Red Dress Run" → "MoA2H3 Red Dress Run"). #1458.
   * Off by default — set true only for sources whose admins are known to
   * paste the prefix twice. Generic enablement risks rewriting legitimate
   * brand titles like "X X News" when the kennelCode happens to be a
   * common word.
   */
  stripDoubledKennelPrefix?: boolean;
  /**
   * Opt-in: when the calendar SUMMARY collapses to the bare kennel tag
   * (post-trailing-dash strip), skip the `titleFromDescription` fallback
   * and let `defaultTitle` / `defaultTitles[kennelTag]` win instead.
   *
   * Set this on umbrella calendars whose admins use the description as
   * scratch space — `**update**` / `EDIT:` / freeform sentences leak into
   * the title because they happen to be the first non-label line (#1677
   * Moooouston, #1705 Mosquito). Off by default so single-kennel calendars
   * that genuinely encode the trail name in the description (4X2 H4 /
   * Chicagoland) keep their existing behavior.
   *
   * Only effective when a `defaultTitle` or per-kennel `defaultTitles`
   * entry is configured — otherwise the description fallback is still
   * the only path to a usable title.
   */
  preferDefaultTitleOverDescription?: boolean;
  /**
   * When true, the calendar SUMMARY is the canonical title and the adapter
   * NEVER falls back to the description for a title (#2046 C2H3). Some kennels
   * put the bare kennel code in SUMMARY and boilerplate marketing prose in
   * DESCRIPTION; the generic "summary == kennelTag → use description" fallback
   * then surfaces the boilerplate. Setting this leaves the title as the
   * stripped summary so merge.ts keeps it (or synthesizes "<Kennel> Trail #N"
   * when it collapses to the bare code). Off by default — the description
   * fallback is correct for the many calendars that genuinely encode the trail
   * name there (4X2 H4 / Chicagoland).
   */
  summaryIsCanonicalTitle?: boolean;
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

// One Intl.DateTimeFormat per IANA zone. The set is bounded by the
// configured GCal sources; without caching, busy scrapes allocate a
// fresh formatter for every event (~5K per cron tick on a 365-day window).
// `null` is cached ONLY for RangeError (invalid IANA name — durable config
// error). Transient errors don't poison the cache; the next event retries.
const tzFormatterCache = new Map<string, Intl.DateTimeFormat | null>();
function getTzFormatter(timezone: string): Intl.DateTimeFormat | null {
  if (tzFormatterCache.has(timezone)) return tzFormatterCache.get(timezone) ?? null;
  try {
    // en-GB: predictable 24-hour formatting. We still normalize "24" → "00"
    // below as a belt-and-braces guard against ICU edge cases.
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    tzFormatterCache.set(timezone, fmt);
    return fmt;
  } catch (err) {
    if (err instanceof RangeError) {
      // Durable config error (invalid IANA name) — admin validator catches
      // new edits but pre-existing seed/DB rows could still slip through.
      // Cache null so we don't re-throw on every event.
      console.warn(
        `[gcal-adapter] Invalid timezone "${timezone}" — falling back to raw-slice extraction:`,
        err,
      );
      tzFormatterCache.set(timezone, null);
      return null;
    }
    // Unexpected error — log and DO NOT poison the cache. Next event retries.
    console.error(
      `[gcal-adapter] Unexpected error constructing formatter for "${timezone}":`,
      err,
    );
    return null;
  }
}

/**
 * Convert a UTC `dateTime` to local wall-clock parts in the given zone.
 * Returns `null` on any failure (invalid Date, invalid timezone, missing
 * formatToParts components) so the caller can fall back to raw-slice.
 *
 * All five parts (year/month/day/hour/minute) are required — without
 * this guard a missing component would silently emit malformed output
 * like `"2026--14"` or `"14:"`. ICU should always populate every part
 * for the configured options on a valid date, but defending against
 * exotic locale builds is cheap.
 */
function extractDateTimeWithTimezone(
  dateTime: string,
  timezone: string,
): { dateISO: string; startTime: string } | null {
  const fmt = getTzFormatter(timezone);
  if (!fmt) return null;
  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) return null;
  const parts = fmt.formatToParts(date);
  let year = "", month = "", day = "", hour = "", minute = "";
  for (const p of parts) {
    if (p.type === "year") year = p.value;
    else if (p.type === "month") month = p.value;
    else if (p.type === "day") day = p.value;
    else if (p.type === "hour") hour = p.value;
    else if (p.type === "minute") minute = p.value;
  }
  if (!year || !month || !day || !hour || !minute) return null;
  if (hour === "24") hour = "00";
  return { dateISO: `${year}-${month}-${day}`, startTime: `${hour}:${minute}` };
}

/**
 * Extract local date and time from a Google Calendar start/end object.
 * With `timezone`, the instant is converted via Intl into wall-clock
 * digits in that zone — required for feeds that publish `dateTime` as
 * UTC (`...Z`). Without it, the legacy raw-slice path runs unchanged.
 */
function extractDateTimeFromGCalItem(
  start: { dateTime?: string; date?: string },
  timezone?: string,
): { dateISO: string; startTime: string | undefined } {
  if (start.dateTime) {
    if (timezone) {
      const tz = extractDateTimeWithTimezone(start.dateTime, timezone);
      if (tz) return tz;
    }
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
  return { dateISO: start.date ?? "", startTime: undefined };
}

/** Strip HTML from description, preserving newlines, and truncate. */
export function normalizeGCalDescription(rawDesc: string | undefined): { rawDescription: string | undefined; description: string | undefined } {
  if (!rawDesc) return { rawDescription: undefined, description: undefined };
  let rawDescription = stripHtmlTags(decodeEntities(rawDesc), "\n");
  // #2217 LDS H3 — some kennels paste cost text copied from a Markdown/MathJax
  // page where "$5 (or $1…" was rendered as a Pandoc inline-math span
  // (<span class="math inline">\(5 (or \)</span>1…). After tag-stripping, the
  // LaTeX \( / \) delimiters survive as garbled cost. Restore them to $. Gated
  // on the span marker so unaffected descriptions are untouched; plain-string
  // replaceAll keeps it off the Sonar regex radar.
  if (rawDesc.includes("math inline")) {
    rawDescription = rawDescription.replaceAll(String.raw`\(`, "$").replaceAll(String.raw`\)`, "$");
  }
  // Strip mailto: link artifacts: "text (mailto:email)" → "text"
  rawDescription = rawDescription.replace(/\s*\(mailto:[^)]+\)/g, "");
  // Strip Harrier Central auto-generated header from GCal-synced events:
  // "{KennelName}\nLocation: {venue}\nDescription: {actual text}" → "{actual text}"
  rawDescription = rawDescription.replace(/^[^\n]*\nLocation:[^\n]*\nDescription:\s*/i, "");
  // Collapse a description whose body block is pasted verbatim twice (#1889
  // Morgantown "National Repeat Day" — the source calendar entry duplicated the
  // whole block). No-op for non-doubled descriptions.
  rawDescription = dedupeRepeatedDescription(rawDescription) ?? rawDescription;
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
 *
 * `matchedPattern` is true only when an explicit `kennelPatterns` entry hit;
 * default-fallback and bare-summary routes return false. Used by the CTA
 * placeholder filter (#1233) to keep kennel-attributed reminders.
 */
function resolveKennelTagFromSummary(
  summary: string,
  sourceConfig: CalendarSourceConfig | null,
  compiledKennelPatterns?: CompiledKennelPattern[],
): { kennelTags: string[]; useFullTitle: boolean; matchedPattern: boolean } | null {
  if (sourceConfig?.kennelPatterns) {
    const matched = matchConfigPatterns(summary, sourceConfig.kennelPatterns, compiledKennelPatterns);
    if (matched.length > 0) return { kennelTags: matched, useFullTitle: true, matchedPattern: true };
    if (sourceConfig.strictKennelRouting) return null;
    return { kennelTags: [sourceConfig.defaultKennelTag ?? summary], useFullTitle: true, matchedPattern: false };
  }
  if (sourceConfig?.defaultKennelTag) {
    return { kennelTags: [sourceConfig.defaultKennelTag], useFullTitle: true, matchedPattern: false };
  }
  return { kennelTags: [summary], useFullTitle: true, matchedPattern: false };
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
  compiledSummaryRunNumberPatterns?: RegExp[];
  compiledSkipPatterns?: RegExp[];
  compiledTitleHarePatterns?: RegExp[];
  compiledTitleLocationPatterns?: RegExp[];
  compiledTitleStripPatterns?: RegExp[];
  /** Pre-compiled kennelPatterns. Production fetch path passes this so
   *  we don't re-compile every event; tests can omit. */
  compiledKennelPatterns?: CompiledKennelPattern[];
  /** Lowercased iCalUID suppress list (#1708), precompiled once per fetch so
   *  the per-event check is an O(1) Set lookup instead of re-lowercasing the
   *  config array for every item. Tests can omit (falls back to sourceConfig). */
  suppressedICalUidSet?: Set<string>;
  /** id-tracking map; the adapter populates this so the cross-call
   *  dedup at the end of `fetch` can use stable GCal ids without
   *  changing the public RawEventData shape. */
  gcalIdMap?: WeakMap<RawEventData, string>;
  /** Set of RawEventData built from all-day GCal items. Used by
   *  `dedupGCalEvents` to drop placeholder all-day rows when a timed
   *  sibling exists for the same `(kennelTag, date)` (#1199 Giggity). */
  allDayEventSet?: WeakSet<RawEventData>;
  /** Original decoded SUMMARY per built event. Used by the #1787 descriptor
   *  merge to read a Capital H3 timed event's hare from its pristine summary
   *  rather than the post-pipeline title (which a stray `description` can
   *  override, e.g. summary "Scarlet" + description "Public holiday"). */
  summaryMap?: WeakMap<RawEventData, string>;
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
    compiledSummaryRunNumberPatterns,
    compiledSkipPatterns,
    compiledTitleHarePatterns,
    compiledTitleLocationPatterns,
    compiledTitleStripPatterns,
    compiledKennelPatterns,
    suppressedICalUidSet,
    gcalIdMap,
    allDayEventSet,
    summaryMap,
  } = options;
  if (item.status === "cancelled") return null;
  // #1708: drop instances of dormant recurring series the kennel abandoned but
  // left in the calendar (real per-occurrence VEVENTs carry distinct UIDs). The
  // production fetch path passes a precompiled lowercased set; direct/test calls
  // fall back to building it from sourceConfig.
  const suppressedUids =
    suppressedICalUidSet ??
    (sourceConfig?.suppressICalUids?.length
      ? new Set(sourceConfig.suppressICalUids.map((u) => u.toLowerCase()))
      : undefined);
  if (suppressedUids && item.iCalUID && suppressedUids.has(item.iCalUID.toLowerCase())) {
    return null;
  }
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
  if (isAllDay && !sourceConfig?.includeAllDayEvents) {
    // #1787 Capital H3: admit an all-day run descriptor ("Run #2397 …") even
    // without includeAllDayEvents so dedupGCalEvents can merge it into its
    // same-date timed sibling. A descriptor is an all-day event whose summary
    // yields a real run number; campouts / "weekend away" (no run number)
    // still drop here.
    const admitRunDescriptor =
      sourceConfig?.mergeAllDayRunDescriptor === true &&
      typeof extractRunNumber(decodeEntities(item.summary)) === "number";
    if (!admitRunDescriptor) return null;
  }

  const { dateISO, startTime } = extractDateTimeFromGCalItem(item.start, sourceConfig?.timezone);
  if (!dateISO) return null;
  const endParts = item.end ? extractDateTimeFromGCalItem(item.end, sourceConfig?.timezone) : undefined;
  const summary = decodeEntities(item.summary);

  // Skip events whose summary matches any configured skip pattern (e.g., cross-kennel posts)
  if (compiledSkipPatterns?.length) {
    for (const re of compiledSkipPatterns) {
      if (re.test(summary)) return null;
    }
  }
  // Note: CTA recruitment-placeholder filter moved below resolveKennelTagFromSummary
  // so kennel-attributed placeholders ("C2B3H4 - HARE NEEDED") survive (#1233).
  // Skip events from Google's imported holiday calendars (organizer.email has
  // the form `…holiday…@group.v.calendar.google.com`).
  const organizerEmail = item.organizer?.email ?? item.creator?.email;
  if (organizerEmail && /holiday.*@group\.v\.calendar\.google\.com$/i.test(organizerEmail)) {
    return null;
  }
  const { rawDescription, description } = normalizeGCalDescription(item.description);
  let hares = rawDescription ? extractHares(rawDescription, compiledHarePatterns) : undefined;
  // #2122 — fall back to a mid-line "Hare: Name" label that the line-anchored
  // extractHares patterns miss (PPH4 "…with your Hare: NIPS"). Prefer this real
  // description hare over the title parenthetical that would otherwise be
  // promoted further below.
  if (!hares && rawDescription) {
    hares = extractInlineHareFromDescription(rawDescription);
  }
  // Fall back to extracting hares from title when description has none. Try
  // each pattern in order; first capture-group hit wins. Track which pattern
  // matched so the downstream title-cleanup block uses the same regex span.
  let haresFromTitle = false;
  let matchedTitleHarePattern: RegExp | undefined;
  // Run the title-hare patterns when hares are still missing, OR when the source
  // opts into `alwaysStripTitleHareSpan` (#1884 MH3-Mpls): there the canonical
  // hare comes from the description's "Hare:" line, but the title still carries a
  // "- HareName" suffix that must be stripped. In that mode we record the matched
  // span for the title-cleanup block below WITHOUT overwriting the description hare.
  if (compiledTitleHarePatterns?.length && (!hares || sourceConfig?.alwaysStripTitleHareSpan === true)) {
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
          // Record the span so the title-cleanup block strips it regardless.
          matchedTitleHarePattern = re;
          // Assign hares only when none yet AND the capture looks like a hash
          // name (not a placeholder / bare kennel code, #1882).
          if (!hares && looksLikeHareName(cleaned)) {
            hares = cleaned;
            haresFromTitle = true;
          }
          break;
        }
      }
    }
  }
  const resolved = resolveKennelTagFromSummary(summary, sourceConfig, compiledKennelPatterns);
  if (!resolved) return null;
  const { kennelTags, useFullTitle, matchedPattern } = resolved;
  // The first resolved tag is the primary kennel for routing/title fallback
  // logic below. Co-host secondaries (#1023) ride along in `kennelTags` and
  // are written to EventKennel rows by the merge pipeline.
  const kennelTag = kennelTags[0];
  // CTA recruitment-placeholder filter (#1233). Drop calendar-wide reminders
  // ("Hares needed for July") with no kennel signal, but keep kennel-attributed
  // placeholders ("C2B3H4 - HARE NEEDED") — those are real runs awaiting a hare,
  // and merge.ts's `isAdminTitle` path will synthesize a clean title.
  if (!matchedPattern && CTA_EMBEDDED_PATTERNS.some((re) => re.test(summary))) {
    return null;
  }
  // Location: prefer item.location (unless placeholder or instruction text), fall back to description extraction.
  // #743: strip trailing phone numbers and contact-CTA parentheticals from the
  // raw GCal location field. Trailing only — a bare "1 800 ..." in the middle
  // of a street fragment would otherwise be shredded.
  let location = item.location ? stripNonEnglishCountry(decodeEntities(item.location).trim()) : undefined;
  // #1843 — some calendars (Kahuna/OKH3) paste a pre-built Google Maps URL into
  // the LOCATION field and then append the run description after it. A
  // well-formed URL contains no raw whitespace, so the run from the first
  // whitespace char on is leaked description text — clip it before this value
  // flows through to `locationUrl` (where `locationIsUrl` stores it verbatim).
  // Only clip when the trailing run actually looks like prose (≥3 consecutive
  // letters) so a hand-pasted coordinate URL with a raw space ("?q=30.2, -97.7")
  // keeps its longitude rather than being truncated at the comma-space.
  if (location && /^https?:\/\//i.test(location)) {
    const wsIdx = location.search(/\s/);
    if (wsIdx !== -1 && /[A-Za-z]{3,}/.test(location.slice(wsIdx))) {
      location = location.slice(0, wsIdx).trim() || undefined;
    }
  }
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
  // #1827 — strip description text glued onto the venue without a separator
  // (e.g. "…by IHGUnder I35 by Holiday Inn Townlake"). URLs are exempt — the
  // #1843 clip above already handles the Maps-URL leak shape.
  if (location && !/^https?:\/\//i.test(location)) {
    location = stripGluedDescriptionEcho(location, rawDescription) || undefined;
  }
  if (!location && rawDescription) {
    location = extractLocationFromDescription(rawDescription);
  }
  // Restore the verbatim coord string when description didn't provide a
  // better address. The source explicitly chose "no street name" so we'd
  // rather show the coords than the kennel-default fallback (#1195 GAL).
  if (!location && coordOnlyDisplay) location = coordOnlyDisplay;

  // Determine title: if title matches kennel tag, try description fallback.
  // CTA-bearing summaries pass through verbatim so merge.ts's `isAdminTitle`
  // path can preserve any theme prefix ("C2B3H4 #5 Turkey Trot - Hares Needed"
  // → "Turkey Trot") rather than the adapter making a duplicate strip (#1233).
  let title = useFullTitle ? summary : extractTitle(summary);
  title = stripDatePrefix(title);
  // Strip a trailing dash/delimiter (#756 "Moooouston H3 Trail -" /
  // #1060 "Space City Hash:"). The subsequent defaultTitle path replaces
  // an empty string with a configured fallback; without this strip the
  // title shipped to users as "… -" / "… :".
  title = title.replace(/\s*[-–—:]\s*$/, "").trim(); // NOSONAR — anchored end-of-string strip, no nested quantifiers
  // #1458 — opt-in: strip a doubled kennelCode prefix at title start
  // ("MoA2H3 MoA2H3 Red Dress Run" → "MoA2H3 Red Dress Run", or the bare
  // placeholder "MoA2H3 MoA2H3" → "MoA2H3"). Some kennels double-paste
  // the prefix on the GCal admin side. merge.ts's rewriteStaleDefaultTitle
  // only handles "<kennelCode> Trail #N" patterns, not free-form titles.
  // Gated on per-source config to avoid rewriting legitimate "X X News"
  // titles where the kennelCode happens to be a common word.
  //
  // #1653 — original literal-space `startsWith(`${tag} ${tag} `)` check
  // missed whitespace variants the source side sometimes types (NBSP,
  // double-space, tab). Switched to a regex with `\s+` and the `u` flag so
  // Unicode whitespace (NBSP / em-space / ideographic space) all qualify.
  // The trailing `(?=\s|$)` boundary prevents stripping inside compound
  // tokens (e.g. "BH3 BH3FM" must not collapse to "BH3FM"). Capture group
  // `$1` preserves the typed casing of the first occurrence.
  if (sourceConfig?.stripDoubledKennelPrefix && kennelTag) {
    const tagEsc = kennelTag.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const doubled = new RegExp(String.raw`^(${tagEsc})\s+${tagEsc}(?=\s|$)`, "iu"); // nosemgrep // NOSONAR — `tagEsc` is regex-escaped from kennelTag; anchored, bounded by lookahead
    title = title.replace(doubled, "$1").trim();
  }
  // Stale-default detection: equality is whitespace-insensitive so a SUMMARY
  // of "4X2 H4" still matches kennelTag "4x2h4".
  //
  // `preferDefaultTitleOverDescription` (#1677 / #1705): umbrella calendars
  // whose admins use the description as scratch space leak `**update**` /
  // freeform sentences into the title via the description-first-line path.
  // When the flag is set AND a per-kennel `defaultTitles` (or generic
  // `defaultTitle`) is configured, skip the description fallback so the
  // existing defaultTitle path (line ~1311) wins instead.
  // `summaryIsCanonicalTitle` (#2046 C2H3): trust the SUMMARY and never derive
  // a title from the description. C2H3's calendar pairs a bare-kennel-code
  // SUMMARY ("C2H3") with boilerplate marketing prose in DESCRIPTION; both
  // fallbacks below would otherwise surface that prose as the title.
  const trustSummaryTitle = sourceConfig?.summaryIsCanonicalTitle === true;
  if (!trustSummaryTitle && titleMatchesKennelTag(title, kennelTag) && rawDescription) {
    // Strict-boolean check on `preferDefaultTitleOverDescription`: the
    // config is hydrated from persisted JSON, where any truthy value
    // would otherwise opt in unintentionally (same convention as the
    // Meetup `extractRunNumber === true` check, CodeRabbit PR #1612).
    const hasConfiguredFallback =
      sourceConfig?.defaultTitles?.[kennelTag] != null
      || sourceConfig?.defaultTitle != null;
    const skipDescriptionFallback =
      sourceConfig?.preferDefaultTitleOverDescription === true
      && hasConfiguredFallback;
    if (!skipDescriptionFallback) {
      title = titleFromDescription(rawDescription) ?? title;
    }
  }
  // If title looks like a bare kennel code (2-10 alphanumeric chars, no spaces),
  // try extracting a better title from the description
  if (!trustSummaryTitle && /^[A-Za-z0-9]{2,10}$/.test(title) && rawDescription) {
    const descTitle = titleFromDescription(rawDescription);
    if (descTitle) title = descTitle;
  }
  // #1761 — placeholder run-number summary ("NBH3 #? (Tea Party)") whose real
  // header lives in the description ("NBH3 #448: Time to Spill the Tea
  // (Party)"). Promote the description header so the placeholder isn't stuck
  // as the title, and capture its run number + a textual start time. Gated on
  // the placeholder marker so normal titles are never rewritten; only fires
  // when the description header carries a real "#NNN".
  let promotedRunNumber: number | undefined;
  let promotedStartTime: string | undefined;
  if (hasPlaceholderRunNumber(title) && rawDescription) {
    // The real header ("NBH3 #448: Time to Spill the Tea (Party)") can sit
    // mid-description, below a kennel blurb — so scan for the first body line
    // that carries a real "#NNN" followed by a title delimiter (":"/"-"). The
    // delimiter requirement rejects retrospective references in prose
    // ("Last week #447 was a blast") that have no delimiter after the number.
    const descLines = rawDescription.split("\n");
    for (let i = 0; i < descLines.length; i++) {
      const line = descLines[i].trim();
      const num = extractHashRunNumber(line);
      if (typeof num === "number" && /#\s*\d+\s*[:–—-]/.test(line)) {
        title = line;
        promotedRunNumber = num;
        // Search for the start time from the header line onward, so a time in
        // a preceding kennel blurb ("we meet at 7pm") isn't promoted.
        promotedStartTime = parseLooseAmPmTime(descLines.slice(i).join("\n"));
        break;
      }
    }
  }
  // #1691 — title is kebab-case AND matches the kennel tag after
  // normalization. That's the URL-slug shape (Flour City May 28: SUMMARY
  // was literally "flour-city"). Empty the title so the defaultTitle
  // path below or, failing that, the merge pipeline's "<KennelName>
  // Trail #N" synthesis takes over. The kennel-tag gate is essential —
  // bare kebab-case is ambiguous (legit theme titles like "red-dress-
  // run" / "pre-lube" / "hash-trash" share the shape).
  if (URL_SLUG_TITLE_RE.test(title) && titleMatchesKennelTag(title, kennelTag)) {
    title = "";
  }
  // Strip the hare-name capture group from the title, preserving the rest.
  // Handles both prefix patterns (hares at start: "Hare1 & Hare2 - AH3 #2269")
  // and suffix patterns (hares at end: "AH3 #1833 - Location - Hare Name").
  // The prior code assumed prefix-only and did title.slice(captureGroup.length),
  // which mangled titles when the capture group was at the end.
  if (matchedTitleHarePattern && (haresFromTitle || sourceConfig?.alwaysStripTitleHareSpan === true)) {
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
        // #1471 — include `/` so DWH3's slash-delimited variant
        // ("Dead Whores H3/Milkbone…") trims its trailing separator.
        cleaned = title
          .slice(0, captureStart)
          .replace(/\s*[-–—/]\s*$/, "") // NOSONAR — anchored end-of-string strip, no nested quantifiers
          .trim();
      } else if (start === 0 && captureStart === 0) {
        // Pure prefix capture (e.g. "Alice AH3 #2269"): strip the hare
        // text from the start, then drop any leading separator delimiter
        // left behind by patterns that require " - " (or "/", "—" …)
        // between the hare list and the rest of the title (#1466).
        cleaned = title
          .slice(hareText.length)
          .trimStart()
          .replace(/^[-–—:/]+\s*/, ""); // NOSONAR — anchored start-of-string strip, no nested quantifiers
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
        if (candidate && !isPlaceholder(candidate) && !containsPlaceholderToken(candidate)) {
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
      if (!hares && looksLikeHareName(wHares)) hares = wHares;
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
    // #1547: a parenthetical date-range like "(Friday 5/22-Monday 5/25)" is
    // a multi-day campout date hint, not a hare name OR a title element —
    // treat it as instructional ("(posted Sunday)" etc.) so it gets stripped.
    // Event-type tags ("(Run/Walk)", #2000 DH4) and theme suffixes ending in
    // "trail" ("(Hangover trail)", #2008 PGH) are stripped from the title like
    // instructional parentheticals — never promoted to hares.
    const isInstructional =
      inner.length > MAX_HARE_PAREN_LENGTH ||
      INSTRUCTIONAL_PAREN_RE.test(inner) ||
      DATE_RANGE_PAREN_RE.test(inner) ||
      LOCATION_QUALIFIER_PAREN_RE.test(inner) ||
      isEventTypeOrThemeParen(inner);
    // #1444 — three independent reject checks. NON_NAME catches descriptive
    // and status words; ACRONYM catches CTAs/units; isInitialsWordplay
    // catches the Larryville pattern (preceding caps + matching lowercase
    // expansion). Real hash names — Title Case, lowercase-multi-word,
    // mixed-case — still pass through.
    const isNameLike =
      looksLikeHareName(inner) &&
      !NON_NAME_PAREN_RE.test(inner) &&
      !ACRONYM_PAREN_RE.test(inner) &&
      !isInitialsWordplay(title, inner, parenMatch.index);
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
    const dashHare = dashHareMatch[1].trim();
    if (!hares && looksLikeHareName(dashHare)) hares = dashHare;
    title = title.slice(0, dashHareMatch.index).trim();
  }

  // "hared by Name" suffix: "Voodoo Trail #1032 hared by The Iceman" (Voodoo H3)
  const haredByMatch = TITLE_HARED_BY_RE.exec(title);
  if (haredByMatch) {
    const haredBy = haredByMatch[1].trim();
    if (!hares && looksLikeHareName(haredBy)) hares = haredBy;
    title = title.slice(0, haredByMatch.index).trim();
  }

  // #2146 RDH3 — TBA rows ("RDH3 XX Walkers. Hare: ") leave a dangling ". Hare:"
  // label: the titleHarePattern requires a non-empty capture so it never fires.
  // Strip the trailing label only when no hare was extracted (opt-in per source).
  if (sourceConfig?.stripDanglingHareLabel && !hares) {
    title = title.replace(TRAILING_EMPTY_HARE_LABEL_RE, "").trim();
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

  // #2065 SH3 — a placeholder-run-number title with no real theme ("SH3 #? (TBD)",
  // or a bare "SH3 #?" left after a "(theme)" was extracted to hares above)
  // carries zero information. Null it so the defaultTitle path below, merge.ts's
  // "<Kennel> Trail #N" synthesis, or a richer secondary source (the SH3 hareline
  // sheet's "#1011 Catholic School Girl") wins instead of a higher-trust
  // placeholder. Runs AFTER hare/parenthetical extraction so the theme is
  // preserved as hares when present; narrow by design — a placeholder marker that
  // still wraps a real theme ("SH3 #? (Catholic School Girl)") or a co-host with a
  // real number ("NBH3/SH3 #?/#753") is untouched. Empty title still reads as a
  // shell for the all-day collapse (isPlaceholderShell), so dedup is unaffected.
  if (promotedRunNumber === undefined && isThemelessPlaceholderTitle(title)) {
    title = "";
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
  // #1761 — a start time promoted from a placeholder event's description
  // ("…at 6pm") wins over the title/description heuristics below.
  if (!resolvedStartTime && promotedStartTime) {
    resolvedStartTime = promotedStartTime;
  }
  // Title-embedded time wins over description because authors who put a time
  // in the title (NOH3 "Social @ ..., 6pm") almost always mean it as the
  // start time. Only fires for events that didn't have start.dateTime
  // (i.e. all-day entries).
  if (!resolvedStartTime) {
    resolvedStartTime = extractTimeFromTitle(summary);
  }
  if (!resolvedStartTime && rawDescription) {
    resolvedStartTime = extractTimeFromDescription(rawDescription, sourceConfig?.goTimeWins);
  }
  if (!resolvedStartTime && sourceConfig?.defaultStartTime && VALID_HHMM_RE.test(sourceConfig.defaultStartTime)) {
    resolvedStartTime = sourceConfig.defaultStartTime;
  }

  // Any URL as location (Maps or otherwise) gets routed to locationUrl for geocoding,
  // not stored as display location. resolveCoords handles URL → address resolution.
  const locationIsUrl = location && /^https?:\/\//i.test(location);
  const cost = rawDescription ? extractCostFromDescription(rawDescription) : undefined;
  // #1761 — a run number promoted from a placeholder summary's description
  // header overrides the cleared placeholder (extractRunNumber returns null
  // for "#?"). Otherwise fall back to the normal summary/description scan.
  const runNumber = promotedRunNumber ?? extractRunNumber(summary, rawDescription, compiledRunNumberPatterns, compiledSummaryRunNumberPatterns);

  // #1426 — sport-domain title (e.g. "Lansing Crisis Rugby Game") with no
  // hash-confirming signal. Three signals override: runNumber, hares, or
  // the literal word "hash" / "h3"-"h5" / "hhh" in the title (Codex round
  // 2). Location alone doesn't override — a kennel admin can plausibly
  // attach a venue to a stray non-hash event by mistake.
  if (
    runNumber === undefined &&
    !hares &&
    !HASH_KEYWORD_RE.test(summary) &&
    NON_HASH_DOMAIN_PATTERNS.some((re) => re.test(summary))
  ) {
    return null;
  }

  // #1632 — synthetic test / admin-internal titles. Unconditional drop:
  // unlike the sport / medical filters there is no plausible real hash
  // event whose summary is exactly "Trail # Test Event" or "PC Meeting".
  // (A second, signal-gated pass below also catches the case where the
  // artifact only surfaces on the RESOLVED title — see the #1736 follow-up.)
  if (isTestArtifactTitle(summary)) {
    return null;
  }

  // #1690 — medical / telehealth appointment title with no hash signal.
  // Same override semantics as the sport filter above, deliberately
  // STRICTER than the #1271 personal-title gate: description / location
  // do not rescue. A contributor accidentally adding a medical
  // appointment to a shared calendar usually types description prose
  // (clinic name, prep notes); allowing description to override would
  // re-open the PII leak that #1690 exposed.
  //
  // Evaluate against BOTH `summary` and `extractTitle(summary)` (Codex
  // P1 on PR #1713 — comment 3307074387). Two of the three medical
  // patterns are start-anchored, so a kennel-prefixed contributor
  // typo like `"H4-TX: Sleep study"` would otherwise slip past them
  // even though the prefix-stripped title matches. Checking both
  // surfaces catches both the bare and prefixed shapes without
  // weakening the anchors.
  const strippedSummary = extractTitle(summary);
  if (
    runNumber === undefined &&
    !hares &&
    !HASH_KEYWORD_RE.test(summary) &&
    MEDICAL_SKIP_RES.some((re) => re.test(summary) || re.test(strippedSummary))
  ) {
    return null;
  }

  // #1271 — drop personal-calendar drift only when no structured signal.
  // `runNumber !== undefined` covers both clean numbers and placeholder
  // markers (kennel admin's intent was a hash run, even if number is TBD).
  // #1303 ultra-short heuristic: titles ≤ 2 chars with no other signal are
  // almost always data-entry artifacts (e.g. a hare's initials typed into
  // the summary by mistake). Real hash titles are at least 3 chars even
  // when terse ("BFM", "AH3", "DC4"); kennel-tag fallback handles the
  // 3-char codes elsewhere.
  const hasStructuredField = !!(
    runNumber !== undefined ||
    hares ||
    location ||
    description?.trim()
  );
  const isUltraShort = summary.trim().length < MIN_PLAUSIBLE_HASH_TITLE_LEN;
  if (
    !hasStructuredField &&
    (isUltraShort || PERSONAL_TITLE_PATTERNS.some((re) => re.test(summary)))
  ) {
    return null;
  }

  // #1736 follow-up (PR #1788) — the summary-only artifact check above misses
  // a row whose SUMMARY defies parsing and collapses to the bare kennel-tag
  // only as the RESOLVED title (MH3-MN's HTML-blob row: the `<mailto:…>`
  // fragment trips EMAIL_IN_TITLE_RE → `title = kennelTag`). Drop it — but
  // ONLY when no structured field survived. A legitimate address-only summary
  // ALSO resolves title → kennelTag (ADDRESS_AS_TITLE_RE) yet preserves the
  // address as `location`, so gating on `hasStructuredField` keeps those real
  // events (Codex review #1788, comment 3324401046).
  if (!hasStructuredField && isTestArtifactTitle(title)) {
    return null;
  }

  // #1787: an admitted all-day run descriptor carries only the run number +
  // a noisy "Public Holiday - <theme>" title. Reduce it to the theme so the
  // dedup merge surfaces a clean title on the paired timed event (empty theme
  // → undefined → merge.ts synthesizes the default "<Kennel> Trail #N").
  const isRunDescriptor =
    sourceConfig?.mergeAllDayRunDescriptor === true && isAllDay && typeof runNumber === "number";
  const finalTitle = isRunDescriptor ? (extractRunDescriptorTheme(summary) || undefined) : title;

  // #2231 Larryville — a venue is never a verbatim copy of the event title.
  // Some kennels paste the event name into the GCal LOCATION field instead of an
  // address ("Juneteenth parade downtown" in both summary and location); drop
  // the duplicate so it doesn't masquerade as a geocodable location.
  if (location && location.trim().toLowerCase() === finalTitle?.trim().toLowerCase()) {
    location = undefined;
  }

  // Multi-day ALL-DAY events (#1560 parity with the iCal adapter): a GCal
  // all-day DTEND is EXCLUSIVE (the day after the last day), so the inclusive
  // last day is DTEND − 1. Emit only when genuinely multi-day (> 1 day); timed
  // events that merely cross midnight (overnight runs) are single-day events
  // with a late end, NOT multi-day campouts — the `isAllDay` guard excludes them.
  let endDate: string | undefined;
  if (isAllDay && item.start?.date && item.end?.date) {
    // Use the raw all-day date strings (guaranteed YYYY-MM-DD) rather than the
    // derived `dateISO`, so the parse can't break if `dateISO`'s shape changes.
    const startMs = Date.parse(`${item.start.date}T00:00:00Z`);
    const endMs = Date.parse(`${item.end.date}T00:00:00Z`);
    if (endMs - startMs > 86_400_000) {
      endDate = new Date(endMs - 86_400_000).toISOString().slice(0, 10);
    }
  }

  const event: RawEventData = {
    date: dateISO,
    // Pass the full multi-kennel set (#1023): for single-tag patterns this
    // is `[primary]`; for array patterns it's the union of all matched kennels.
    kennelTags,
    runNumber,
    title: finalTitle,
    description: appendDescriptionSuffix(description, sourceConfig?.descriptionSuffix),
    hares,
    location: locationIsUrl ? undefined : location,
    locationUrl: location ? (locationIsUrl ? location : mapsUrl(location)) : undefined,
    latitude,
    longitude,
    startTime: resolvedStartTime,
    // endTime is HH:MM only, so cross-date end timestamps (overnight runs) are dropped.
    endTime: endParts && endParts.dateISO === dateISO ? endParts.startTime : undefined,
    // Gated so single-day events never emit endDate — keeps their fingerprint
    // stable (fingerprint.ts only tokenizes endDate when present).
    ...(endDate ? { endDate } : {}),
    cost,
    sourceUrl: item.htmlLink,
  };
  if (gcalIdMap && item.id) gcalIdMap.set(event, item.id);
  if (allDayEventSet && isAllDay) allDayEventSet.add(event);
  if (summaryMap) summaryMap.set(event, summary);
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
    compiledSummaryRunNumberPatterns: sourceConfig?.summaryRunNumberPatterns?.length
      ? compilePatterns(sourceConfig.summaryRunNumberPatterns, "i")
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
    suppressedICalUidSet: sourceConfig?.suppressICalUids?.length
      ? new Set(sourceConfig.suppressICalUids.map((u) => u.toLowerCase()))
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

/**
 * #1787 Capital H3 pre-pass: merge each all-day run descriptor (run number +
 * theme title) into its same-date timed sibling (start time + hare/location in
 * the summary). A descriptor with no timed sibling is left untouched and
 * survives standalone (its numeric run number keeps `isPlaceholderShell` from
 * dropping it). Returns the surviving events plus the merge count.
 */
/** Index timed (non-all-day) events by `(kennelTag, date)`, earliest start
 *  first (undefined last) — so a descriptor merges into the day's first run. */
function indexTimedByKennelDate(
  events: RawEventData[],
  allDayEventSet: WeakSet<RawEventData>,
): Map<string, RawEventData[]> {
  const timedByKey = new Map<string, RawEventData[]>();
  for (const e of events) {
    if (allDayEventSet.has(e)) continue;
    const key = `${e.kennelTags[0]}|${e.date}`;
    const bucket = timedByKey.get(key);
    if (bucket) bucket.push(e);
    else timedByKey.set(key, [e]);
  }
  for (const bucket of timedByKey.values()) {
    bucket.sort((a, b) => (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99"));
  }
  return timedByKey;
}

/** Copy a descriptor's run number + theme onto its timed sibling. Reads the
 *  hare from the timed event's PRISTINE summary, not its post-pipeline title —
 *  a stray `description` ("Public holiday") can override the title via the
 *  bare-title fallback. Only fills fields the pipeline left empty, so the #1222
 *  "hare + street address" titleHarePattern (which DOES populate hares) wins.
 *  Empty theme → clears the title so merge.ts synthesizes "<Kennel> Trail #N". */
function applyDescriptorToTimed(
  descriptor: RawEventData,
  timed: RawEventData,
  summaryMap?: WeakMap<RawEventData, string>,
): void {
  const { hare, location } = splitTimedSummaryHareLocation(summaryMap?.get(timed) ?? timed.title ?? "");
  // A placeholder slot like "6pm CH3 - vacant" / "CH3 - vacant - Restaurant run"
  // is an unfilled run: the location half is a placeholder, so neither the
  // "hare" ("6pm CH3") nor the "location" ("vacant…") is real. Drop both (#1882).
  const slotVacant = !!location && (isPlaceholder(location) || containsPlaceholderToken(location));
  if (!slotVacant) {
    if (!timed.hares && hare && looksLikeHareName(hare)) timed.hares = hare;
    if (!timed.location && location) timed.location = location;
  }
  timed.runNumber ??= descriptor.runNumber;
  timed.title = descriptor.title ?? undefined;
}

function mergeRunDescriptorsIntoTimed(
  events: RawEventData[],
  allDayEventSet: WeakSet<RawEventData>,
  summaryMap?: WeakMap<RawEventData, string>,
): { events: RawEventData[]; mergedCount: number } {
  const timedByKey = indexTimedByKennelDate(events, allDayEventSet);
  const descriptorsToRemove = new Set<RawEventData>();
  for (const descriptor of events) {
    if (!allDayEventSet.has(descriptor) || typeof descriptor.runNumber !== "number") continue;
    const timed = timedByKey.get(`${descriptor.kennelTags[0]}|${descriptor.date}`)?.[0];
    if (!timed) continue; // standalone descriptor survives
    applyDescriptorToTimed(descriptor, timed, summaryMap);
    descriptorsToRemove.add(descriptor);
  }
  const filtered = descriptorsToRemove.size ? events.filter((e) => !descriptorsToRemove.has(e)) : events;
  return { events: filtered, mergedCount: descriptorsToRemove.size };
}

/**
 * #1199 pre-pass: drop placeholder all-day events when a timed sibling exists
 * for the same `(kennelTag, date)`. Sources with `includeAllDayEvents: true`
 * (WA Hash for CUNTh) admit both placeholder shells like "Giggity H3 #? (TBD)"
 * and real timed runs; the merge pipeline collapses them into one canonical
 * event by `(kennelId, date)`, so whichever survives this dedup wins. Prefer
 * the timed one — but ONLY when the all-day event LOOKS like a placeholder. A
 * real all-day event (campout, away weekend, RDR) sharing the date with a
 * timed trail must survive so the merge pipeline can keep both via
 * signature-based multi-event handling.
 */
function collapsePlaceholderAllDayEvents(
  events: RawEventData[],
  allDayEventSet: WeakSet<RawEventData>,
): { events: RawEventData[]; collapsedCount: number } {
  const timedKeys = new Set<string>();
  for (const e of events) {
    if (!allDayEventSet.has(e)) timedKeys.add(`${e.kennelTags[0]}|${e.date}`);
  }
  let collapsedCount = 0;
  const filtered = events.filter((e) => {
    const isCollapsible = allDayEventSet.has(e)
      && timedKeys.has(`${e.kennelTags[0]}|${e.date}`)
      && isPlaceholderShell(e);
    if (isCollapsible) collapsedCount++;
    return !isCollapsible;
  });
  return { events: filtered, collapsedCount };
}

export function dedupGCalEvents(
  events: RawEventData[],
  gcalIdMap: WeakMap<RawEventData, string>,
  allDayEventSet: WeakSet<RawEventData>,
  mergeAllDayRunDescriptor = false,
  summaryMap?: WeakMap<RawEventData, string>,
): { events: RawEventData[]; compositeDedupedCount: number; allDayCollapsedCount: number; runDescriptorMergedCount: number } {
  let runDescriptorMergedCount = 0;
  // #1787: merge run descriptors before the #1199 placeholder collapse.
  if (mergeAllDayRunDescriptor) {
    const merged = mergeRunDescriptorsIntoTimed(events, allDayEventSet, summaryMap);
    events = merged.events;
    runDescriptorMergedCount = merged.mergedCount;
  }

  const collapsed = collapsePlaceholderAllDayEvents(events, allDayEventSet);
  const timedFiltered = collapsed.events;
  const allDayCollapsedCount = collapsed.collapsedCount;

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
  return { events: result, compositeDedupedCount, allDayCollapsedCount, runDescriptorMergedCount };
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
    // Only the #1787 descriptor merge reads pristine summaries; skip the map
    // entirely for the vast majority of sources that don't opt in.
    const summaryMap = sourceConfig?.mergeAllDayRunDescriptor === true
      ? new WeakMap<RawEventData, string>()
      : undefined;

    const buildEvents = (items: GCalEvent[], filter?: (item: GCalEvent) => boolean): void => {
      let eventIndex = 0;
      for (const item of items) {
        if (filter && !filter(item)) {
          eventIndex++;
          continue;
        }
        try {
          const event = buildRawEventFromGCalItem(item, sourceConfig, { ...compiled, gcalIdMap, allDayEventSet, summaryMap });
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

    const { events: compositeDeduped, compositeDedupedCount, allDayCollapsedCount, runDescriptorMergedCount } =
      dedupGCalEvents(events, gcalIdMap, allDayEventSet, sourceConfig?.mergeAllDayRunDescriptor === true, summaryMap);

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
        ...(runDescriptorMergedCount > 0 && { runDescriptorMerged: runDescriptorMergedCount }),
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
