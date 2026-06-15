import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { validateSourceConfig, stripHtmlTags, buildDateWindow, extractHashRunNumber, HARE_BOILERPLATE_RE, CTA_EMBEDDED_PATTERNS, splitDescriptionBlocks, normalizeDescriptionKey } from "../utils";
import { safeFetch } from "../safe-fetch";
import { extractHares as extractHaresFromDescription } from "../hare-extraction";
import { isPlatformDepartureTitle } from "../skip-rules";

/** US state abbreviation → full name mapping (50 states + DC). */
const US_STATE_ABBREV_TO_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

const US_STATE_NAME_SET = new Set(Object.values(US_STATE_ABBREV_TO_NAME).map(s => s.toLowerCase()));

/** States whose full names are also common city names — don't skip these as cities. */
const STATE_CITY_AMBIGUOUS = new Set([
  "new york", "washington", "georgia", "virginia", "indiana", "colorado",
  "delaware", "hawaii", "alaska", "montana", "wyoming", "oregon", "idaho",
  "iowa", "ohio", "utah", "maine", "nevada",
]);

/** Strip trailing `, XX` or `, StateName` from text when a separate state field exists. */
export function stripTrailingState(name: string, stateAbbrev: string | undefined): string {
  if (!stateAbbrev) return name;
  const abbrevRe = new RegExp(`,\\s*${stateAbbrev.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  let cleaned = name.replace(abbrevRe, "").trim();
  const fullName = US_STATE_ABBREV_TO_NAME[stateAbbrev.toUpperCase()];
  if (fullName) {
    const fullRe = new RegExp(`,\\s*${fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
    cleaned = cleaned.replace(fullRe, "").trim();
  }
  return cleaned || name;
}

/** Collapse doubled consecutive words: "Miami Miami" → "Miami". Loops until stable to handle 3+ repeats. */
export function deduplicateWords(text: string): string {
  let result = text;
  let previous;
  do {
    previous = result;
    result = result.replace(/\b(\w+(?:\s+\w+){0,2})\s+\1\b/gi, "$1");
  } while (result !== previous);
  return result;
}

/** Returns true if `city` is a US state full name but NOT an ambiguous city name. */
export function isStateFullName(city: string): boolean {
  const lower = city.toLowerCase().trim();
  if (STATE_CITY_AMBIGUOUS.has(lower)) return false;
  return US_STATE_NAME_SET.has(lower);
}

/** Source.config shape for Meetup sources. */
export interface MeetupConfig {
  /** Meetup group URL name, e.g. "brooklyn-hash-house-harriers". */
  groupUrlname: string;
  /** Kennel shortName to assign all events to. */
  kennelTag: string;
  /** Optional per-event kennel routing: [[regexPattern, kennelTag], ...] */
  kennelPatterns?: [string, string][];
  /**
   * Opt-in: extract `#NNN` from event titles into `runNumber` (#1562). Off by
   * default — Meetup titles are free-form user prose and the shared
   * `extractHashRunNumber` helper can promote non-hash tokens (e.g. "Pub Crawl
   * #2") into a runNumber, which then participates in fingerprinting and
   * same-day dedup. Enable per-source after confirming the kennel's title
   * conventions are unambiguous (e.g. always "Miami H3 Trail #NNNN").
   */
  extractRunNumber?: boolean;
  /**
   * Optional literal prefix a kennel stylizes its run number with instead of
   * the standard `#`. When set (and `extractRunNumber` is true), every literal
   * occurrence is rewritten to `#` before `extractHashRunNumber` runs, so the
   * shared helper does the actual parsing (no per-kennel run-number regex).
   *
   * Paris H3 + Sans Clue H3 self-censor "Run" as "R*n" — titles read
   * `Paris H3 R*n 1136 | TBD` (#1975). With `runNumberPrefix: "R*n"`, that
   * normalizes to `Paris H3 # 1136 | TBD` → `extractHashRunNumber` → 1136.
   * Matched as a plain string via `String.prototype.replaceAll` (literal, not
   * regex), so a `*` in the token needs no escaping.
   */
  runNumberPrefix?: string;
  /**
   * Restrict title run-number extraction to trail context (requires
   * `extractRunNumber`). When set, the number is read from `TITLE_TRAIL_RUN_RE`
   * — a leading kennel-code token before "#", or "Trail #" — instead of the
   * generic first-`#NNN`, then falls through to the description path on no
   * match. For aggregate feeds that mix trail titles with non-trail socials:
   * Richmond H3 carries "RH3 # 1704" / "BIBH3 Trail #251" trails alongside
   * "Inter-Kennel Drinking Practice #15", and runNumber participates in same-day
   * matching / fuzzy dedup (not just the kennel-page stat), so the social must
   * not mint run #15.
   */
  anchorTrailRunNumber?: boolean;
}

/** Shape of an event entry in Meetup's __NEXT_DATA__ Apollo state. */
interface ApolloEvent {
  __typename: string;
  id: string;
  title?: string;
  dateTime?: string;
  endTime?: string;
  status?: string;
  description?: string;
  eventUrl?: string;
  venue?: { __ref?: string; name?: string; address?: string; city?: string; state?: string; lat?: number; lng?: number } | null;
  series?: { __ref?: string } | null;
}

const NUMERIC_ID_RE = /^\d+$/;

/**
 * Returns true if the ID is purely numeric (customized occurrence).
 * Meetup uses numeric IDs for customized occurrences and alphanumeric tokens for templates.
 */
export function isNumericId(id: string): boolean {
  return NUMERIC_ID_RE.test(id);
}

/**
 * Deduplicates events that share the same date, preferring customized occurrences
 * (numeric ID) over templates (alphanumeric token ID).
 * When multiple customized occurrences share a date, all are kept.
 */
export function dedupByDate(events: ApolloEvent[]): ApolloEvent[] {
  const byDate = new Map<string, ApolloEvent[]>();
  const noDates: ApolloEvent[] = [];
  for (const ev of events) {
    if (!ev.dateTime) {
      noDates.push(ev);
      continue;
    }
    const date = ev.dateTime.slice(0, 10);
    const group = byDate.get(date);
    if (group) {
      group.push(ev);
    } else {
      byDate.set(date, [ev]);
    }
  }

  // For each date group, prefer customized (numeric ID) over templates
  const result: ApolloEvent[] = [];
  for (const group of byDate.values()) {
    const numeric = group.filter((ev) => isNumericId(ev.id));
    result.push(...(numeric.length > 0 ? numeric : group));
  }

  return [...result, ...noDates];
}

/**
 * Extract Event objects from Meetup's __NEXT_DATA__ script tag (Apollo state).
 * Returns an empty array if the state isn't found or can't be parsed.
 */
export function extractApolloEvents(html: string): { events: ApolloEvent[]; state: Record<string, Record<string, unknown>> } {
  const $ = cheerio.load(html);
  const scriptEl = $("#__NEXT_DATA__");
  if (!scriptEl.length) return { events: [], state: {} };

  try {
    const nextData = JSON.parse(scriptEl.text());
    const state: Record<string, Record<string, unknown>> = nextData?.props?.pageProps?.__APOLLO_STATE__;
    if (!state || typeof state !== "object") return { events: [], state: {} };

    const events: ApolloEvent[] = [];
    for (const v of Object.values(state)) {
      if (v != null && typeof v === "object" && (v as Record<string, unknown>).__typename === "Event") {
        events.push(v as unknown as ApolloEvent);
      }
    }

    return { events, state };
  } catch {
    return { events: [], state: {} };
  }
}

/**
 * Resolve a venue from Apollo state — handles both inline objects and __ref lookups.
 * Deduplicates venue parts to avoid garbled output from corrupt Meetup data
 * (e.g. "Miami Miami, FL, Miami Miami, FL, Florida, FL" → "Miami Miami, FL, Florida").
 */
export function resolveVenue(
  state: Record<string, Record<string, unknown>>,
  venue: ApolloEvent["venue"],
): { location?: string; latitude?: number; longitude?: number } {
  if (!venue) return {};

  // Resolve __ref if present
  const resolved = venue.__ref ? (state[venue.__ref] as ApolloEvent["venue"]) : venue;
  if (!resolved) return {};

  // Incrementally build location, cleaning corrupt data from each field
  const parts: string[] = [];

  if (resolved.name) {
    let name = resolved.name;
    // Filter Google Maps UI artifacts that bleed into venue names
    if (/^(?:maps|google\s*maps)$/i.test(name.trim())) {
      name = "";
    }
    // Skip compound-address names where name = "address, city, zip" (not a real venue name)
    if (resolved.address && name && name.startsWith(resolved.address) && name.length > resolved.address.length) {
      name = "";
    }
    if (resolved.state && name) {
      const stripped = stripTrailingState(name, resolved.state);
      // Only deduplicate words when state-stripping detected corruption (state was embedded in name)
      name = stripped !== name ? deduplicateWords(stripped) : stripped;
    }
    if (name) parts.push(name);
  }

  if (resolved.address) {
    let addr = resolved.address;
    // Detect self-concatenated addresses ("410 E 35th Street410 E 35th St")
    // caused by Meetup joining address_1 + address_2 without a separator.
    // Guarded to avoid false positives on addresses like "100 100th St".
    const streetNumMatch = /^(\d+\s+)/.exec(addr);
    if (streetNumMatch) {
      const num = streetNumMatch[1];
      const secondIdx = addr.indexOf(num, num.length);
      if (secondIdx > 0 && secondIdx > addr.length * 0.4) {
        const firstPart = addr.substring(0, secondIdx).trim();
        const secondPart = addr.substring(secondIdx).trim();
        const prefix = Math.min(8, firstPart.length, secondPart.length);
        if (firstPart.toLowerCase().substring(0, prefix) === secondPart.toLowerCase().substring(0, prefix)) {
          addr = firstPart.replace(/,?\s*$/, "");
        }
      }
    }
    if (resolved.state) {
      const stripped = stripTrailingState(addr, resolved.state);
      // Only deduplicate words when state-stripping detected corruption (state was embedded in address)
      addr = stripped !== addr ? deduplicateWords(stripped) : stripped;
    }
    const nameMatch = parts[0] && addr.toLowerCase() === parts[0].toLowerCase();
    // Skip address if the venue name already contains it (e.g., "410 E 35th Street Parking Lot" contains "410 E 35th Street")
    const nameContainsAddr = !nameMatch && parts[0] && addr &&
      parts[0].toLowerCase().includes(addr.toLowerCase());
    if (!nameMatch && !nameContainsAddr && addr) parts.push(addr);
  }

  const joined = () => parts.join(", ");

  if (resolved.city) {
    // Only suppress city when it equals the full name of THIS specific state (not any state).
    // e.g. city="Florida" + state="FL" → suppress; city="California" + state="MO" → keep.
    const stateFullName = resolved.state
      ? US_STATE_ABBREV_TO_NAME[resolved.state.toUpperCase()]
      : undefined;
    const cityIsCurrentState =
      stateFullName !== undefined &&
      resolved.city.toLowerCase().trim() === stateFullName.toLowerCase() &&
      !STATE_CITY_AMBIGUOUS.has(resolved.city.toLowerCase().trim());

    if (!cityIsCurrentState) {
      const priorText = joined().toLowerCase();
      if (!priorText.includes(resolved.city.toLowerCase())) {
        parts.push(resolved.city);
      }
    }
  }

  if (resolved.state) {
    // Skip state if it appears as a word-boundary match in prior parts
    const stateRe = new RegExp(`\\b${resolved.state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!stateRe.test(joined())) {
      parts.push(resolved.state);
    }
  }

  return {
    location: parts.length > 0 ? parts.join(", ") : undefined,
    latitude: typeof resolved.lat === "number" ? resolved.lat : undefined,
    longitude: typeof resolved.lng === "number" ? resolved.lng : undefined,
  };
}

/**
 * Apollo back-reference shape — a bare `$XX` string that points elsewhere in the
 * normalized cache (Meetup deduplicates long shared values like the boilerplate
 * "Structure / This event..." across many Event entries). See #1659: when the
 * extractor casts an Apollo entry to `ApolloEvent` without resolving these,
 * canonical Event.description ends up storing `"$44"` instead of prose.
 */
const APOLLO_REF_RE = /^\$[0-9a-fA-F]+$/;

/**
 * Resolve an Apollo back-reference string against the cache state. Follows
 * up to MAX_REF_HOPS chained `$XX -> $YY -> "..."` indirections — Apollo's
 * normalized format permits chains when the same string is referenced from
 * multiple cache layers. Returns the first non-ref string at the end of the
 * chain; otherwise returns `undefined` to signal "no usable target." Tracks
 * visited refs to defend against pathological self-referential cycles.
 *
 * Reviewer pushback (PR #1688, gemini-code-assist + codex P1): an earlier
 * version of this helper required a `looksLikeProse` heuristic (≥20 chars +
 * ASCII `[A-Za-z]{3,}` match) on the resolved value. That dropped legitimate
 * short descriptions and any non-Latin (e.g. Japanese, French) prose. The
 * design contract for ref resolution is just "follow indirection until you
 * land on a literal" — accept any non-ref string the chain bottoms out on.
 */
const MAX_REF_HOPS = 4;
function resolveApolloDescriptionRef(
  ref: string,
  state: Record<string, unknown>,
): string | undefined {
  const visited = new Set<string>();
  let cursor: string | undefined = ref;
  for (let hop = 0; hop < MAX_REF_HOPS && cursor; hop++) {
    if (visited.has(cursor)) return undefined;
    visited.add(cursor);
    const target: unknown = state[cursor];
    if (typeof target === "string") {
      if (APOLLO_REF_RE.test(target)) {
        cursor = target;
        continue;
      }
      return target;
    }
    // Wrapper object — the common shape is { value: <string-or-ref> }, but
    // some Apollo variants nest under `data`. Probe both.
    if (target && typeof target === "object" && !Array.isArray(target)) {
      const obj = target as Record<string, unknown>;
      const wrapped = (typeof obj.value === "string" ? obj.value : undefined)
        ?? (typeof obj.data === "string" ? obj.data : undefined);
      if (typeof wrapped !== "string") return undefined;
      if (APOLLO_REF_RE.test(wrapped)) {
        cursor = wrapped;
        continue;
      }
      return wrapped;
    }
    return undefined;
  }
  return undefined;
}

/**
 * Clean a Meetup description: dereference Apollo back-refs, strip HTML, truncate.
 * Returns `undefined` (preserve existing canonical value, per merge.ts contract)
 * when the raw value is an Apollo ref that doesn't resolve — adapter convention
 * prefers `undefined` over `null` so failed lookups don't wipe legitimately
 * stored prose. A separate one-shot script (`scripts/cleanup-mh3-ca-stale-descriptions.ts`)
 * handles the inverse — clearing already-corrupted `$XX` rows that pre-date
 * the fix in this PR.
 */
function cleanMeetupDescription(
  desc: string | undefined,
  state: Record<string, unknown>,
): string | undefined {
  if (!desc) return undefined;
  if (APOLLO_REF_RE.test(desc)) {
    const resolved = resolveApolloDescriptionRef(desc, state);
    if (!resolved) return undefined;
    return stripHtmlTags(resolved).slice(0, 2000) || undefined;
  }
  return stripHtmlTags(desc).slice(0, 2000) || undefined;
}

/**
 * Detect group-template boilerplate structurally (#2058/#2059/#2062): Meetup
 * stores a kennel's standing recurring-event template as part of *every*
 * occurrence's description, displacing run-specific notes. The structural
 * fingerprint of a template paragraph is that it appears verbatim across
 * multiple events in a single fetch; genuine per-event notes appear once.
 *
 * Returns the set of normalized *paragraph-block* keys that occur in >= 2
 * distinct events. Block granularity (not whole-string) is required because
 * some kennels (Hogtown H3, #2059) prepend the standing club blurb to a
 * per-event logistics stanza — the whole description differs per event, but the
 * club paragraph repeats and must be stripped while the logistics stanza
 * survives. Blocks are deduped within a single event so one event repeating a
 * paragraph doesn't self-promote it to boilerplate. Empty/whitespace-only
 * blocks carry no key and never count.
 *
 * Block boundary = blank line. `cleanMeetupDescription` strips HTML with a
 * SPACE separator, so paragraph blocks survive only when the source carries
 * literal markdown `\n\n` — which is how real Meetup descriptions arrive
 * (verified live for all three incident kennels). A purely-HTML `<p>…</p><p>…</p>`
 * description collapses to one block and degrades to whole-string matching: a
 * fully-repeated template still nulls, only the partial club-blurb strip won't
 * fire. That's a graceful degradation, not a silent failure of the core goal.
 */
export function detectBoilerplateBlocks(
  cleanedDescriptions: (string | undefined)[],
): Set<string> {
  const counts = new Map<string, number>();
  for (const desc of cleanedDescriptions) {
    if (!desc) continue;
    const seen = new Set<string>();
    for (const block of splitDescriptionBlocks(desc)) {
      const key = normalizeDescriptionKey(block);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const boilerplate = new Set<string>();
  for (const [key, count] of counts) {
    if (count >= 2) boilerplate.add(key);
  }
  return boilerplate;
}

/**
 * Remove boilerplate paragraph blocks from a cleaned description. Returns the
 * surviving blocks rejoined with `\n\n`; `null` (explicit clear, per merge.ts
 * UPDATE contract) when every block was boilerplate — that wipes a fully
 * templated description (Savannah/Montreal). When NO block is boilerplate the
 * original string is returned **verbatim** (not re-joined), so a genuine
 * per-event description survives byte-for-byte untouched.
 */
export function stripBoilerplateBlocks(
  desc: string,
  boilerplateBlocks: Set<string>,
): string | null {
  const blocks = splitDescriptionBlocks(desc);
  const kept = blocks.filter((b) => !boilerplateBlocks.has(normalizeDescriptionKey(b)));
  if (kept.length === blocks.length) return desc;
  return kept.length > 0 ? kept.join("\n\n") : null;
}

/**
 * Extract local date and time from an ISO 8601 dateTime string.
 * "2026-03-05T18:30:00-05:00" → { date: "2026-03-05", startTime: "18:30" }
 * Uses the local portion of the string (not UTC conversion).
 */
function extractDateTime(dateTime: string): { date: string; startTime: string } {
  return {
    date: dateTime.slice(0, 10),
    startTime: dateTime.slice(11, 16),
  };
}

/** Pre-compile kennel pattern strings into RegExp objects. */
function compileKennelPatterns(
  patterns?: [string, string][],
): [RegExp, string][] | undefined {
  if (!patterns) return undefined;
  const compiled: [RegExp, string][] = [];
  for (const [pattern, tag] of patterns) {
    try { compiled.push([new RegExp(pattern, "i"), tag]); }
    catch (e) { console.warn(`Malformed kennel pattern skipped: "${pattern}"`, e); }
  }
  return compiled.length > 0 ? compiled : undefined;
}

/**
 * Trail-context run-number anchor for aggregate Meetup feeds (opt in via
 * `anchorTrailRunNumber`). Capture group 1 is the run number when it follows
 * either a leading kennel-code token + "#" ("RH3 # 1704") or "Trail #"
 * ("BIBH3 Trail #251"). A non-trail social ("Inter-Kennel Drinking Practice
 * #15") matches neither, so it mints no run number. A module-level literal
 * (not compiled from config) so it's ReDoS-safe by construction. */
const TITLE_TRAIL_RUN_RE = /(?:^\s*[A-Za-z0-9]{2,8}\s*#|\btrail\b\s*#)\s*(\d+)/i; // NOSONAR S5852/S5843 — literal, bounded {2,8}, no overlapping quantifiers

/**
 * Meetup-style hare-line fallback: scan the first few description lines for
 * `Hare(s)` followed by a colon or dash separator.
 *
 * Charleston Heretics (CHH3) consistently writes `Hares - FAW and Just Jim`
 * (dash); Cleveland H4 writes `Hares: Birthday Gurrrl and Tub Puppet` (colon).
 * Both shapes are handled locally because the imported
 * `extractHaresFromDescription` (google-calendar) only matches the colon form
 * AND only when the label sits at the start of a line — some Meetup
 * descriptions concatenate the label after prose, where the gcal regex's
 * `(?:^|\n)[ \t]*` boundary doesn't fire. Iterating per-line and anchoring to
 * line start backstops both gaps. See #953 (dash) and #975 (colon).
 *
 * Truncates the captured names at the first boilerplate field label
 * (`HARE_BOILERPLATE_RE`) so trailing description text like "Show/Go: 2:00"
 * doesn't leak into the hares field.
 */
export function extractHaresFromMeetupDescription(
  description: string | undefined,
): string | undefined {
  if (!description) return undefined;

  // Pass 1: line-anchored — handles `Hares - Alice` / `Hares: Alice` on its own
  // line. Capped at the first 5 lines so a kennel boilerplate footer that
  // happens to mention "hare" can't override the real label.
  const lines = description.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    // Separator: ASCII hyphen, en-dash, em-dash, or colon (kennels mix forms).
    // `Hare(s)` literal form (parenthetical) accepted alongside `Hare` / `Hares`.
    const m = /^Hare(?:\(s\)|s)?\s*[:\-–—]\s*(.+?)\s*$/i.exec(line);
    if (!m) continue;
    const names = m[1].replace(HARE_BOILERPLATE_RE, "").trim();
    if (names) return names;
  }

  // Pass 2: sentence-level — some kennels (Cleveland H4 #975) write the entire
  // event in one run-on paragraph: "… CH4 is not dead! Hares: Birthday Gurrrl
  // and Tub Puppet. Location: Winking …". Match `Hare(s):` anywhere and stop
  // at the next sentence boundary (`. ` or `.\n` or end-of-text). Word boundary
  // `\b` keeps us from matching inside other words.
  const sentenceMatch = /\bHare(?:\(s\)|s)?\s*[:\-–—]\s*([^.\n]{1,200}?)(?:\.\s|\.$|\n|$)/i.exec(description);
  if (sentenceMatch) {
    const names = sentenceMatch[1].replace(HARE_BOILERPLATE_RE, "").trim();
    if (names) return names;
  }
  return undefined;
}

/**
 * Strip CTA boilerplate ("CLAIM THIS TRAIL", "Hares Needed", "Looking for a
 * hare", etc.) from the trailing end of a Meetup title and trim dangling
 * punctuation left by the strip. The Meetup adapter previously shipped titles
 * verbatim; RVA's RH3 (#1645) and TMFMH3 (#1646) used trailing CTAs as
 * placeholder text. Strip is anchored to end-of-string only — mid-title CTA
 * tokens are likely legitimate theme names ("Hares Needed Hash") and stay
 * intact. Returns undefined when the strip empties the title so merge.ts
 * synthesizes a default. Source list is the shared `CTA_EMBEDDED_PATTERNS`
 * from `utils.ts` — already includes /\bclaim\s+this\s+trail\b/i from #1549.
 */
// Trailing-CTA regexes — precompiled once at module load. Each wraps a
// `CTA_EMBEDDED_PATTERNS` entry with a connector-punctuation prefix and `$`
// anchor so only end-of-string CTAs strip ("Hares Needed Hash" stays intact).
const TRAILING_CTA_RES = CTA_EMBEDDED_PATTERNS.map(
  (re) => new RegExp(String.raw`[\s.,!?:;\-–—]*(?:${re.source})[\s.,!?:;\-–—]*$`, "i"), // nosemgrep // NOSONAR — source patterns are hard-coded literals in utils.ts; anchored to `$`
);

// #1618 — Meetup occasionally promotes the group-level recurrence blurb
// ("Every Wednesday @ 6:30pm from tbd") into the event title when the
// per-occurrence title is missing. These are pure schedule template
// strings, not real event names. Two narrow shapes catch the observed
// Mel-NM corpus without false-positiving real trail names:
//   1. Starts with "Every <weekday>" AND contains "@" — that "@" is
//      almost always the time separator in the template, never used in
//      organic hash titles starting with "Every Saturday Trail".
//   2. Ends with "from TBA/TBC/TBD" — placeholder venue token that
//      doesn't appear in real titles.
const TEMPLATE_TITLE_PATTERNS: readonly RegExp[] = [
  /^every\s+(?:sun|mon|tue|wed|thu|fri|sat)\w*\s*@/i,
  /\bfrom\s+tb[adc]\.?\s*$/i,
];

export function cleanMeetupTitle(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  // Drop template-shaped titles before any CTA stripping — merge.ts then
  // synthesizes a "<KennelName> Trail #N" so users see something real.
  if (TEMPLATE_TITLE_PATTERNS.some((re) => re.test(raw))) return undefined;
  // Stacked CTAs ("Trail 300 - Hares Needed - Claim This Trail!") need
  // multiple passes — each iteration peels one trailing CTA until stable.
  // Hard iteration cap (10) defends against a hypothetical future zero-width
  // CTA pattern that would otherwise spin the loop forever.
  let t = raw;
  let changed = true;
  for (let pass = 0; pass < 10 && changed; pass++) {
    changed = false;
    for (const trailing of TRAILING_CTA_RES) {
      const next = t.replace(trailing, "");
      if (next !== t) {
        t = next;
        changed = true;
      }
    }
  }
  // Sweep leftover connectors (colon, hyphen, comma). Excludes `!` and `?`
  // so genuine "Saturday Trail!" / "Why?" titles keep their terminator.
  return t.replace(/[\s,:\-–—]+$/, "").trim() || undefined; // NOSONAR S5852 — single char class + `+` anchored to `$`, linear in input length
}

// #1270 — explicit "hare(s):" label for hares embedded in a Meetup *title*
// (FEH3: "Trail 2578, hare: salty cliterature ..."). Colon-only on purpose: a
// hyphen separator (as the description matcher allows) would misfire on themed
// titles like "Hare-raising Halloween Hash". Optional space before the colon
// covers "Hare : BBQ". ReDoS-safe: `(\S.*)`, no `$` anchor, no nested quantifier.
const TITLE_HARE_RE = /\bhares?\s*:\s*(\S.*)/i;

/**
 * #1270 — pull hares from a title's explicit "hare:" label and return both the
 * hares and the title with that span removed (so names don't appear twice). The
 * shared extractHares runs cleanAndFilterHares, which rejects CTA/placeholder
 * values ("hare: needed"); the colon-only label avoids themed-title false
 * positives ("Hare-raising"). Returns the title unchanged when no label matches.
 */
function extractTitleHares(title: string | undefined): { hares?: string; title?: string } {
  if (!title) return { title };
  const hares = extractHaresFromDescription(title, [TITLE_HARE_RE]);
  if (!hares) return { title };
  const m = TITLE_HARE_RE.exec(title);
  return { hares, title: m ? title.slice(0, m.index) : title };
}

/**
 * Resolve hares + the display title from a Meetup event's description and title.
 *
 * Tri-state hares (mirrors RawEventData.hares): a string is a real hare, `null`
 * is an explicit non-hare clear (bare kennel code — #2032 self-heal), and
 * `undefined` is no signal (merge preserves any existing hare).
 *
 * The shared `extractHaresFromDescription` verdict is authoritative: a string OR
 * a `null` is returned verbatim, and only its `undefined` (no signal) falls
 * through to the weaker Meetup-local (#953 CHH3 "Hares - X") and title (#1270
 * FEH3) parsers. Those lack the bare-kennel-code filter, so letting them run on
 * a non-`undefined` verdict could resurrect a value the shared extractor
 * deliberately rejected (Gemini/Codex PR #2038 review).
 */
function resolveMeetupHares(
  description: string | undefined,
  title: string | undefined,
): { hares: string | null | undefined; titleForDisplay: string | undefined } {
  // Meetup descriptions often use Markdown bold (**HHHARES**: ...) which
  // survives stripHtmlTags; strip ** / ## markers so the label regex matches.
  const descForHares = description
    ? stripHtmlTags(description, "\n").replace(/\*{1,2}|#{1,3}\s*/g, "")
    : undefined;

  const sharedDescHares = descForHares ? extractHaresFromDescription(descForHares) : undefined;
  if (sharedDescHares !== undefined) {
    // Authoritative verdict — real hare (string) or explicit clear (null).
    return { hares: sharedDescHares, titleForDisplay: title };
  }

  const localHares = extractHaresFromMeetupDescription(descForHares);
  if (localHares !== undefined) {
    return { hares: localHares, titleForDisplay: title };
  }

  // Final fallback: the hare line lives in the title; strip its span so names
  // don't render twice.
  const fromTitle = extractTitleHares(title);
  return { hares: fromTitle.hares, titleForDisplay: fromTitle.title ?? title };
}

/**
 * Resolve a run number from a Meetup title. Off unless `extractRunNumber` is
 * opted in per source. When a kennel stylizes its run number with a literal
 * prefix instead of "#" (e.g. Paris/Sans Clue "R*n", #1975), that prefix is
 * rewritten to "#" first — a literal `String.replaceAll`, not regex, so a `*`
 * in the token needs no escaping — and the shared `extractHashRunNumber` does
 * the parsing. Returns undefined when extraction is off or no number is found.
 */
/**
 * Extract a run number from a Meetup title. With `anchorTrail` (aggregate feeds)
 * only a trail-context "#N" (capture group 1 of `TITLE_TRAIL_RUN_RE`) counts — a
 * no-match returns undefined so the caller falls through to the description path
 * rather than the unanchored generic parser (the anchor is the whole point).
 * Without it, the generic `extractHashRunNumber` runs, after normalizing any
 * `runNumberPrefix` ("R*n", #1975) to "#".
 */
function runNumberFromTitle(
  title: string | undefined,
  anchorTrail: boolean,
  runNumberPrefix: string | undefined,
): number | undefined {
  if (anchorTrail) {
    const m = title ? TITLE_TRAIL_RUN_RE.exec(title) : null;
    if (!m?.[1]) return undefined;
    const n = Number.parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const normalized = runNumberPrefix && title ? title.replaceAll(runNumberPrefix, "#") : title;
  return extractHashRunNumber(normalized);
}

function resolveRunNumber(
  title: string | undefined,
  description: string | null | undefined,
  extractRunNumber: boolean,
  runNumberPrefix: string | undefined,
  anchorTrail = false,
): number | undefined {
  // Title extraction stays opt-in (#1562): free-form Meetup titles can promote
  // non-hash tokens ("Pub Crawl #2") into a runNumber that then poisons
  // fingerprinting. Only sources that confirm unambiguous title conventions
  // set `extractRunNumber: true`.
  if (extractRunNumber) {
    const fromTitle = runNumberFromTitle(title, anchorTrail, runNumberPrefix);
    if (fromTitle !== undefined) return fromTitle;
  }
  // Description extraction is default-on but anchored to a "trail" line so it
  // only fires on the hash-canonical "Trail #N" shape (#2167 Savannah, whose
  // titles are generic "Saturday Trail!" and carry the number in the body).
  // The per-line "trail" anchor keeps stray "#3" tokens in free prose from
  // promoting a bogus run number; no parallel run-number regex.
  return extractRunNumberFromMeetupDescription(description);
}

// Anchor for the hash-canonical "Trail #N" shape: the word "trail" (word
// boundary — so "Trailhead" / "trailing" don't match) immediately followed by
// "#" (whitespace allowed). This restricts description run-number extraction to
// a real run-number label, NOT any line that merely contains "trail" — prose
// like "Meet at Trailhead gate #3" or "choose trail option #2" must not promote
// a bogus number (Codex review). The shared `extractHashRunNumber` still parses
// the digits from the anchor position; this is only a locator, not a parser.
// ReDoS-safe: single `\s*`, no alternation (Sonar S5852).
const TRAIL_RUN_ANCHOR_RE = /\btrail\b\s*#/i; // NOSONAR S5852 — linear, no alternation

/**
 * Extract a hash run number from a Meetup event description. Scans each line for
 * the "Trail #N" anchor (#2167 Savannah: "Savannah H3 trail # 1338",
 * "Savannah H3 Trail #: 1334", "What: Trail #1335"; Charlotte's Markdown bold
 * "**Trail # 1244**" matches too). Parses from the anchor onward via the shared
 * `extractHashRunNumber` so a leading "#3" elsewhere on the line can't win.
 * Returns undefined when no trail-anchored number is present.
 *
 * Callers pass the already-resolved, boilerplate-stripped description
 * (`finalDesc`) — never a raw Apollo back-reference ("$44") and never a stale
 * group-template block — so neither unresolved refs nor recycled template run
 * numbers reach this parser (Codex/Gemini PR #2200 review).
 */
export function extractRunNumberFromMeetupDescription(
  description: string | null | undefined,
): number | undefined {
  if (!description) return undefined;
  for (const line of stripHtmlTags(description, "\n").split("\n")) {
    const anchor = TRAIL_RUN_ANCHOR_RE.exec(line);
    if (!anchor) continue;
    const n = extractHashRunNumber(line.slice(anchor.index));
    if (n !== undefined) return n;
  }
  return undefined;
}

/** Build a RawEventData from an Apollo event entry. */
export function buildRawEventFromApollo(
  ev: ApolloEvent,
  state: Record<string, Record<string, unknown>>,
  kennelTag: string,
  compiledPatterns?: [RegExp, string][],
  extractRunNumber = false,
  runNumberPrefix?: string,
  // Per-fetch context, bundled into one object so the signature stays within the
  // param-count budget. `blocks` are the group-template paragraph keys to strip
  // and `preCleaned` carries the already-computed cleaned description (wrapped so
  // a legitimately-`undefined` value is distinguishable from "not supplied" →
  // recompute) to avoid a second heavy cleanMeetupDescription (cheerio) pass per
  // event. `anchorTrail` opts the title run-number extractor into the
  // trail-context anchor (see `anchorTrailRunNumber`).
  opts?: { blocks?: Set<string>; preCleaned?: { value: string | undefined }; anchorTrail?: boolean },
): RawEventData {
  const { date, startTime } = ev.dateTime
    ? extractDateTime(ev.dateTime)
    : { date: "", startTime: undefined };
  // endTime is HH:MM only, so cross-date end timestamps (overnight runs) are dropped.
  const endParts = ev.endTime ? extractDateTime(ev.endTime) : undefined;
  const endTime = endParts && endParts.date === date ? endParts.startTime : undefined;

  const venueInfo = resolveVenue(state, ev.venue);

  // Override kennelTag if title matches a kennel pattern
  let resolvedKennelTag = kennelTag;
  if (compiledPatterns && ev.title) {
    for (const [re, tag] of compiledPatterns) {
      if (re.test(ev.title)) {
        resolvedKennelTag = tag;
        break;
      }
    }
  }

  const { hares, titleForDisplay } = resolveMeetupHares(ev.description, ev.title);
  const cleanedDesc = opts?.preCleaned
    ? opts.preCleaned.value
    : cleanMeetupDescription(ev.description, state);
  // Group-template boilerplate (#2058/#2059/#2062): strip paragraph blocks the
  // group reuses verbatim across >= 2 events (the standing recurring-event
  // template), keeping any run-specific blocks. A fully templated description
  // collapses to `null` (explicit clear, per merge.ts UPDATE contract) so the
  // stored boilerplate is wiped; a description with no boilerplate is returned
  // untouched. Hare extraction above still runs on the raw description — only
  // the stored `description` field is affected. `blocks` is undefined (or empty)
  // when called outside fetch() / with no detected template, so the strip is
  // skipped entirely and prior behavior is preserved.
  const blocks = opts?.blocks;
  const finalDesc =
    cleanedDesc !== undefined && blocks && blocks.size > 0
      ? stripBoilerplateBlocks(cleanedDesc, blocks)
      : cleanedDesc;

  return {
    date,
    kennelTags: [resolvedKennelTag],
    title: cleanMeetupTitle(titleForDisplay),
    // Run-number extraction (with optional "R*n"-style prefix normalization)
    // lives in resolveRunNumber so this builder stays under the cognitive-
    // complexity budget. Display title keeps the kennel's stylization.
    // Use finalDesc (Apollo-ref-resolved + boilerplate-stripped), not the raw
    // ev.description, so a "$44" cache ref or a stale group-template "Trail #N"
    // can't drive the run number (#2200 review).
    runNumber: resolveRunNumber(ev.title, finalDesc, extractRunNumber, runNumberPrefix, opts?.anchorTrail),
    description: finalDesc,
    hares,
    location: venueInfo.location,
    latitude: venueInfo.latitude,
    longitude: venueInfo.longitude,
    startTime,
    endTime,
    sourceUrl: ev.eventUrl || undefined,
  };
}

/**
 * For recurring events (those with a `series` field), fetch the individual
 * detail page to get customized title/description. Template events on the
 * list page often show generic data ("Saturday Trail!") instead of the
 * per-occurrence customization ("SAVH3 Trail #1324!").
 *
 * Non-fatal: individual fetch failures fall back to the list page data.
 * Concurrency limited to 3 concurrent fetches with 300ms batch delay.
 */
async function enrichRecurringEvents(
  events: ApolloEvent[],
  headers: Record<string, string>,
): Promise<{ detailPagesFetched: number; detailPagesEnriched: number }> {
  const recurring = events.filter((ev) => ev.series && ev.eventUrl);
  if (recurring.length === 0) return { detailPagesFetched: 0, detailPagesEnriched: 0 };

  let detailPagesEnriched = 0;
  const CONCURRENCY = 3;
  const BATCH_DELAY_MS = 300;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < recurring.length; i += CONCURRENCY) {
    if (i > 0) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));

    const batch = recurring.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (ev) => {
        const res = await safeFetch(ev.eventUrl!, { headers });
        if (!res.ok) return null;
        const html = await res.text();
        const { events: detailEvents } = extractApolloEvents(html);
        // Find the matching event on the detail page
        const match = detailEvents.find((d) => d.id === ev.id);
        return match ?? null;
      }),
    );

    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value) {
        const detail = result.value;
        const ev = batch[j];
        if (detail.title) ev.title = detail.title;
        if (detail.description) ev.description = detail.description;
        detailPagesEnriched++;
      }
    }
  }

  return { detailPagesFetched: recurring.length, detailPagesEnriched };
}

/**
 * Meetup.com HTML scraper adapter.
 *
 * Scrapes the public events page and extracts event data from the
 * embedded __APOLLO_STATE__ JSON (the Meetup v3 REST API was shut down
 * in Jan 2022 and the GraphQL API requires OAuth).
 *
 * Config: { groupUrlname: string, kennelTag: string }
 */
export class MeetupAdapter implements SourceAdapter {
  type = "MEETUP" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    let config: MeetupConfig;
    try {
      config = validateSourceConfig<MeetupConfig>(source.config, "MeetupAdapter", {
        groupUrlname: "string",
        kennelTag: "string",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid source config";
      return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days);

    const errorDetails: ErrorDetails = {};
    const events: RawEventData[] = [];
    const errors: string[] = [];

    const baseUrl = `https://www.meetup.com/${encodeURIComponent(config.groupUrlname)}/events/`;
    const pastUrl = `${baseUrl}?type=past`;
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };

    // Fetch upcoming + past pages in parallel
    const [upcomingResult, pastResult] = await Promise.allSettled([
      safeFetch(baseUrl, { headers }),
      safeFetch(pastUrl, { headers }),
    ]);

    // Upcoming page must succeed (fatal)
    if (upcomingResult.status === "rejected") {
      const message = `Failed to fetch Meetup events: ${upcomingResult.reason instanceof Error ? upcomingResult.reason.message : String(upcomingResult.reason)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: baseUrl, message }] } };
    }
    const upcomingRes = upcomingResult.value;
    if (!upcomingRes.ok) {
      const message = `Meetup page error ${upcomingRes.status} for group "${config.groupUrlname}"`;
      return {
        events: [],
        errors: [message],
        errorDetails: { fetch: [{ url: baseUrl, status: upcomingRes.status, message }] },
      };
    }
    const upcomingHtml = await upcomingRes.text();
    const { events: upcomingEvents, state: upcomingState } = extractApolloEvents(upcomingHtml);

    // Past page is non-fatal
    let pastEvents: ApolloEvent[] = [];
    let pastState: Record<string, Record<string, unknown>> = {};
    if (pastResult.status === "fulfilled" && pastResult.value.ok) {
      const pastHtml = await pastResult.value.text();
      const extracted = extractApolloEvents(pastHtml);
      pastEvents = extracted.events;
      pastState = extracted.state;
    }

    // Merge Apollo states (upcoming takes priority for shared keys)
    const mergedState = { ...pastState, ...upcomingState };

    // Deduplicate events by id (upcoming takes priority)
    const upcomingIds = new Set(upcomingEvents.map((ev) => ev.id));
    const pastOnly = pastEvents.filter((ev) => !upcomingIds.has(ev.id));
    const idDedupedEvents = [...upcomingEvents, ...pastOnly];

    // Track IDs exclusive to the past page (Meetup limits past page to ~10 most recent)
    const pastOnlyIds = new Set(pastOnly.map((ev) => ev.id));

    // Deduplicate template vs customized occurrences sharing the same date
    // then filter to date window before enriching (avoids unnecessary detail page fetches).
    // Past-only events are exempt from minDate since the past page is already limited.
    const allApolloEvents = dedupByDate(idDedupedEvents).filter((ev) => {
      if (!ev.dateTime) return true; // keep for downstream skip
      const d = new Date(ev.dateTime);
      if (pastOnlyIds.has(ev.id)) return d <= maxDate;
      return d >= minDate && d <= maxDate;
    });

    // Enrich recurring events with detail page data (mutates in-place)
    const { detailPagesFetched, detailPagesEnriched } =
      await enrichRecurringEvents(allApolloEvents, headers);

    // Only error when the upcoming page lacks Apollo state entirely (structural breakage).
    // An empty group with valid Apollo state or events outside the date window is valid.
    const upcomingHasApolloState = Object.keys(upcomingState).length > 0;
    if (!upcomingHasApolloState && upcomingEvents.length === 0) {
      const message = "No __NEXT_DATA__ Apollo state found on upcoming events page — page structure may have changed";
      errors.push(message);
      errorDetails.parse = [{ row: 0, error: message }];
    }

    // Detect group-template boilerplate structurally: a paragraph block the
    // group reuses verbatim across >= 2 events is part of its standing
    // recurring-event template, not run-specific notes (#2058/#2059/#2062).
    // Computed once over the post-enrichment event set (index-aligned with
    // allApolloEvents) so per-occurrence detail-page overrides are reflected.
    // The pre-cleaned values back the per-event "was boilerplate stripped?"
    // diagnostic below; the builder recomputes cleanMeetupDescription so both
    // stay consistent.
    const cleanedDescriptions = allApolloEvents.map((ev) =>
      cleanMeetupDescription(ev.description, mergedState),
    );
    const boilerplateBlocks = detectBoilerplateBlocks(cleanedDescriptions);

    const compiledPatterns = compileKennelPatterns(config.kennelPatterns);
    const anchorTrailRunNumber = config.anchorTrailRunNumber === true;
    let cancelledSkipped = 0;
    let adminNoticeSkipped = 0;
    let boilerplateDescriptionsDropped = 0;
    // Collect the titles we drop as admin notices so admins can audit
    // false positives in the scrape diagnostics (#1728).
    const adminNoticeTitles: string[] = [];
    for (const [i, ev] of allApolloEvents.entries()) {
      try {
        if (!ev.dateTime) continue;
        // Drop cancelled events at ingest. Meetup's Apollo payload exposes
        // `status: "CANCELLED"` for trails that were called off (e.g.
        // Charlotte H3 #1235, Jan 10 — weather cancellation, re-held later
        // as a different trail with the same number). Without this filter
        // they show on HashTracks as normal past runs with no cancellation
        // indicator; the reconcile pipeline transitions any pre-existing
        // CONFIRMED row to CANCELLED on the next scrape because the event
        // is no longer in the active set. See #917.
        if (ev.status === "CANCELLED") {
          cancelledSkipped++;
          continue;
        }
        // Drop platform-departure admin posts (kennel migration announcements,
        // farewell posts). Narwhal H3 surfaced "Moving to a new website site -
        // Last day in Meetup is March 10th" (#1689); Miami posted "...ARE
        // LEAVING MEETUP" (#1728). Routed through the shared skip-rules matcher
        // (#1739): the specific departure phrases drop unconditionally, while
        // the broad farewell words ("farewell"/"goodbye") are now signal-gated
        // so a real "Farewell Run Trail #42" still ingests.
        if (ev.title && isPlatformDepartureTitle(ev.title)) {
          adminNoticeSkipped++;
          adminNoticeTitles.push(ev.title);
          continue;
        }
        // Strict-boolean check (CodeRabbit PR #1612 review): the config is
        // hydrated from persisted JSON, where any truthy value would pass
        // through unintentionally. Only literal `true` opts in.
        const shouldExtractRunNumber = config.extractRunNumber === true;
        // Reuse the pre-pass cleaned value (index-aligned) so the builder
        // doesn't re-run the heavy cleanMeetupDescription/cheerio parse.
        const cleanedBefore = cleanedDescriptions[i];
        const rawEvent = buildRawEventFromApollo(ev, mergedState, config.kennelTag, compiledPatterns, shouldExtractRunNumber, config.runNumberPrefix, { blocks: boilerplateBlocks, preCleaned: { value: cleanedBefore }, anchorTrail: anchorTrailRunNumber });
        // Count events whose description had boilerplate removed (fully nulled
        // or partially stripped) vs. its pre-strip cleaned value.
        if (cleanedBefore !== undefined && rawEvent.description !== cleanedBefore) {
          boilerplateDescriptionsDropped++;
        }
        events.push(rawEvent);
      } catch (err) {
        const msg = `Failed to parse event "${ev.id}": ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        errorDetails.parse = [...(errorDetails.parse ?? []), { row: i, error: msg }];
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        groupUrlname: config.groupUrlname,
        eventsFound: idDedupedEvents.length,
        upcomingEventsFound: upcomingEvents.length,
        pastEventsFound: pastEvents.length,
        pastEventsIngested: allApolloEvents.filter((ev) => pastOnlyIds.has(ev.id)).length,
        eventsAfterDedup: allApolloEvents.length,
        cancelledSkipped,
        adminNoticeSkipped,
        adminNoticeTitles,
        boilerplateDescriptionsDropped,
        detailPagesFetched,
        detailPagesEnriched,
      },
    };
  }
}
