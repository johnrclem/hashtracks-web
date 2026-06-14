import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import {
  fetchHTMLPage,
  chronoParseDate,
  formatAmPmTime,
  normalizeHaresField,
  cleanLocationName,
  applyDateWindow,
  buildRunHareTitle,
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

// Per-kennel deep-link fragments → the run lands at that kennel's schedule
// section instead of the bare site root (#2014). These are Gamma's stable
// `#card-<id>` in-page nav anchors (the site's own "Back to…" links target
// them and they persist across re-publishes). We hardcode them because Gamma's
// deeply-nested SSR markup defeats cheerio's id resolution — `$("#card-…")` and
// `closest()` both return nothing on this page (the same nesting that forces
// the leaf-text linearize strategy above). An anchor that ever goes stale just
// lands the visitor at the top of the page — the same UX as the bare root.
const SECTION_ANCHORS: Record<KennelTag, string> = {
  vh3: "card-lmli4jg2j066rob", // "Victoria H3 Runs"
  dsmh3: "card-crvryp3aex0zqgj", // "Dark Side Runs"
  vk9h3: "card-jdsydiqd0hrhaqt", // "Victoria K9 H3"
};
// The shared "Up Cumming Hashes" card at the top. Card-only runs (e.g. the lone
// #944) appear here but NOT in any kennel's bottom schedule list, so they
// deep-link here instead — "View source" lands where the run actually is.
const UPCOMING_ANCHOR = "card-bh9pp0f7dagcfyu";

/**
 * Append a `#card-<id>` fragment to the source URL, replacing any existing
 * fragment. String ops (not `new URL`) so a malformed/relative `baseUrl` can't
 * throw at scrape time — output is identical for the absolute URLs we pass.
 */
function fragmentUrl(anchor: string, baseUrl: string): string {
  return `${baseUrl.split("#")[0]}#${anchor}`;
}

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
// A token that is *only* the word "needed"/"wanted" (a placeholder remnant left
// after splitting "X & needed"). Anchored — no \s*-adjacent alternation (S5852).
const NEEDED_ONLY_RE = /^(?:needed|wanted)$/i;
const TBA_RE = /\b(?:TBA|TBD)\b/i;
// Past-run write-up heading: "Hash#928 The Bifocals Run (May 23rd)". The theme
// sits between the run number and the trailing parenthetical date. We match
// just the "Hash #NNN " prefix and find the "(" via indexOf to avoid a
// negated-char-class quantifier that trips Sonar S5852.
const WRITEUP_HEAD_RE = /^Hash\s*#\s*(\d+)\s+/i;
const SUBTITLE_RE = /^\(.*\)$/;
const SECTION_BREAK_RE = /^(?:next page|back to)/i;

// Card-body fields are detected by their `Label: value` prefix. DSMH3 publishes
// bilingual slash-labels (`Location/Emplacement:`, `Hare/Lièvre & Host/Hôte:`,
// `Cost/Prix:`) the old English-only regexes never matched (#2156). We split on
// the first colon and keyword-match the lowercased label via `startsWith` — no
// complex bilingual alternation regex (Sonar S5852/S5843 safe), and a value like
// "Thursday … 2:30 pm" matches no field keyword so it falls through to the date
// parser, exactly as before.
function isWhereLabel(label: string): boolean {
  return (
    label === "where" ||
    label.startsWith("location") ||
    label.startsWith("emplacement")
  );
}
function isHareLabel(label: string): boolean {
  return label.startsWith("hare") || label.startsWith("lièvre");
}
function isCostLabel(label: string): boolean {
  return (
    label.startsWith("cost") ||
    label === "hash cash" ||
    label.startsWith("prix") ||
    label.startsWith("coût")
  );
}
function isNoteLabel(label: string): boolean {
  return (
    label.startsWith("on-after") ||
    label.startsWith("onafter") ||
    label.startsWith("note")
  );
}

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

/** Apply a "Where:" / "Location/Emplacement:" value → location + street + maps URL. */
function applyWhereValue(
  card: CardData,
  value: string,
  venueUrlMap: Map<string, string>,
): void {
  if (!value) return;
  const { location, street } = splitVenue(value);
  // Drop TBA/emoji/URL noise uniformly (also covers the old `TBA_RE` guard).
  const cleaned = cleanLocationName(location);
  if (!cleaned) return;
  card.location = cleaned;
  card.locationStreet = street;
  const url = venueUrlMap.get(value);
  if (url) card.locationUrl = url;
}

/** Apply a "Hare(s):" value → normalized name list, flagging "Hares needed". */
function applyHareValue(card: CardData, value: string): void {
  if (!value) {
    card.haresNeeded = true;
    return;
  }
  if (haresNeededIn(value)) card.haresNeeded = true;
  // Split on "&" and Oxford commas into name tokens, then drop any
  // "Hares needed/wanted" placeholder token so real names before it survive
  // (e.g. "Goes Down Well & Hares needed" → "Goes Down Well"). All string
  // ops + anchored regexes — no \s*-adjacent alternation (Sonar S5852).
  const parts = value
    .split("&")
    .flatMap((p) => p.split(","))
    .map((s) => s.trim())
    .filter((t) => t && !haresNeededIn(t) && !NEEDED_ONLY_RE.test(t));
  if (parts.length > 0) card.hares = parts.join(", ");
}

/** Apply a bare (label-less) body line → the card's date, if not already set. */
function applyCardDateLine(card: CardData, line: string): void {
  if (card.date) return;
  const parsed = parseDateString(line);
  if (!parsed) return;
  card.date = parsed;
  if (haresNeededIn(line)) card.haresNeeded = true;
}

/** Apply one card-body line to the in-progress card (mutates card + descParts). */
function applyCardLine(
  card: CardData,
  descParts: string[],
  line: string,
  venueUrlMap: Map<string, string>,
): void {
  // Split on the first colon → label + value. A label that matches a known
  // field keyword routes the value; anything else (incl. label-less date lines
  // whose only colon is in a time like "2:30 pm") falls through to the date/
  // subtitle handling below.
  const colonIdx = line.indexOf(":");
  const label = colonIdx >= 0 ? line.slice(0, colonIdx).trim().toLowerCase() : "";
  const value = colonIdx >= 0 ? line.slice(colonIdx + 1).trim() : "";

  if (label && isWhereLabel(label)) {
    applyWhereValue(card, value, venueUrlMap);
  } else if (label && isHareLabel(label)) {
    applyHareValue(card, value);
  } else if (label && isCostLabel(label)) {
    if (value) card.cost = value;
  } else if (label && isNoteLabel(label)) {
    if (value && !TBA_RE.test(value)) descParts.push(line);
  } else if (SUBTITLE_RE.test(line)) {
    descParts.push(line);
  } else {
    applyCardDateLine(card, line);
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
  let i = 0;
  while (i < lines.length) {
    const route = matchRoute(lines[i]);
    if (!route || isScheduleRest(route.rest)) {
      i++; // skip schedule lines; cards only
      continue;
    }
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (SECTION_BREAK_RE.test(next) || matchRoute(next) || WRITEUP_HEAD_RE.test(next)) break;
      body.push(next);
      j++;
    }
    const key = `${route.tag}#${route.runNumber}`;
    if (!map.has(key)) {
      map.set(key, buildCard(route.tag, route.runNumber, route.rest, body, venueUrlMap));
    }
    i = j; // resume at the line that ended this card's body
  }
  return map;
}

/** Themes for completed VH3 runs from the prose write-up headings. */
function parseWriteups(lines: string[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of lines) {
    const match = WRITEUP_HEAD_RE.exec(line);
    if (!match) continue;
    const run = Number.parseInt(match[1], 10);
    const rest = line.slice(match[0].length);
    const parenIdx = rest.indexOf("(");
    if (parenIdx === -1) continue;
    const theme = rest.slice(0, parenIdx).replace(/[,;:]\s*$/, "").trim();
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
  if (pd.explicitYear == null) {
    if (state.prevMonth != null && pd.month < state.prevMonth) state.yearOffset++;
    year = baseYear + state.yearOffset;
  } else {
    year = pd.explicitYear;
    state.yearOffset = year - baseYear;
  }
  state.prevMonth = pd.month;
  return year;
}

/** The three per-run lookup maps produced by the parse passes. */
interface ParsedMaps {
  scheduleMap: Map<string, ScheduleEntry>;
  cardMap: Map<string, CardData>;
  writeupMap: Map<number, string>;
}

/** Merge backbone + card + write-up data for a single run into a RawEventData. */
function buildEvent(
  tag: KennelTag,
  run: number,
  maps: ParsedMaps,
  year: number,
  pd: ParsedDate,
  sourceUrl: string,
): RawEventData {
  const key = `${tag}#${run}`;
  const sched = maps.scheduleMap.get(key);
  const card = maps.cardMap.get(key);

  const realHare = card?.hares ? normalizeHaresField(card.hares) : undefined;
  const haresNeeded = sched?.haresNeeded || card?.haresNeeded;
  const hares = realHare ?? (haresNeeded ? null : undefined);
  // A real card theme or completed-run write-up wins; otherwise emit a
  // source-faithful "Run #<N> w/ <hares>" / "Run #<N>" title instead of letting
  // the merge pipeline synthesize "<Kennel> Trail #<N>" (#2013).
  const explicitTitle = card?.theme ?? (tag === "vh3" ? maps.writeupMap.get(run) : undefined);
  const title = explicitTitle ?? buildRunHareTitle(run, hares);

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
    // Runs in the kennel's schedule list deep-link to that section; card-only
    // runs (no schedule entry) deep-link to the shared "Up Cumming" card (#2014).
    sourceUrl: fragmentUrl(sched ? SECTION_ANCHORS[tag] : UPCOMING_ANCHOR, sourceUrl),
  };
}

/** Assemble the final event list (union of schedule + card keys, year-resolved). */
function assembleEvents(
  maps: ParsedMaps,
  baseYear: number,
  sourceUrl: string,
): RawEventData[] {
  const runsByTag: Record<KennelTag, Set<number>> = {
    vh3: new Set(),
    dsmh3: new Set(),
    vk9h3: new Set(),
  };
  for (const entry of maps.scheduleMap.values()) runsByTag[entry.tag].add(entry.runNumber);
  for (const card of maps.cardMap.values()) runsByTag[card.tag].add(card.runNumber);

  const events: RawEventData[] = [];
  for (const tag of Object.keys(runsByTag) as KennelTag[]) {
    const runs = Array.from(runsByTag[tag]).sort((a, b) => a - b);
    const state: YearState = { prevMonth: null, yearOffset: 0 };
    for (const run of runs) {
      // Card date wins (curated near-term view); schedule list is the fallback.
      const pd = maps.cardMap.get(`${tag}#${run}`)?.date ?? maps.scheduleMap.get(`${tag}#${run}`);
      if (!pd) continue; // no date anywhere — cannot emit
      const year = resolveYear(pd, baseYear, state);
      events.push(buildEvent(tag, run, maps, year, pd, sourceUrl));
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

  const maps: ParsedMaps = {
    scheduleMap: parseScheduleMap(lines),
    cardMap: parseCards(lines, venueUrlMap),
    writeupMap: parseWriteups(lines),
  };
  const events = assembleEvents(maps, baseYear, sourceUrl);

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
