import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import {
  fetchHTMLPage,
  filterEventsByWindow,
  formatAmPmTime,
  normalizeHaresField,
  stripZeroWidth,
} from "../utils";

const KENNEL_TAG = "kaohsiung-h3";
const DEFAULT_URL = "https://www.kaohsiunghash.com/run-information";

// A run heading looks like "#2732 June 27 Saturday Night Run". The "#NNNN"
// marks a run; non-run content blocks (sponsor bar, "Dragon Boats", etc.)
// carry no run number and are skipped.
const RUN_RE = /#\s*(\d{3,5})\b/;

// Month + day parsed in two simple passes (avoids a single ReDoS-shaped regex
// per the Sonar S5852/S5843 guidance and the boiseh3 two-pass precedent).
// Full names listed before abbreviations (longest-first) and no trailing
// quantifier after the alternation, so there is no backtracking shape.
const MONTH_RE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
const DAY_RE = /^\s*(\d{1,2})\b/;
const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Time prose: a 12-hour clock ("6:30PM", "7PM") or a bare 24-hour clock
// ("around 19:00"). Two separate patterns, scanned in priority order.
const TIME_12H_RE = /\b(\d{1,2})(?::([0-5]\d))?\s*([AaPp][Mm])\b/;
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
  return stripZeroWidth(raw).replace(/ /g, " ").replace(/\s+/g, " ").trim();
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

function parseHeadingDate(afterRun: string, now: Date): { date: string; title?: string } | null {
  const mm = MONTH_RE.exec(afterRun);
  if (!mm) return null;
  const monthIdx = MONTH_INDEX[mm[1].slice(0, 3).toLowerCase()];
  if (monthIdx === undefined) return null;

  const afterMonth = afterRun.slice(mm.index + mm[0].length);
  const dm = DAY_RE.exec(afterMonth);
  if (!dm) return null;
  const day = Number.parseInt(dm[1], 10);
  if (day < 1 || day > 31) return null;

  const date = resolveForwardDate(monthIdx, day, now);
  const title = afterMonth.slice(dm.index + dm[0].length).trim();
  return { date, title: title || undefined };
}

/**
 * A bare run-type label ("Saturday Night Run", "Sunday Family Run") carries no
 * real theme — leave `title` undefined so merge.ts synthesizes
 * "Kaohsiung H3 Trail #N". Descriptive titles ("7-eleven Joint Night Run") are
 * kept.
 */
function isBareRunLabel(title: string): boolean {
  let t = title.trim().toLowerCase();
  if (!t.endsWith("run")) return false;
  t = t.slice(0, -3).trim();
  t = t.replace(/^(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i, "").trim();
  if (t === "") return true;
  return ["night", "afternoon", "morning", "evening", "family", "day"].includes(t);
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

function parseLocation(prose: string): string | undefined {
  const lower = prose.toLowerCase();
  const idx = lower.indexOf("meet at ");
  if (idx < 0) return undefined;
  let rest = prose.slice(idx + "meet at ".length);
  const dot = rest.indexOf(".");
  if (dot >= 0) rest = rest.slice(0, dot);
  rest = rest.trim();
  if (!rest || PLACEHOLDER_VENUE_RE.test(rest)) return undefined;
  return rest;
}

function parseCost(prose: string): string | undefined {
  const m = COST_RE.exec(prose);
  return m ? m[0].trim() : undefined;
}

/**
 * Parse the Kaohsiung H3 /run-information page. Each run is a sequence of
 * Wix `[data-testid="richTextElement"]` blocks: a "#NNNN Month Day Title"
 * heading, free-form prose (time, cost, "Meet at …", a maps link), a
 * "Your Hares:" label, then the hare names. Blocks are walked in document
 * order and grouped by run heading.
 */
export function parseKaohsiungHashPage(
  html: string,
  now: Date,
): { runs: ParsedRun[]; blockCount: number } {
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
    blocks.push({ text, mapsUrl });
  });

  // Find run-heading block indices.
  const runStarts: number[] = [];
  blocks.forEach((b, i) => {
    if (RUN_RE.test(b.text)) runStarts.push(i);
  });

  const runs: ParsedRun[] = [];
  for (let s = 0; s < runStarts.length; s++) {
    const start = runStarts[s];
    const end = s + 1 < runStarts.length ? runStarts[s + 1] : blocks.length;
    const heading = blocks[start].text;

    const rm = RUN_RE.exec(heading);
    if (!rm) continue;
    const runNumber = Number.parseInt(rm[1], 10);

    const afterRun = heading.slice(rm.index + rm[0].length).trim();
    const dateParsed = parseHeadingDate(afterRun, now);
    if (!dateParsed) continue; // unparseable date → skip this run (counts toward fail-loud)

    const rawTitle = dateParsed.title;
    const title = rawTitle && !isBareRunLabel(rawTitle) ? rawTitle : undefined;

    // Body blocks: hares (after a "Your Hares:" label) + prose.
    let hares: string | undefined;
    let locationUrl: string | undefined;
    const proseParts: string[] = [];
    for (let i = start + 1; i < end; i++) {
      const block = blocks[i];
      if (/^your hares:?$/i.test(block.text)) {
        const next = blocks[i + 1];
        if (next && i + 1 < end) hares = normalizeHaresField(next.text);
        i += 1; // consume the hares block
        continue;
      }
      proseParts.push(block.text);
      if (!locationUrl && block.mapsUrl) locationUrl = block.mapsUrl;
    }

    const prose = proseParts.join(" ");
    const startTime = parseStartTime(prose, rawTitle);
    const location = parseLocation(prose);
    const cost = parseCost(prose);
    const description = prose || undefined;

    runs.push({
      runNumber,
      date: dateParsed.date,
      title,
      hares,
      location,
      locationUrl,
      startTime,
      cost,
      description,
    });
  }

  return { runs, blockCount: blocks.length };
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
    const { runs, blockCount } = parseKaohsiungHashPage(html, new Date());

    const events = runs.map((run) => toRawEvent(run, url));
    const windowed = filterEventsByWindow(events, options?.days ?? 90);

    // Fail-loud: a single SSR surface with a 0-event baseline can't rely on the
    // zero-event health alert. This is a weekly kennel, so an empty result —
    // whether from markup drift (nothing parsed) or every run falling outside
    // the window — means we have nothing to publish; surface an error so
    // reconcile.ts is suppressed (don't false-CANCEL) and the drift is visible.
    const errors: string[] = [];
    if (windowed.length === 0) {
      errors.push(
        `Kaohsiung H3: no upcoming runs from ${url} ` +
          `(${events.length} parsed, ${blockCount} content blocks)`,
      );
    }

    return {
      events: windowed,
      errors,
      structureHash,
      diagnosticContext: {
        eventsParsed: windowed.length,
        totalBeforeFilter: events.length,
        blockCount,
        fetchDurationMs,
      },
    };
  }
}
