import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError } from "../types";
import {
  fetchHTMLPage,
  filterEventsByWindow,
  formatAmPmTime,
  isoDate,
  normalizeHaresField,
  stripZeroWidth,
  trimEdgeChars,
} from "../utils";

const KENNEL_TAG = "kaohsiung-h3";
const DEFAULT_URL = "https://www.kaohsiunghash.com/run-information";

// A run heading looks like "#2732 June 27 Saturday Night Run". The "#NNNN"
// marks a run; non-run content blocks (sponsor bar, "Dragon Boats", etc.)
// carry no run number and are skipped.
const RUN_RE = /#\s*(\d{3,5})\b/;

// Month + day parsed in two simple passes (avoids a single ReDoS-shaped regex
// per the Sonar S5852/S5843 guidance and the boiseh3 two-pass precedent).
// MONTH_WORD_RE only yields candidate alphabetic words (no month alternation,
// so no regex-complexity bump); each candidate is validated by exact lookup in
// MONTH_INDEX, which also rules out near-words like "Maybe".
const MONTH_WORD_RE = /\b[a-z]{3,9}\b/gi;
const DAY_RE = /^\s*(\d{1,2})\b/;
// Keyed by both full name and abbreviation so the matched month word is looked
// up exactly. A Map avoids object-key injection on a computed lookup (flagged
// by Gemini / detect-object-injection).
const MONTH_INDEX = new Map<string, number>([
  ["january", 0], ["jan", 0],
  ["february", 1], ["feb", 1],
  ["march", 2], ["mar", 2],
  ["april", 3], ["apr", 3],
  ["may", 4],
  ["june", 5], ["jun", 5],
  ["july", 6], ["jul", 6],
  ["august", 7], ["aug", 7],
  ["september", 8], ["sep", 8],
  ["october", 9], ["oct", 9],
  ["november", 10], ["nov", 10],
  ["december", 11], ["dec", 11],
]);

// Time prose: a 12-hour clock ("6:30PM", "7PM") or a bare 24-hour clock
// ("around 19:00"). Two separate patterns, scanned in priority order.
// `\s?` (not `\s*`) keeps the AM/PM join free of the S5852 backtracking shape.
const TIME_12H_RE = /\b(\d{1,2})(?::([0-5]\d))?\s?([AaPp][Mm])\b/;
const TIME_24H_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/;

// Cost prose: "Run Costs are NTD300 per person".
const COST_RE = /\bNTD?\$?\s?(\d{2,5})\b/i;

// Maps links are validated against an https + host allowlist (mirrors
// taipei-hash.ts MAPS_HOSTS; Codacy flags un-validated variable URLs).
const MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
  "maps.google.com",
]);

// Venue placeholders that should NOT be stored as a location.
const PLACEHOLDER_VENUE_RE = /\b(stay tuned|tba|tbd|to come|to be (?:announced|decided))\b/i;

interface Block {
  text: string;
  /** Visual lines (`<p>`/heading/`<br>` breaks); `text` keeps the raw concatenation. */
  lines: string[];
  /** The block is only `<h1>`s: the 2026-11 layout's unlabelled hare names. */
  isH1: boolean;
  mapsUrl?: string;
}

interface ParsedRun {
  runNumber: number;
  date: string;
  title?: string;
  hares?: string;
  location?: string;
  locationUrl?: string;
  startTime?: string;
  cost?: string;
  description?: string;
}

function normalizeText(raw: string): string {
  return stripZeroWidth(raw).replaceAll(/\s+/g, " ").trim();
}

function isValidMapsUrl(href: string): boolean {
  try {
    const parsed = new URL(href);
    return parsed.protocol === "https:" && MAPS_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Resolve a year-less month/day to the nearest upcoming "YYYY-MM-DD" (UTC). */
function resolveForwardDate(monthIdx: number, day: number, now: Date): string {
  const PAST_GRACE_MS = 60 * 24 * 3600 * 1000;
  const year = now.getUTCFullYear();
  let ms = Date.UTC(year, monthIdx, day, 12, 0, 0);
  if (ms < now.getTime() - PAST_GRACE_MS) {
    ms = Date.UTC(year + 1, monthIdx, day, 12, 0, 0);
  }
  return new Date(ms).toISOString().slice(0, 10);
}

// A day written before the month ("Saturday, 14 November 2026"), matched on the
// text that precedes the month word once trailing space is trimmed.
const DAY_BEFORE_MONTH_RE = /(?:^|\D)(\d{1,2})$/;
const YEAR_RE = /^(\d{4})\b/;

/** Consume an optional ", 2026" year after the day/month; procedural to stay Sonar-clean. */
function takeYear(text: string): { year?: number; rest: string } {
  let s = text.trimStart();
  if (s.startsWith(",")) s = s.slice(1).trimStart();
  const m = YEAR_RE.exec(s);
  return m ? { year: Number(m[1]), rest: s.slice(m[0].length) } : { rest: text };
}

/**
 * First "Month D" ("November 28, 2026") or "D Month" ("14 November 2026") date
 * in `text`. A month word with no adjacent day ("you may bring") is skipped. An
 * explicit year is honoured; a year-less date resolves forward. The text after
 * the date is returned as the title candidate.
 */
function parseHeadingDate(text: string, now: Date): { date: string; title?: string } | null {
  for (const m of text.matchAll(MONTH_WORD_RE)) {
    const monthIdx = MONTH_INDEX.get(m[0].toLowerCase());
    if (monthIdx === undefined) continue;
    const afterMonth = text.slice(m.index + m[0].length);
    const dm = DAY_RE.exec(afterMonth);
    const bm = dm ? null : DAY_BEFORE_MONTH_RE.exec(text.slice(0, m.index).trimEnd());
    const dayText = dm?.[1] ?? bm?.[1];
    if (!dayText) continue;
    const day = Number.parseInt(dayText, 10);
    if (day < 1 || day > 31) continue;
    const { year, rest } = takeYear(dm ? afterMonth.slice(dm[0].length) : afterMonth);
    // An explicit year is trusted only near `now`: "11 November 1918" in prose isn't a run.
    if (year !== undefined && Math.abs(year - now.getUTCFullYear()) > 1) continue;
    const date = year === undefined ? resolveForwardDate(monthIdx, day, now) : isoDate(year, monthIdx + 1, day);
    if (!date) continue;
    const title = rest.trim();
    return { date, title: title || undefined };
  }
  return null;
}

function parseStartTime(prose: string, title: string | undefined): string | undefined {
  const m12 = TIME_12H_RE.exec(prose);
  if (m12) {
    const hour = Number.parseInt(m12[1], 10);
    const minute = m12[2] ? Number.parseInt(m12[2], 10) : 0;
    // Only a real 1–12 clock hour is a 12-hour time ("13PM" is junk).
    if (hour >= 1 && hour <= 12 && minute <= 59) {
      return formatAmPmTime(hour, minute, m12[3]);
    }
  }
  const m24 = TIME_24H_RE.exec(prose);
  if (m24) {
    return `${m24[1].padStart(2, "0")}:${m24[2]}`;
  }
  // Fallback by run type from the heading/title.
  const label = (title ?? "").toLowerCase();
  if (label.includes("night")) return "19:00";
  if (label.includes("afternoon")) return "13:00";
  if (label.includes("family") || label.includes("sunday")) return "09:00";
  return undefined;
}

// Venue cue. The `\b` word boundary avoids false positives inside a larger
// word ("timeet at"); `\s+` absorbs arbitrary spacing before the venue text.
const MEET_AT_RE = /\bmeet at\s+/i;

/** The venue, or undefined when empty or a placeholder ("Stay tuned", "TBA"). */
function realVenue(venue: string): string | undefined {
  return venue && !PLACEHOLDER_VENUE_RE.test(venue) ? venue : undefined;
}

function parseLocation(prose: string): string | undefined {
  const m = MEET_AT_RE.exec(prose);
  if (!m) return undefined;
  const rest = prose.slice(m.index + m[0].length);
  const dot = rest.indexOf(".");
  return realVenue((dot >= 0 ? rest.slice(0, dot) : rest).trim());
}

const WHERE_LABEL = "where:";
const MEETING_POINT_LABEL = "meeting point:";
const LINK_TEXT_SUFFIX = " here";

/**
 * Venue from a "Where: Meeting point: Guanyinshan Triangle Park HERE" line
 * (2026-11 layout), with the label, "Meeting point:" and the "HERE" link text dropped.
 */
function parseWhereLine(lines: string[]): string | undefined {
  const line = lines.find((l) => l.toLowerCase().startsWith(WHERE_LABEL));
  if (!line) return undefined;
  let value = line.slice(WHERE_LABEL.length).trim();
  if (value.toLowerCase().startsWith(MEETING_POINT_LABEL)) value = value.slice(MEETING_POINT_LABEL.length).trim();
  if (value.toLowerCase().endsWith(LINK_TEXT_SUFFIX)) value = value.slice(0, -LINK_TEXT_SUFFIX.length);
  // The line is the venue alone, so only a trailing '.' goes ("St. Paul's" stays whole).
  value = value.trim();
  if (value.endsWith(".")) value = value.slice(0, -1).trim();
  return realVenue(value);
}

function parseCost(prose: string): string | undefined {
  const m = COST_RE.exec(prose);
  return m ? m[0].trim() : undefined;
}

/** A block's visual lines: one per `<p>`/heading, split again at each `<br>`. */
function blockLines($: CheerioAPI, el: AnyNode): string[] {
  const $copy = $(el).clone();
  $copy.find("br").replaceWith("\n");
  $copy.find("p, h1, h2, h3, h4, h5, h6, li").append("\n");
  return $copy.text().split("\n").map(normalizeText).filter(Boolean);
}

/** Flatten the Wix rich-text blocks (text, lines, first valid maps link) in order. */
function collectBlocks(html: string): Block[] {
  const $ = cheerio.load(html);
  const blocks: Block[] = [];
  $('[data-testid="richTextElement"]').each((_i, el) => {
    const $el = $(el);
    const text = normalizeText($el.text());
    if (!text) return;
    let mapsUrl: string | undefined;
    $el.find("a").each((_j, a) => {
      if (mapsUrl) return;
      const href = $(a).attr("href")?.trim();
      if (href && isValidMapsUrl(href)) mapsUrl = href;
    });
    const children = $el.children();
    const isH1 = children.length > 0 && children.not("h1").length === 0;
    blocks.push({ text, lines: blockLines($, el), isH1, mapsUrl });
  });
  return blocks;
}

const HARES_LABEL_RE = /^your hares:?$/i;

interface RunBody {
  hares?: string;
  location?: string;
  locationUrl?: string;
  prose: string;
  lines: string[];
}

/**
 * Collect a run's body: hares (the block after a "Your Hares:" label, else an
 * unlabelled `<h1>` block, else an inline "Hares:" sentence), the venue, and the
 * prose. `leadLines` are prose lines from the heading block itself.
 */
function parseRunBody(blocks: Block[], start: number, end: number, leadLines: string[]): RunBody {
  let labelHares: string | undefined;
  let h1Hares: string | undefined;
  let locationUrl: string | undefined;
  const proseParts = [...leadLines];
  const lines = [...leadLines];
  for (let i = start + 1; i < end; i++) {
    const block = blocks[i];
    if (HARES_LABEL_RE.test(block.text)) {
      const next = blocks[i + 1];
      if (next && i + 1 < end) labelHares = normalizeHaresField(next.text);
      i += 1; // consume the hares value block
      continue;
    }
    if (block.isH1 && h1Hares === undefined) {
      h1Hares = normalizeHaresField(block.text);
      continue;
    }
    proseParts.push(block.text);
    lines.push(...block.lines);
    locationUrl ??= block.mapsUrl;
  }
  const prose = proseParts.join(" ");
  return {
    hares: labelHares ?? h1Hares ?? parseInlineHares(prose),
    location: parseLocation(prose) ?? parseWhereLine(lines),
    locationUrl,
    prose,
    lines,
  };
}

// "Hares: Trojan Whores, Seldom Cums and River Horse." — the inline form some
// posts use instead of a "Your Hares:" label block (Weekend Away, Nov 2026).
// Matched procedurally (Sonar S8786): the label must start a word, and the
// value runs to the first '.' or ':' (max 160 chars).
const INLINE_HARE_LABELS = ["hares:", "hare:"];
const INLINE_HARES_MAX = 160;
// A '.' after one of these is part of a name ("Mr. Fister"), not the end.
const HONORIFICS = new Set(["mr", "mrs", "ms", "dr", "st", "jr", "sr", "mt"]);
// Words that start the next label when the value ran into a ':' ("… Start Time:").
const NEXT_LABEL_WORDS = new Set(["start", "time", "details", "detail", "where", "when", "cost", "location", "meet", "bring"]);

/** True when the '.' at `i` closes an honorific like "Mr." rather than the sentence. */
function isHonorificPeriod(text: string, i: number): boolean {
  let j = i;
  while (j > 0 && /[A-Za-z]/.test(text[j - 1])) j--;
  return HONORIFICS.has(text.slice(j, i).toLowerCase());
}

/** Drop the next label's words ("Start Time") from a value that ran into its ':'. */
function dropTrailingLabelWords(value: string): string {
  const words = value.split(" ");
  let end = words.length - 1; // the word right before ':' is always a label word
  while (end > 0 && NEXT_LABEL_WORDS.has(words[end - 1].toLowerCase())) end--;
  return words.slice(0, end).join(" ").trimEnd();
}
const AND_SEPARATOR_RE = /\s(?:and|&)\s/gi;

function findInlineHareValue(prose: string): { value: string; endsAtLabel: boolean } | undefined {
  const lower = prose.toLowerCase();
  for (const label of INLINE_HARE_LABELS) {
    let at = lower.indexOf(label);
    while (at > 0 && /[a-z0-9]/.test(lower[at - 1])) at = lower.indexOf(label, at + 1);
    if (at < 0) continue;
    const rest = prose.slice(at + label.length, at + label.length + INLINE_HARES_MAX + 1);
    let end = rest.length;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === ":" || (rest[i] === "." && !isHonorificPeriod(rest, i))) {
        end = i;
        break;
      }
    }
    return { value: rest.slice(0, end).trim(), endsAtLabel: rest[end] === ":" };
  }
  return undefined;
}

/**
 * Hares from an inline "Hares: A, B and C." sentence in the run prose. When the
 * capture ran into the next label ("Hares: A, B Details: …"), the label word is
 * dropped. A trailing "and C" is split so the names sort like the label form.
 */
export function parseInlineHares(prose: string): string | undefined {
  const found = findInlineHareValue(prose);
  if (!found || found.value.length < 2) return undefined;
  let names = found.value;
  if (found.endsAtLabel) names = dropTrailingLabelWords(names);
  return normalizeHaresField(names.replace(AND_SEPARATOR_RE, ", "));
}

const WHEN_LABEL_RE = /\bWhen:\s*/i;
const ORDINAL_SUFFIX_RE = /\b(\d{1,2})(?:st|nd|rd|th)\b/gi;
// "#2743 and 2744 WEEKEND AWAY …" — a multi-run heading; drop the extra run number.
const EXTRA_RUN_PREFIX_RE = /^(?:and|&|\/|-)\s*#?\d{3,5}\s*/i;

/**
 * Fallback for headings that carry no date (#2743 "WEEKEND AWAY GUANZILING HOT
 * SPRINGS TAINAN", 2026-11): the date lives only in a body "When: Saturday
 * November 7th Hares off at Noon …" line. The date must be on the When: line
 * itself, so a date later in the block ("Info: … 21 November") never stands in
 * for a "When: TBD".
 */
function parseWhenLineDate(
  blocks: Block[],
  start: number,
  end: number,
  now: Date,
): { date: string; daySchedule: string } | null {
  for (let i = start + 1; i < end; i++) {
    const m = WHEN_LABEL_RE.exec(blocks[i].text);
    if (!m) continue;
    // Prose dates carry ordinals ("November 7th"); DAY_RE expects a bare day.
    const whenText = blocks[i].text.slice(m.index + m[0].length).replace(ORDINAL_SUFFIX_RE, "$1");
    const whenLine = blocks[i].lines.find((l) => WHEN_LABEL_RE.test(l)) ?? "";
    const parsed = parseHeadingDate(whenLine.replace(WHEN_LABEL_RE, "").replace(ORDINAL_SUFFIX_RE, "$1"), now);
    if (!parsed) return null;
    // Only the first day's clause belongs to this run: "Saturday November 7
    // Hares off at Noon And Sunday November 8 Hares off at 11:00 AM" → cut at
    // the second month name so Sunday's time is never borrowed. (Adjacent <p>s
    // can concatenate with no space — "NoonAnd Sunday" — so don't split on "and".)
    const monthHits = [...whenText.matchAll(MONTH_WORD_RE)].filter((h) => MONTH_INDEX.has(h[0].toLowerCase()));
    const daySchedule = monthHits.length > 1 ? whenText.slice(0, monthHits[1].index) : whenText;
    return { date: parsed.date, daySchedule };
  }
  return null;
}

/** Start time from one day's "When:" clause; "Noon" → 12:00. Never falls back to other prose. */
function parseDayScheduleTime(daySchedule: string): string | undefined {
  // Leading boundary only: tolerates "NoonAnd" run-ons, still rejects "afternoon".
  if (/\bnoon/i.test(daySchedule)) return "12:00";
  return parseStartTime(daySchedule, undefined);
}

/** The heading line's text after "#NNNN", plus the heading block's later lines. */
function splitHeading(heading: Block): { afterRun: string; extraLines: string[] } {
  // The number sits on one line unless a <br> splits "#" from its digits.
  const idx = heading.lines.findIndex((l) => RUN_RE.test(l));
  const [headLine, extraLines] = idx >= 0 ? [heading.lines[idx], heading.lines.slice(idx + 1)] : [heading.text, []];
  const m = RUN_RE.exec(headLine);
  return { afterRun: m ? headLine.slice(m.index + m[0].length).trim() : "", extraLines };
}

const TITLE_QUOTES = "\"'\u201C\u201D";

/**
 * "KHHH Run #2744: “The Hills Are Alive …”" in the body → the run's own name.
 * Only a quoted name counts, so "Run #2745: details soon" never becomes a title.
 */
function findNamedTitle(lines: string[], runNumber: number): string | undefined {
  const marker = `#${runNumber}:`;
  for (const line of lines) {
    const at = line.indexOf(marker);
    if (at < 0) continue;
    const name = line.slice(at + marker.length).trim();
    if (name.length < 2 || !TITLE_QUOTES.includes(name[0]) || !TITLE_QUOTES.includes(name.at(-1) ?? "")) continue;
    const title = trimEdgeChars(name, TITLE_QUOTES).trim();
    if (title) return title;
  }
  return undefined;
}

interface RunDate {
  date: string;
  /** Title from the heading ("Saturday Night Run"), if any. */
  title?: string;
  /** Heading-block lines that are prose rather than title. */
  leadLines: string[];
  /** Set when the date came from a body "When:" line. */
  daySchedule?: string;
}

/**
 * Date and title for a run. Three heading shapes:
 * - "#2732 June 27 Saturday Night Run": date then title; in a <br>-split
 *   "#2734 July 11 <br> 7-eleven Joint Night Run" every later line is title too.
 * - "#2745 Saturday Afternoon Run <br> … Election Day: <br> November 28, 2026"
 *   (2026-11): title first, date in the heading's later lines.
 * - "#2744 Saturday Afternoon Run" / "#2743 and 2744 WEEKEND AWAY …": no date in
 *   the heading at all; it comes from a body "When:" line.
 */
function parseRunDate(blocks: Block[], start: number, end: number, now: Date): RunDate | null {
  const { afterRun, extraLines } = splitHeading(blocks[start]);
  const head = parseHeadingDate(afterRun, now);
  if (head) {
    // Everything after the date is title, across lines, as before the 2026-11 layout.
    const title = [head.title, ...extraLines].filter(Boolean).join(" ") || undefined;
    return { date: head.date, title, leadLines: [] };
  }
  const title = afterRun.replace(EXTRA_RUN_PREFIX_RE, "").trim() || undefined;
  // The first later heading line that holds a date ("November 28, 2026").
  for (const line of extraLines) {
    const fromLine = parseHeadingDate(line, now);
    if (fromLine) return { date: fromLine.date, title: title ?? fromLine.title, leadLines: extraLines };
  }
  const fromWhen = parseWhenLineDate(blocks, start, end, now);
  return fromWhen ? { ...fromWhen, title, leadLines: extraLines } : null;
}

/** Build one run from its heading block + body, or a parse error on drift. */
function buildRun(
  blocks: Block[],
  start: number,
  end: number,
  now: Date,
): { run?: ParsedRun; error?: ParseError } {
  const heading = blocks[start].text;
  const rm = RUN_RE.exec(heading);
  if (!rm) return {};
  const runNumber = Number.parseInt(rm[1], 10);

  const dated = parseRunDate(blocks, start, end, now);
  if (!dated) {
    // A numbered run whose date no longer parses is markup drift, NOT a
    // legitimately-absent run. Record a parse error so fetch() suppresses
    // reconcile.ts — silently dropping it would let the reconciler false-CANCEL
    // this run's sole-source canonical even though the page still lists it (the
    // windowed-empty guard alone misses partial drift).
    return {
      error: {
        row: start,
        section: "run_information",
        field: "date",
        error: `Kaohsiung H3: could not parse date for run #${runNumber}`,
        rawText: heading.slice(0, 200),
      },
    };
  }

  const body = parseRunBody(blocks, start, end, dated.leadLines);
  return {
    run: {
      runNumber,
      date: dated.date,
      // Trust the source-provided title: the body's "Run #N: “name”" line, else
      // the heading's ("Saturday Night Run", "7-eleven Joint Night Run"). With
      // neither, merge synthesizes "Kaohsiung H3 Trail #N" (#2225).
      title: findNamedTitle(body.lines, runNumber) ?? dated.title,
      hares: body.hares,
      location: body.location,
      locationUrl: body.locationUrl,
      startTime:
        dated.daySchedule === undefined
          ? parseStartTime(body.prose, dated.title)
          : parseDayScheduleTime(dated.daySchedule),
      cost: parseCost(body.prose),
      description: body.prose || undefined,
    },
  };
}

/**
 * Parse the Kaohsiung H3 /run-information page. Each run is a sequence of
 * Wix `[data-testid="richTextElement"]` blocks: a "#NNNN …" heading, free-form
 * prose (time, cost, "Meet at …"/"Where: …", a maps link) and the hare names
 * (after a "Your Hares:" label, or since 2026-11 an unlabelled `<h1>`). Blocks
 * are walked in document order and grouped by run heading; see parseRunDate
 * for the heading shapes.
 */
export function parseKaohsiungHashPage(
  html: string,
  now: Date,
): { runs: ParsedRun[]; blockCount: number; parseErrors: ParseError[] } {
  const blocks = collectBlocks(html);
  // A block that repeats the current run's number ("KHHH Run #2744: …" under the
  // "#2744 …" heading, 2026-11) is that run's body, not a new run.
  const runStarts: number[] = [];
  let currentRun: string | undefined;
  blocks.forEach((b, i) => {
    const m = RUN_RE.exec(b.text);
    if (!m || m[1] === currentRun) return;
    runStarts.push(i);
    currentRun = m[1];
  });

  const runs: ParsedRun[] = [];
  const parseErrors: ParseError[] = [];
  for (let s = 0; s < runStarts.length; s++) {
    const start = runStarts[s];
    const end = s + 1 < runStarts.length ? runStarts[s + 1] : blocks.length;
    const { run, error } = buildRun(blocks, start, end, now);
    if (run) runs.push(run);
    else if (error) parseErrors.push(error);
  }

  return { runs, blockCount: blocks.length, parseErrors };
}

function toRawEvent(run: ParsedRun, sourceUrl: string): RawEventData {
  return {
    date: run.date,
    kennelTags: [KENNEL_TAG],
    runNumber: run.runNumber,
    title: run.title,
    hares: run.hares,
    location: run.location,
    locationUrl: run.locationUrl,
    startTime: run.startTime,
    cost: run.cost,
    description: run.description,
    sourceUrl,
  };
}

/**
 * Kaohsiung Hash House Harriers (高雄捷兔) HTML scraper.
 *
 * Southern Taiwan's oldest hash (est. 1973). The Wix-hosted /run-information
 * page is fully server-rendered, so a static Cheerio parse suffices (no
 * browser render). The page surfaces only the next ~2–3 numbered runs (the
 * full schedule is published as an image), so the source is configured
 * `upcomingOnly` and there is no historical archive to backfill.
 */
export class KaohsiungHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { runs, blockCount, parseErrors } = parseKaohsiungHashPage(html, new Date());

    const events = runs.map((run) => toRawEvent(run, url));
    const windowed = filterEventsByWindow(events, options?.days ?? 90);

    // Any numbered block that failed to fully parse is markup drift: surface it
    // so scrape.ts suppresses stale reconciliation even when OTHER runs parsed
    // fine (partial drift). Without this, a single drifted heading would let the
    // reconciler false-CANCEL that run's sole-source canonical while the page
    // still lists it.
    const errors: string[] = parseErrors.map((p) => p.error);

    // Fail-loud: a single SSR surface with a 0-event baseline can't rely on the
    // zero-event health alert. This is a weekly kennel, so an empty result —
    // whether from markup drift (nothing parsed) or every run falling outside
    // the window — means we have nothing to publish; surface an error so
    // reconcile.ts is suppressed (don't false-CANCEL) and the drift is visible.
    if (windowed.length === 0) {
      errors.push(
        `Kaohsiung H3: no upcoming runs from ${url} ` +
          `(${events.length} parsed, ${blockCount} content blocks)`,
      );
    }

    return {
      events: windowed,
      errors,
      errorDetails: parseErrors.length > 0 ? { parse: parseErrors } : undefined,
      structureHash,
      diagnosticContext: {
        eventsParsed: windowed.length,
        totalBeforeFilter: events.length,
        blockCount,
        skippedNumbered: parseErrors.length,
        fetchDurationMs,
      },
    };
  }
}
