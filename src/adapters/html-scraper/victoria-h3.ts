import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import {
  fetchHTMLPage,
  chronoParseDate,
  formatAmPmTime,
  normalizeHaresField,
  applyDateWindow,
} from "../utils";

/**
 * Victoria H3 (vh3.ca) — Victoria, BC. One Gamma-platform SSR page hosting three
 * kennels: Victoria H3 (`vh3`), Dark Side of the Moon H3 (`dsmh3`), and Victoria
 * K9 H3 (`vk9h3`).
 *
 * The page carries the full current season twice:
 *  1. **Per-kennel "schedule lists"** at the bottom — clean, complete, dated run
 *     lines (`VH3 #918: Thursday, January 1, 2:30 pm.`). This is the backbone.
 *  2. **"Up Cumming" cards** near the top — the same near-term runs enriched with
 *     `Where:` / `Hare:` / `Cost:` / `On-afters:` lines (and the lone #944, which
 *     is only in the card section). These enrich the backbone, matched by
 *     (kennelTag, runNumber).
 *  3. A "Hash Write-ups" prose section gives completed VH3 runs a real theme/title.
 *
 * Gamma wraps every block in deeply nested divs, so a whole-document `.text()`
 * stack-overflows (domutils recursion). Instead we select the leaf text-block
 * node-view wrappers and read each one's (shallow) text, keying entirely on
 * visible content — the same content-keyed strategy the Wix/Google-Sites
 * scrapers use.
 *
 * Maps venues are `maps.app.goo.gl` shortlinks (no extractable lat/lng), so
 * coords are left undefined and the merge pipeline falls back to the Victoria, BC
 * region centroid.
 */

type KennelTag = "vh3" | "dsmh3" | "vk9h3";

const DEFAULT_URL = "https://vh3.ca/";

// Routing prefixes — distinct per kennel, anchored at the start of a block line.
// The captured group is the run number.
const ROUTES: { re: RegExp; tag: KennelTag }[] = [
  { re: /^VH3\s*#\s*(\d+)\b/i, tag: "vh3" },
  { re: /^Dark Side of the Moon Run\s*#\s*(\d+)\b/i, tag: "dsmh3" },
  { re: /^Victoria K9 H3\s*#\s*(\d+)\b/i, tag: "vk9h3" },
];

// All three kennels live on the one page and publish a full season; a zero-event
// kennel means the markup/prefix broke (or the kennel went dormant). Emit an
// error so scrape.ts skips reconcile — otherwise reconcile, scoped to all linked
// kennels, would false-cancel that kennel's future events while the others parse.
const EXPECTED_TAGS: readonly KennelTag[] = ["vh3", "dsmh3", "vk9h3"];

// Gamma renders each text block inside a node-view content wrapper. Selecting
// these leaves and reading their text avoids a full-document `.text()`.
const TEXT_BLOCK_SELECTOR =
  '[data-node-view-content-inner="paragraph"],[data-node-view-content-inner="heading"],[data-node-view-content-inner="title"]';

// A schedule-list run line carries its date inline, and the remainder after the
// run number starts (after an optional colon) with a weekday: "VH3 #918:
// Thursday, …" / "Victoria K9 H3 #71 Monday …". A card heading's remainder is a
// theme or empty and never starts with a weekday — so this discriminator stays
// correct even when a theme contains a month name (e.g. "May Day Madness").
const SCHEDULE_REST_RE = /^:?\s*(?:mon|tue|wed|thu|fri|sat|sun)/i;
// "2:30 pm", "7 pm", "at 7 pm" — single optional space before am/pm (Sonar S5852).
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s?(am|pm)/i;
const YEAR_PAREN_RE = /\((20\d{2})\)/;
const YEAR_BARE_RE = /\b(20\d{2})\b/;
const HARES_WORD_RE = /\bhares?\b/i;
const NEEDED_RE = /\b(?:needed|wanted)\b/i;
const TBA_RE = /\b(?:TBA|TBD)\b/i;
// Past-run write-up heading: "Hash#928 The Bifocals Run (May 23rd)". The theme
// is everything up to the opening "(" of the trailing date — a negated class
// keeps the match linear (avoids a lazy `.+?` ReDoS-shape flag, Sonar S5852).
const WRITEUP_RE = /^Hash\s*#\s*(\d+)\s+([^(]+)\(/i;
const WHERE_LABEL_RE = /^where\s*:/i;
const HARE_LABEL_RE = /^hares?\s*:/i;
const COST_LABEL_RE = /^(?:cost|hash cash)\s*:/i;
const NOTE_LABEL_RE = /^(?:on-?afters?|note)\s*:/i;
const SUBTITLE_RE = /^\(.*\)$/;
const SECTION_BREAK_RE = /^(?:next page|back to)/i;
const LABEL_VALUE_RE = /^[^:]*:\s*/;

const pad = (n: number) => String(n).padStart(2, "0");

/** "Hares needed" / "Hares wanted" placeholder detection (no `\s*`+alternation). */
function haresNeededIn(text: string): boolean {
  return HARES_WORD_RE.test(text) && NEEDED_RE.test(text);
}

/** A routed line whose remainder is an inline date (schedule list) vs a card heading. */
function isScheduleRest(rest: string): boolean {
  return SCHEDULE_REST_RE.test(rest);
}

interface ParsedDate {
  month: number; // 1-12
  day: number;
  explicitYear?: number;
  startTime?: string;
}

interface ScheduleEntry extends ParsedDate {
  tag: KennelTag;
  runNumber: number;
  haresNeeded: boolean;
}

interface CardData {
  tag: KennelTag;
  runNumber: number;
  date?: ParsedDate;
  haresNeeded: boolean;
  theme?: string;
  hares?: string;
  location?: string;
  locationStreet?: string;
  locationUrl?: string;
  cost?: string;
  description?: string;
}

/** Linearize the page into visible text-block lines, in document order. */
function linearize($: cheerio.CheerioAPI): string[] {
  const lines: string[] = [];
  $(TEXT_BLOCK_SELECTOR).each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) lines.push(text);
  });
  return lines;
}

/** Map a venue's display text → its Google Maps shortlink (for `locationUrl`). */
function buildVenueUrlMap($: cheerio.CheerioAPI): Map<string, string> {
  const map = new Map<string, string>();
  $('a[href*="maps.app.goo.gl"]').each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (href && text && !map.has(text)) map.set(text, href);
  });
  return map;
}

/** Season year from a "… Events YYYY" / "YYYY Runs" header; else current year. */
function resolveBaseYear(lines: string[]): number {
  for (const line of lines) {
    if (/runs|events|meet ?ups/i.test(line)) {
      const match = YEAR_BARE_RE.exec(line);
      if (match) return Number.parseInt(match[1], 10);
    }
  }
  return new Date().getUTCFullYear();
}

/** Match a kennel routing prefix; returns the tag, run number, and remainder. */
function matchRoute(
  line: string,
): { tag: KennelTag; runNumber: number; rest: string } | null {
  for (const { re, tag } of ROUTES) {
    const match = re.exec(line);
    if (match) {
      return {
        tag,
        runNumber: Number.parseInt(match[1], 10),
        rest: line.slice(match[0].length).trim(),
      };
    }
  }
  return null;
}

/**
 * Parse a date-bearing fragment into month/day (+ optional explicit year and
 * start time). chrono supplies month/day only — the season year is resolved
 * separately in {@link assembleEvents} so the Dec→Jan rollover is deterministic.
 */
function parseDateString(text: string): ParsedDate | null {
  let work = text.replace(/^[:\s]+/, "").replace(/^when\s*:\s*/i, "");

  let startTime: string | undefined;
  const time = TIME_RE.exec(work);
  if (time) {
    startTime = formatAmPmTime(
      Number.parseInt(time[1], 10),
      time[2] ? Number.parseInt(time[2], 10) : 0,
      time[3],
    );
    work = work.replace(time[0], " ");
  }

  // A parenthetical "(2027)" wins over a bare "2026"; both capture the year in
  // group 1 and the full match is what we strip from the date text.
  let explicitYear: number | undefined;
  const year = YEAR_PAREN_RE.exec(work) ?? YEAR_BARE_RE.exec(work);
  if (year) {
    explicitYear = Number.parseInt(year[1], 10);
    work = work.replace(year[0], " ");
  }

  // Drop placeholder words and the "at 7 pm" connector so chrono sees a clean date.
  work = work.replace(/\b(?:hares?|needed|wanted|at)\b/gi, " ");
  const iso = chronoParseDate(work, "en-US");
  if (!iso) return null;
  const [, mm, dd] = iso.split("-");
  return {
    month: Number.parseInt(mm, 10),
    day: Number.parseInt(dd, 10),
    explicitYear,
    startTime,
  };
}

/** Backbone events from the per-kennel schedule lists (date-on-same-line). */
function parseScheduleMap(lines: string[]): Map<string, ScheduleEntry> {
  const map = new Map<string, ScheduleEntry>();
  for (const line of lines) {
    const route = matchRoute(line);
    if (!route || !isScheduleRest(route.rest)) continue; // schedule lines carry an inline date
    const parsed = parseDateString(route.rest);
    if (!parsed) continue;
    const key = `${route.tag}#${route.runNumber}`;
    if (map.has(key)) continue;
    map.set(key, {
      ...parsed,
      tag: route.tag,
      runNumber: route.runNumber,
      haresNeeded: haresNeededIn(line),
    });
  }
  return map;
}

/** Split "Venue Name, 123 Street Rd." into venue + street (street starts w/ a digit). */
function splitVenue(value: string): { location: string; street?: string } {
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const streetIdx = parts.findIndex((p) => /^\d/.test(p));
  if (streetIdx > 0) {
    return {
      location: parts.slice(0, streetIdx).join(", "),
      street: parts.slice(streetIdx).join(", "),
    };
  }
  return { location: value };
}

/** Apply one card-body line to the in-progress card (mutates card + descParts). */
function applyCardLine(
  card: CardData,
  descParts: string[],
  line: string,
  venueUrlMap: Map<string, string>,
): void {
  if (WHERE_LABEL_RE.test(line)) {
    const value = line.replace(LABEL_VALUE_RE, "").trim();
    if (value && !TBA_RE.test(value)) {
      const { location, street } = splitVenue(value);
      card.location = location;
      card.locationStreet = street;
      const url = venueUrlMap.get(value);
      if (url) card.locationUrl = url;
    }
  } else if (HARE_LABEL_RE.test(line)) {
    const value = line.replace(LABEL_VALUE_RE, "").trim();
    if (!value || haresNeededIn(value)) card.haresNeeded = true;
    // Normalize the Oxford-comma "& " co-hare conjunction to a plain comma so
    // normalizeHaresField (comma-split) doesn't keep a leading "&" on a name.
    else card.hares = value.replace(/,?\s*&\s*/g, ", ");
  } else if (COST_LABEL_RE.test(line)) {
    const value = line.replace(LABEL_VALUE_RE, "").trim();
    if (value) card.cost = value;
  } else if (NOTE_LABEL_RE.test(line)) {
    const value = line.replace(LABEL_VALUE_RE, "").trim();
    if (value && !TBA_RE.test(value)) descParts.push(line);
  } else if (SUBTITLE_RE.test(line)) {
    descParts.push(line);
  } else if (!card.date) {
    const parsed = parseDateString(line);
    if (parsed) {
      card.date = parsed;
      if (haresNeededIn(line)) card.haresNeeded = true;
    }
  }
}

/** Build a card from its heading remainder + body lines. */
function buildCard(
  tag: KennelTag,
  runNumber: number,
  headingRest: string,
  body: string[],
  venueUrlMap: Map<string, string>,
): CardData {
  const card: CardData = { tag, runNumber, haresNeeded: false };
  const theme = headingRest.trim();
  if (theme && !haresNeededIn(theme)) card.theme = theme;

  const descParts: string[] = [];
  for (const line of body) {
    applyCardLine(card, descParts, line, venueUrlMap);
  }
  if (descParts.length > 0) card.description = descParts.join(" ");
  return card;
}

/** Enrichment cards (heading without a date on the line → date is in the body). */
function parseCards(
  lines: string[],
  venueUrlMap: Map<string, string>,
): Map<string, CardData> {
  const map = new Map<string, CardData>();
  for (let i = 0; i < lines.length; i++) {
    const route = matchRoute(lines[i]);
    if (!route || isScheduleRest(route.rest)) continue; // skip schedule lines; cards only

    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const next = lines[j];
      if (SECTION_BREAK_RE.test(next) || matchRoute(next) || WRITEUP_RE.test(next)) break;
      body.push(next);
    }
    const key = `${route.tag}#${route.runNumber}`;
    if (!map.has(key)) {
      map.set(key, buildCard(route.tag, route.runNumber, route.rest, body, venueUrlMap));
    }
    i = j - 1;
  }
  return map;
}

/** Themes for completed VH3 runs from the prose write-up headings. */
function parseWriteups(lines: string[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of lines) {
    const match = WRITEUP_RE.exec(line);
    if (!match) continue;
    const run = Number.parseInt(match[1], 10);
    const theme = match[2].replace(/[,;:]\s*$/, "").trim();
    if (theme && !map.has(run)) map.set(run, theme);
  }
  return map;
}

interface YearState {
  prevMonth: number | null;
  yearOffset: number;
}

/** Resolve the calendar year for a run, rolling Dec→Jan forward within a list. */
function resolveYear(pd: ParsedDate, baseYear: number, state: YearState): number {
  let year: number;
  if (pd.explicitYear != null) {
    year = pd.explicitYear;
    state.yearOffset = year - baseYear;
  } else {
    if (state.prevMonth != null && pd.month < state.prevMonth) state.yearOffset++;
    year = baseYear + state.yearOffset;
  }
  state.prevMonth = pd.month;
  return year;
}

/** Merge backbone + card + write-up data for a single run into a RawEventData. */
function buildEvent(
  tag: KennelTag,
  run: number,
  scheduleMap: Map<string, ScheduleEntry>,
  cardMap: Map<string, CardData>,
  writeupMap: Map<number, string>,
  year: number,
  pd: ParsedDate,
  sourceUrl: string,
): RawEventData {
  const key = `${tag}#${run}`;
  const sched = scheduleMap.get(key);
  const card = cardMap.get(key);

  const realHare = card?.hares ? normalizeHaresField(card.hares) : undefined;
  const haresNeeded = sched?.haresNeeded || card?.haresNeeded;
  const hares = realHare ?? (haresNeeded ? null : undefined);
  const title = card?.theme ?? (tag === "vh3" ? writeupMap.get(run) : undefined);

  return {
    date: `${year}-${pad(pd.month)}-${pad(pd.day)}`,
    kennelTags: [tag],
    runNumber: run,
    // Card (curated near-term view) wins over the bottom schedule list for a
    // last-minute time change, falling back to the schedule for runs w/o a card.
    startTime: card?.date?.startTime ?? sched?.startTime,
    title,
    hares,
    location: card?.location,
    locationStreet: card?.locationStreet,
    locationUrl: card?.locationUrl,
    cost: card?.cost,
    description: card?.description,
    sourceUrl,
  };
}

/** Assemble the final event list (union of schedule + card keys, year-resolved). */
function assembleEvents(
  scheduleMap: Map<string, ScheduleEntry>,
  cardMap: Map<string, CardData>,
  writeupMap: Map<number, string>,
  baseYear: number,
  sourceUrl: string,
): RawEventData[] {
  const runsByTag: Record<KennelTag, Set<number>> = {
    vh3: new Set(),
    dsmh3: new Set(),
    vk9h3: new Set(),
  };
  for (const entry of scheduleMap.values()) runsByTag[entry.tag].add(entry.runNumber);
  for (const card of cardMap.values()) runsByTag[card.tag].add(card.runNumber);

  const events: RawEventData[] = [];
  for (const tag of Object.keys(runsByTag) as KennelTag[]) {
    const runs = Array.from(runsByTag[tag]).sort((a, b) => a - b);
    const state: YearState = { prevMonth: null, yearOffset: 0 };
    for (const run of runs) {
      // Card date wins (curated near-term view); schedule list is the fallback.
      const pd = cardMap.get(`${tag}#${run}`)?.date ?? scheduleMap.get(`${tag}#${run}`);
      if (!pd) continue; // no date anywhere — cannot emit
      const year = resolveYear(pd, baseYear, state);
      events.push(buildEvent(tag, run, scheduleMap, cardMap, writeupMap, year, pd, sourceUrl));
    }
  }
  return events;
}

/** Parse the full Victoria H3 Gamma page into events. */
export function parseVictoriaH3Page(
  html: string,
  sourceUrl: string,
): { events: RawEventData[]; errors: string[] } {
  const $ = cheerio.load(html);
  const lines = linearize($);
  const venueUrlMap = buildVenueUrlMap($);
  const baseYear = resolveBaseYear(lines);

  const scheduleMap = parseScheduleMap(lines);
  const cardMap = parseCards(lines, venueUrlMap);
  const writeupMap = parseWriteups(lines);
  const events = assembleEvents(scheduleMap, cardMap, writeupMap, baseYear, sourceUrl);

  // Fail loud (and block reconcile) if any expected kennel produced no events —
  // a partial parse must not let reconcile cancel the broken kennel's future runs.
  const present = new Set(events.map((e) => e.kennelTags[0]));
  const errors: string[] = [];
  for (const tag of EXPECTED_TAGS) {
    if (!present.has(tag)) {
      errors.push(`Victoria H3: no runs parsed for ${tag} — Gamma markup may have changed or the kennel is dormant`);
    }
  }
  return { events, errors };
}

export class VictoriaH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { events, errors } = parseVictoriaH3Page(html, url);

    const result: ScrapeResult = {
      events,
      errors,
      structureHash,
      diagnosticContext: { eventsParsed: events.length, fetchDurationMs },
    };
    // Full-season page (past + future). Default wide so completed runs ingest;
    // `config.upcomingOnly` on the source keeps reconcile from cancelling them.
    return applyDateWindow(result, options?.days ?? 365);
  }
}
