/**
 * Bucharest H3 (bh3-ro, est. 1986) + Bucharest Full Moon H3 (bfmh3-ro) — first
 * 🇷🇴 Romania kennels.
 *
 * Both kennels share one public Google Sheet hareline ("BHHH Hareline", linked
 * from bucharesthash.carrd.co), read as the anonymous CSV export. Columns:
 *
 *   Run # | Date | Hare/s | Trail type and location | Start Time/ Extra
 *
 * The sheet is hand-kept, so the adapter is forgiving:
 *   - `#1299` rows are Bucharest H3, `FM#22` rows are the Full Moon sister hash.
 *     Rows with no run number (holidays, breaks, ad-hoc socials) are skipped, and
 *     so are numbered rows whose Hare cell says "No trail" (#2846).
 *   - Dates are D/M/YYYY, D/M/YY or D.M.YYYY, sometimes with a weekday or the
 *     run's name after them ("30/09/2023 Oktoberfest Saturday Run") or a range
 *     ("25-27/10/2024" → that weekend, with an end date). A date whose year is a
 *     typo (#1141 "27/05/2022" among 2023 rows) is repaired from run order (#2841).
 *   - Column 4 mixes a trail type ("A-A", "A- B", "A to B"), a meeting place and
 *     the run's theme, in any order: "Roofies Pre Birthday Run A-B starting at
 *     iancului metro stop". `parseTrailCell` splits it into those parts (#2842).
 *   - Column 5 may hold a start time ("2:00 PM", "3pm start"), the meeting place
 *     when column 4 has none ("Piata Victorei", #2840/#2843), or notes; otherwise
 *     the Carrd schedule applies — Sundays 14:00 (BH3), full-moon Fridays 19:00.
 *
 * The sheet is the only source for both kennels, so absent fields are emitted as
 * explicit nulls: a corrected row clears the stale value instead of keeping it.
 * The sheet keeps every run since #1132 (Feb 2023), so a wide `scrapeDays`
 * window loads the archive on the first scrape; `upcomingOnly: true` keeps
 * reconcile off the past rows.
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { filterEventsByWindow, trimEdgeChars } from "../utils";
import { safeFetch } from "../safe-fetch";
import { parseCSV } from "../google-sheets/adapter";
import { generateStructureHash } from "@/pipeline/structure-hash";

const DEFAULT_URL =
  "https://docs.google.com/spreadsheets/d/17NUJ3M9Th9fPi9oYkK8cLGhydW7nNq6yFMyD0x34fkQ/export?format=csv&gid=0";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/17NUJ3M9Th9fPi9oYkK8cLGhydW7nNq6yFMyD0x34fkQ/edit";

const BH3 = { tag: "bh3-ro", defaultTime: "14:00" };
const FULL_MOON = { tag: "bfmh3-ro", defaultTime: "19:00" };

const DAY_MS = 86_400_000;
const RUN_RE = /^(FM)? ?#(\d{1,5})$/i;
// "26/2/2023", "06/10/24", "31.10.2026", "25-27/10/2024". Bounded quantifiers only.
const DATE_RE = /(\d{1,2})(?:-(\d{1,2}))?[./](\d{1,2})[./](\d{4}|\d{2})\b/;
// "2:00 PM", "3.00pm", "3pm", "14:00", "4:00:00 PM". Bounded, no nested quantifiers.
const TIME_TOKEN_RE = /\b(\d{1,2})(?:[:.]([0-5]\d))?(?::\d{2})? ?(am|pm)?\b/gi;
// "Sat", "Tues", "Thurs", "Saturday" — but not "Saturn", "Sunset" or "Monster".
const WEEKDAY_RE = /\b(sun|mon|tue|wed|thu|fri|sat)(?:s|r|rs|day|sday|nesday|rsday|urday)?\b/i;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Trail type anywhere in the cell: "A-A", "A- B", "A-Aish", "A- A ish", "A to B".
const TRAIL_TYPE_DASH_RE = /\bA ?- ?([AB])(?: ?-? ?ish)?\b/i;
const TRAIL_TYPE_TO_RE = /\bA to ([AB])\b/i;
/** Marks where a trail type was cut out, so the text after it can be read as its venue. */
const TYPE_MARK = "";
// Segment separators: newline, comma, semicolon, the trail-type mark, a spaced
// dash or slash, "Mare- on" (dash after a word), whitespace after "!"/"?", and a
// sentence stop after a 5+ letter word (not "Strd." or "St.").
const SEGMENT_SPLIT_RE = /(\n|[,;]| [-–—/|] |(?<=\p{L})- |(?<=[!?])\s+|(?<=\p{L}{5})\. )/u;
const VENUE_LEAD_RE = /\b(?:start(?:ing)? point|start(?:s|ing)? at|starting|start:|meet(?:ing)? at|location:)\s*(?:the\s+)?/i;
const END_RE = /\bend(?:ing)?(?: at| in| possibly|:)\s*/i;
const NOTE_RE = /\b(?:on[ -]?after|onon)\b/i;
const TIME_IN_TEXT_RE = /\s(?:@|at)\s*\d/;
const LEADING_TIME_RE = /^\d{1,2}(?:(?:[:.]\d{2}){1,2}\s*(?:am|pm)?|\s*(?:am|pm))\b\s*/i;

/** Words after which the rest of the phrase is a street, square, park or station name. */
const VENUE_PREFIX_WORDS = new Set([
  "strada", "str", "strd", "calea", "piata", "parcul", "gara", "intrarea", "cimitirul",
  "bulevardul", "soseaua", "splaiul",
]);
/** Words that mark a phrase as a meeting place rather than a theme. */
const VENUE_WORDS = new Set([
  ...VENUE_PREFIX_WORDS, "metro", "station", "statia", "park", "statue", "statuia", "clubhouse",
]);
const VENUE_PHRASES = ["club house", "bus stop", "tram stop"];
/** Bucharest districts and stations the sheet names on their own ("Otopeni", "Cotroceni"). */
const KNOWN_PLACES = new Set([
  "otopeni", "cotroceni", "buftea", "cismigiu", "cismigui", "stefan cel mare", "aviatorilor",
  "herastrau", "baneasa", "pipera",
]);
/** Words that make a phrase a theme, never a bare place name. */
const THEME_WORDS = new Set([
  "trail", "run", "hash", "party", "theme", "birthday", "moon", "crawl", "day", "fest",
  "special", "race", "lockdown", "xmas", "christmas", "halloween",
]);
/** A phrase made only of these says nothing ("run", "Sunday trail", "(Saturday)"). */
const GENERIC_WORDS = new Set(["run", "trail", ...WEEKDAYS, ...WEEKDAY_NAMES]);
const VENUE_PLACEHOLDERS = new Set(["tbd", "tba", "?", "??"]);

function clean(text: string | undefined): string {
  return (text ?? "").replaceAll(/\s+/g, " ").trim();
}

/** Collapse spaces inside each line but keep the line breaks (they separate phrases). */
function normalizeCell(text: string | undefined): string {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => clean(line))
    .filter(Boolean)
    .join("\n");
}

/** Lowercase without diacritics: "Piața" → "piata", "Ștefan" → "stefan". */
function fold(text: string): string {
  return text.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase();
}

function words(text: string): string[] {
  return fold(text).split(/[^a-z0-9]+/).filter(Boolean);
}

function stripWrappingQuotes(text: string): string {
  const quotes = "\"'“”„";
  return quotes.includes(text.charAt(0)) && quotes.includes(text.charAt(text.length - 1))
    ? text.slice(1, -1).trim()
    : text;
}

/** True when the phrase says nothing beyond "run"/"trail"/a weekday. */
function isGeneric(text: string): boolean {
  return words(text).every((w) => GENERIC_WORDS.has(w));
}

function isKnownPlace(text: string): boolean {
  return KNOWN_PLACES.has(words(stripWrappingQuotes(text)).join(" "));
}

/** "Saturday Special Run" / "(Saturday) Red Dress Run" → the rest; "Friday 13th!" stays. */
function stripLeadingWeekday(text: string): string {
  const m = WEEKDAY_RE.exec(text);
  if (!m || (m.index !== 0 && !(m.index === 1 && text.startsWith("(")))) return text;
  const rest = text.slice(m.index + m[0].length);
  return /^\s*\d/.test(rest) ? text : trimEdgeChars(rest, " ()-–:,!");
}

/** The cell's day of week (0 = Sunday) when it names one, e.g. "27/05/2022 SATURDAY". */
function namedWeekday(text: string): number | undefined {
  const m = WEEKDAY_RE.exec(text);
  return m ? WEEKDAYS.indexOf(m[1].toLowerCase()) : undefined;
}

function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

export interface BucharestDateCell {
  date: string;
  /** Last day of a "25-27/10/2024" weekend. */
  endDate?: string;
  /** Text after the date, minus a leading weekday: the run's name ("Oktoberfest Saturday Run"). */
  theme?: string;
}

/** Date cell → date, optional end date and trailing theme; null if undated or invalid. */
export function parseBucharestDateCell(text: string): BucharestDateCell | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const month = Number.parseInt(m[3], 10);
  let year = Number.parseInt(m[4], 10);
  if (year < 100) year += 2000;
  const date = isoDate(year, month, Number.parseInt(m[1], 10));
  if (!date) return null;
  const endDate = m[2] ? isoDate(year, month, Number.parseInt(m[2], 10)) : null;
  const theme = trimEdgeChars(stripLeadingWeekday(trimEdgeChars(text.slice(m.index + m[0].length), " -–:,")), " -–:,");
  return {
    date,
    ...(endDate && endDate > date ? { endDate } : {}),
    ...(/\p{L}/u.test(theme) ? { theme } : {}),
  };
}

/** First D/M/Y date in the cell → "YYYY-MM-DD"; null if none or invalid. */
export function parseBucharestDate(text: string): string | null {
  return parseBucharestDateCell(text)?.date ?? null;
}

/**
 * First clock time in free text → "HH:MM": "2:00 PM", "3.00 pm", "3pm start",
 * "14:00", "4:00:00 PM". A bare "2:00" with no am/pm and an hour of 1–7 is read
 * as afternoon (the hash never starts at 2 AM). Undefined if none.
 */
export function parseBucharestTime(text: string): string | undefined {
  for (const m of text.matchAll(TIME_TOKEN_RE)) {
    const minutes = m[2];
    const ampm = m[3]?.toLowerCase();
    if (minutes === undefined && ampm === undefined) continue; // a bare number
    let h = Number.parseInt(m[1], 10);
    if (h > 23 || (ampm && h > 12)) continue;
    if (ampm === "pm" && h < 12) h += 12;
    else if (ampm === "am" && h === 12) h = 0;
    else if (!ampm && h >= 1 && h <= 7) h += 12;
    return `${String(h).padStart(2, "0")}:${minutes ?? "00"}`;
  }
  return undefined;
}

/** True when the text is only clock times and "start"/"sharp" ("2 pm", "2pm start"). */
function isTimeOnly(text: string): boolean {
  const rest = text.replaceAll(TIME_TOKEN_RE, " ").replaceAll(/\b(?:start|sharp)\b/gi, " ");
  return !/\p{L}/u.test(rest);
}

/** "A, B + C and D" → sorted "A, B, C, D"; blank → undefined. */
export function splitHares(text: string): string | undefined {
  const names = clean(text)
    .replaceAll(/\(\s*\+\s*([^)]*)\)/g, ",$1") // "Just Jan (+IBL)" → "Just Jan, IBL"
    .replaceAll(/\b(?:co[ -]?)?hares?\s*:/gi, ",") // "Hare: X Co Hare: Y"
    .split(/\s+and\s+|[,+&]/i)
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s)); // drops "??"
  if (names.length === 0) return undefined;
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
}

export interface BucharestHareCell {
  hares: string | null;
  /** A run name written in the Hare column ("Bach party for McDickhead!"). */
  theme?: string;
  noTrail: boolean;
}

/** Leading-name markers in a hare cell that reads as a sentence: "Homo special run". */
const HARE_PROSE_MARKERS = [" special run", " run", " takes us"];

/**
 * Hare cell → hare list (#2844). Drops a trailing date and note ("Roofie and
 * Cocktrails 2/3/2024 - Texas Independence Day run)"), and reads a one-phrase
 * cell with no list delimiters as a theme with an optional leading hare name
 * ("Tooth fairy run at 2pm" → hare "Tooth fairy").
 */
export function parseHareCell(text: string): BucharestHareCell {
  let cell = clean(text);
  if (/^no (?:trail|run|hash)\b/i.test(cell)) return { hares: null, noTrail: true };
  let theme: string | undefined;
  const date = DATE_RE.exec(cell);
  if (date) {
    const after = trimEdgeChars(cell.slice(date.index + date[0].length), " -–:,()");
    if (/\p{L}/u.test(after)) theme = after;
    cell = cell.slice(0, date.index).trim();
  }
  const isList = /[,+&]|\band\b/i.test(cell);
  if (!isList && (/\b(?:run|trail|party|takes us)\b/i.test(cell) || cell.endsWith("!"))) {
    const lower = cell.toLowerCase();
    const cut = HARE_PROSE_MARKERS.map((m) => lower.indexOf(m)).filter((i) => i > 0);
    const name = cut.length ? cell.slice(0, Math.min(...cut)).trim() : "";
    return { hares: name && name.split(" ").length <= 3 ? name : null, theme: cell, noTrail: false };
  }
  return { hares: splitHares(cell) ?? null, theme, noTrail: false };
}

/**
 * Where the meeting place starts inside a phrase that names one, or -1 when the
 * phrase names no place. "Worm Moon Parcul Păsărari" → at "Parcul"; "Gathering at
 * 18:45 hash sharp at Metro Aurel Vlaicu" → after the last " at ".
 */
function venueStart(text: string): number {
  let prefixAt = -1;
  let hasVenueWord = VENUE_PHRASES.some((p) => fold(text).includes(p));
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = fold(m[0]);
    if (VENUE_WORDS.has(w)) hasVenueWord = true;
    if (prefixAt < 0 && VENUE_PREFIX_WORDS.has(w)) prefixAt = m.index;
  }
  if (!hasVenueWord) return -1;
  // "103-105 Calea Victoriei" keeps its number; "Live Trail Cimitirul …" drops the theme.
  if (prefixAt > 0 && /\p{L}{2}/u.test(text.slice(0, prefixAt))) return prefixAt;
  const at = text.toLowerCase().lastIndexOf(" at ");
  if (prefixAt < 0 && at >= 0 && !/^\s*\d/.test(text.slice(at + 4))) return at + 4;
  return 0;
}

/** Venue text → display form: drops a trailing time, "at", "start", "Trail", quotes. */
function cleanVenue(text: string): string {
  let v = text;
  const time = TIME_IN_TEXT_RE.exec(v);
  if (time) v = v.slice(0, time.index);
  v = v.replace(LEADING_TIME_RE, "");
  v = trimEdgeChars(v.trim(), " .,;:!-–");
  for (const prefix of ["start ", "at ", "the "]) {
    if (v.toLowerCase().startsWith(prefix)) v = v.slice(prefix.length).trim();
  }
  for (const suffix of [" start", " trail", " run"]) {
    if (v.toLowerCase().endsWith(suffix)) v = v.slice(0, -suffix.length).trim();
  }
  v = stripWrappingQuotes(v);
  return VENUE_PLACEHOLDERS.has(v.toLowerCase()) ? "" : v;
}

/** True for a short phrase that can only be a place: "Cotroceni", "at Chez IBL". */
function isPlaceLike(text: string): boolean {
  if (/[!?@"“”]/.test(text) || !/\p{L}/u.test(text)) return false;
  const w = words(text);
  return w.length <= 5 && !w.some((x) => THEME_WORDS.has(x));
}

export interface BucharestTrailCell {
  trailType: string | null;
  venues: string[];
  /** "end at X" — the venue when an A-to-A trail names only its end. */
  endVenue?: string;
  /** The note the end venue came from, dropped when the end venue becomes the location. */
  endNote?: string;
  /** Theme phrases joined in sheet order, or undefined. */
  title?: string;
  notes: string[];
  /** Text that is none of the above and not just a time (Extra column only). */
  hasLeftover: boolean;
}

/** Cut the first trail type out of the text, leaving TYPE_MARK in its place. */
function extractTrailType(text: string): { text: string; trailType: string | null } {
  const m = TRAIL_TYPE_DASH_RE.exec(text) ?? TRAIL_TYPE_TO_RE.exec(text);
  if (!m) return { text, trailType: null };
  let end = m.index + m[0].length;
  const generic = /^ (?:run|trail)\b/i.exec(text.slice(end)); // "A-B Run Strada …"
  if (generic) end += generic[0].length;
  return {
    text: `${text.slice(0, m.index)}${TYPE_MARK}${text.slice(end)}`,
    trailType: m[1].toUpperCase() === "A" ? "A to A" : "A to B",
  };
}

/** How a separator joins two adjacent theme phrases back into a title. */
function joiner(sep: string): string {
  if (sep === "\n") return " / ";
  if (sep === "," || sep === ";") return `${sep} `;
  if (sep === TYPE_MARK || sep.trim() === "") return " ";
  return sep;
}

/**
 * Split the "Trail type and location" cell (or the Extra cell) into trail type,
 * meeting place, theme and notes (#2842):
 *
 *   "Texas Independence Day A to B start at Parcul Timpuri Noi end at Restaurant"
 *     → type "A to B", venue "Parcul Timpuri Noi", title "Texas Independence Day",
 *       note "end at Restaurant"
 */
export function parseTrailCell(cell: string): BucharestTrailCell {
  const { text, trailType } = extractTrailType(cell);
  const out: BucharestTrailCell = { trailType, venues: [], notes: [], hasLeftover: false };
  const parts = text.split(SEGMENT_SPLIT_RE);
  const themes: { index: number; text: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const afterType = parts[i - 1] === TYPE_MARK;
    const theme = classifySegment(parts[i].trim(), afterType, out);
    if (theme) themes.push({ index: i, text: theme });
  }
  let title = "";
  for (let t = 0; t < themes.length; t++) {
    const { index, text: phrase } = themes[t];
    if (t > 0) title += themes[t - 1].index === index - 2 ? joiner(parts[index - 1]) : ", ";
    title += phrase;
  }
  title = trimEdgeChars(title, " -–—,:;/");
  if (title && !isGeneric(title)) out.title = title;
  return out;
}

/** File one phrase into `out`; returns the part of it that is theme text, if any. */
function classifySegment(segment: string, afterType: boolean, out: BucharestTrailCell): string | undefined {
  let text = segment;
  if (!text) return undefined;
  if (/^circle\b/i.test(text) || /\bfollowed by\b/i.test(text)) {
    out.notes.push(text);
    return undefined;
  }
  const note = NOTE_RE.exec(text);
  if (note) {
    out.notes.push(text.slice(note.index));
    text = text.slice(0, note.index).trim();
  }
  const end = END_RE.exec(text);
  if (end) {
    const rest = cleanVenue(text.slice(end.index + end[0].length));
    const endNote = text.slice(end.index).trim();
    if (/ at|:/.test(end[0]) && rest && !out.endVenue) {
      out.endVenue = rest;
      out.endNote = endNote;
    }
    out.notes.push(endNote);
    text = text.slice(0, end.index).trim();
  }
  if (/^start (?:tbd|tba)\b/i.test(text)) {
    out.notes.push(text);
    return undefined;
  }
  const lead = VENUE_LEAD_RE.exec(text);
  if (lead) {
    const venue = cleanVenue(text.slice(lead.index + lead[0].length));
    if (venue) out.venues.push(venue);
    text = text.slice(0, lead.index).trim();
  }
  if (!text || isGeneric(text)) return undefined;
  const start = venueStart(text);
  if (start >= 0 || isKnownPlace(cleanVenue(text)) || (afterType && isPlaceLike(text))) {
    const venue = cleanVenue(text.slice(Math.max(start, 0)));
    if (venue) out.venues.push(venue);
    text = start > 0 ? text.slice(0, start).trim() : "";
    if (!text || isGeneric(text)) return undefined;
  }
  if (!isTimeOnly(text)) out.hasLeftover = true;
  return stripLeadingWeekday(text) || undefined;
}

/** True when the extra cell says more than a bare time ("2:00 PM", "14:00"). */
function hasNotes(extra: string): boolean {
  const letters = extra.replaceAll(/\b(?:am|pm)\b/gi, "").replaceAll(/[^A-Za-z]/g, "");
  return letters.length >= 3;
}

/** One sheet row → event, or null for header / unnumbered / undated / "No trail" rows. */
export function parseBucharestRow(row: string[]): RawEventData | null {
  const run = RUN_RE.exec(clean(row[0]));
  if (!run) return null;
  const dateCell = parseBucharestDateCell(clean(row[1]));
  if (!dateCell) return null;
  const hareCell = parseHareCell(row[2] ?? "");
  if (hareCell.noTrail) return null;
  const kennel = run[1] ? FULL_MOON : BH3;
  const placeText = normalizeCell(row[3]);
  const extraText = normalizeCell(row.slice(4).join("\n"));
  const place = parseTrailCell(placeText);
  const extra = parseTrailCell(extraText);

  let notes = place.notes;
  let location = place.venues.join(", ");
  if (!location && place.trailType === "A to A" && place.endVenue) {
    location = place.endVenue; // "A-A end at clubhouse": it starts there too
    notes = notes.filter((n) => n !== place.endNote);
  }
  const venueFromExtra = !location && extra.venues.length > 0;
  if (venueFromExtra) location = extra.venues.join(", ");

  const themes = [place.title, dateCell.theme, hareCell.theme].filter((t): t is string => !!t);
  const title = themes[0];
  const extraLine = extraText.replaceAll("\n", " ");
  const extraIsOnlyVenue = venueFromExtra && !extra.hasLeftover && extra.notes.length === 0;
  const description = [
    ...(hasNotes(extraLine) && !extraIsOnlyVenue ? [extraLine] : []),
    ...notes,
    ...themes.slice(1).filter((t) => fold(t) !== fold(title ?? "")),
  ];

  const time = parseBucharestTime(extraText) ?? parseBucharestTime(placeText);
  return {
    date: dateCell.date,
    ...(dateCell.endDate ? { endDate: dateCell.endDate } : {}),
    kennelTags: [kennel.tag],
    runNumber: Number.parseInt(run[2], 10),
    title,
    hares: hareCell.hares,
    location: location || null,
    trailType: place.trailType ?? extra.trailType,
    startTime: time ?? kennel.defaultTime,
    description: description.length > 0 ? [...new Set(description)].join("\n") : null,
    sourceUrl: SHEET_URL,
  };
}

/**
 * Repair a year typo from the run's neighbours (#2841): the same day and month in
 * the previous kept run's year (or the next year), when that lands on or after the
 * previous run, within 60 days of it, no later than the next run, and on the
 * weekday the cell names (if any). Null when no year fits.
 */
export function repairYear(date: string, prev: string, next: string | undefined, weekday?: number): string | null {
  const [, month, day] = date.split("-").map(Number);
  const prevYear = Number(prev.slice(0, 4));
  for (const year of [prevYear, prevYear + 1]) {
    const candidate = isoDate(year, month, day);
    if (!candidate || candidate < prev || (next && candidate > next)) continue;
    if (Date.parse(candidate) - Date.parse(prev) > 60 * DAY_MS) continue;
    if (weekday !== undefined && new Date(`${candidate}T12:00:00Z`).getUTCDay() !== weekday) continue;
    return candidate;
  }
  return null;
}

/**
 * Parse the CSV. A numbered row whose date lands more than ~6 months before the
 * previous kept row of the same kennel has a year typo: its year is repaired from
 * the neighbouring runs, or the row is dropped (and counted) when no year fits.
 */
export function parseBucharestSheet(csv: string): {
  events: RawEventData[];
  skippedOutOfOrder: number;
  repairedDates: string[];
} {
  const rows = parseCSV(csv)
    .map((row) => ({ event: parseBucharestRow(row), weekday: namedWeekday(clean(row[1])) }))
    .filter((r): r is { event: RawEventData; weekday: number | undefined } => r.event !== null);
  const events: RawEventData[] = [];
  const repairedDates: string[] = [];
  const lastDate = new Map<string, string>();
  let skippedOutOfOrder = 0;
  rows.forEach(({ event, weekday }, i) => {
    const tag = event.kennelTags[0];
    const prev = lastDate.get(tag);
    if (prev && Date.parse(event.date) < Date.parse(prev) - 180 * DAY_MS) {
      const next = rows.slice(i + 1).find((r) => r.event.kennelTags[0] === tag && r.event.date >= prev)?.event.date;
      const repaired = repairYear(event.date, prev, next, weekday);
      if (!repaired) {
        skippedOutOfOrder++;
        return;
      }
      repairedDates.push(`#${event.runNumber} ${event.date} → ${repaired}`);
      event.date = repaired;
    }
    lastDate.set(tag, event.date);
    events.push(event);
  });
  return { events, skippedOutOfOrder, repairedDates };
}

export class BucharestHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const fetchStart = Date.now();
    let csv: string;
    try {
      const res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      csv = await res.text();
    } catch (err) {
      const message = `BH3-RO: fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } };
    }

    const errors: string[] = [];
    // A sign-in page or HTML error comes back as 200 text/html, not CSV.
    if (!csv.startsWith("Run #")) {
      errors.push(`BH3-RO: unexpected sheet export (no "Run #" header) at ${url}`);
      return { events: [], errors };
    }
    const { events, skippedOutOfOrder, repairedDates } = parseBucharestSheet(csv);
    if (events.length === 0) errors.push(`BH3-RO: no numbered runs parsed from ${url}`);
    const windowed = filterEventsByWindow(events, options?.days ?? 90);

    return {
      events: windowed,
      errors,
      structureHash: generateStructureHash(csv.split("\n")[0] ?? ""),
      diagnosticContext: {
        totalBeforeFilter: events.length,
        eventsParsed: windowed.length,
        skippedOutOfOrder,
        repairedDates,
        fetchDurationMs: Date.now() - fetchStart,
      },
    };
  }
}
