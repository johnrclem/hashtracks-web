/**
 * Vientiane hashes (hashlaos.com) — first 🇱🇦 Laos kennels.
 *
 * hashlaos.com is WordPress; each kennel has one Page that its GM rewrites in
 * place every week with the coming run, in free prose:
 *
 *   page 78  /monday-map/            VH3 (vh3-la), Mondays, est. 1981
 *     "#2514 / This Monday, the 2nd of November, A2B 5:30 departure from Ban Lao
 *      Beer Garden to Sticky Fingers … Happy Dancer is the Hare! / Map …: https://goo.gl/maps/…"
 *   page 22  /saturday-bush-hash/    VBH3 (vbh3-la), Saturday bush hash, est. 1998
 *     "Saturday 07 #, November, Hash-run no. 1569, hare is “NAKED” / Start run at 4:30 pm."
 *   page 26  /monthly-bicycle-hash/  Vientiane Bike Hash (vbikeh3-la), monthly, est. 2010
 *     "… November (no 199 ) is postponed ! / shifted to the o5# of December : the hare is “SPUD” /
 *      we start at the JOMA Cafe` near the Nam Phu Fountain at 9:30 am."
 *
 * Pages are read through the WP REST API (`/wp-json/wp/v2/pages/{id}`), which
 * also returns `modified` — the anchor for the year (the prose never states one).
 * Only the first lines before the static kennel history are parsed. Each page
 * holds one run that is overwritten weekly, so the source ships `upcomingOnly: true`.
 * A page whose text has no recognisable date (e.g. "no run this week") yields no
 * event; only all three pages failing is treated as drift.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { decodeEntities, filterEventsByWindow } from "../utils";
import { safeFetch } from "../safe-fetch";

const API_BASE = "https://hashlaos.com/wp-json/wp/v2/pages/";

interface PageSpec {
  id: number;
  kennelTag: string;
  pageUrl: string;
  /** Used when the time has no am/pm ("5:30 departure"). */
  defaultMeridiem: "am" | "pm";
}

export const LAOS_PAGES: PageSpec[] = [
  { id: 78, kennelTag: "vh3-la", pageUrl: "https://hashlaos.com/monday-map/", defaultMeridiem: "pm" },
  { id: 22, kennelTag: "vbh3-la", pageUrl: "https://hashlaos.com/saturday-bush-hash/", defaultMeridiem: "pm" },
  { id: 26, kennelTag: "vbikeh3-la", pageUrl: "https://hashlaos.com/monthly-bicycle-hash/", defaultMeridiem: "am" },
];

/** Lines that start the static kennel history / fee blurb — parsing stops there. */
const STOP_PREFIXES = ["vbh3 was formed", "“bicycles", "\"bicycles", "the inaugural", "fui:", "check our", "any questions"];
/** Only the run announcement is parsed: the first few lines. */
const MAX_LINES = 6;

const MONTHS = new Map<string, number>([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);
// "2nd of november", "07 november", "05 of december" (after normalization).
const DAY_MONTH_RE = /\b(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]{3,9})\b/g;
const RUN_HASH_RE = /(?:^|\s)#(\d{3,5})\b/;
const RUN_WORD_RE = /\b(?:hash-run|run) no\.? ?(\d{1,5})\b|\(no (\d{1,5}) ?\)/i;
const TIME_RE = /\b(\d{1,2})[:.](\d{2}) ?(am|pm)?/i;
const HARE_IS_RE = /\bhare is ["“]?([^"”!.\n]{2,60})/i;
const IS_THE_HARE_RE = /(?:^|\n)([^\n]{2,60}?) is the hare/i;
const FROM_TO_RE = /\bdeparture from (.{3,80}?) to (.{3,80}?)(?:,|\.|$)/i;
const START_AT_RE = /\b(?:start|starts|meet) at (?:the )?(.{3,80}?)(?: at \d|,|!|\.|$)/i;
const A2A_FROM_RE = /\bA2[AB] from (.{3,80}?)(?: hare|,|\.|$)/i;
const MAPS_RE = /https:\/\/(?:goo\.gl\/maps|maps\.app\.goo\.gl)\/[A-Za-z0-9?=_&-]{5,120}/;
const PLACEHOLDER_HARE = /^\?+$/;

function clean(text: string): string {
  return text.replaceAll(" ", " ").replaceAll(/[ \t]+/g, " ").trim();
}

/** Announcement lines of a rendered page, stopping at the static history. */
export function announcementLines(rendered: string): string[] {
  const $ = cheerio.load(rendered);
  $("br").replaceWith("\n");
  const lines: string[] = [];
  for (const el of $("p, h1, h2, h3, h4, li").toArray()) {
    for (const raw of $(el).text().split("\n")) {
      const line = clean(decodeEntities(raw));
      if (!line) continue;
      if (STOP_PREFIXES.some((p) => line.toLowerCase().startsWith(p))) return lines;
      lines.push(line);
      if (lines.length >= MAX_LINES) return lines;
    }
  }
  return lines;
}

/** Normalize GM shorthand: "07 #, November" → "07 november", "o5#" → "05". */
function normalizeForDate(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/\bo(\d)/g, "0$1")
    .replaceAll("#", " ")
    .replaceAll(",", " ")
    .replaceAll(/\s+/g, " ");
}

/**
 * The run date: the LAST day+month mention in the announcement (so "November …
 * postponed … shifted to the 05 of December" picks December), in the year that
 * puts it closest to the page's `modified` timestamp.
 */
export function parseLaosDate(text: string, modified: Date): string | null {
  let found: { day: number; month: number } | null = null;
  for (const m of normalizeForDate(text).matchAll(DAY_MONTH_RE)) {
    const month = MONTHS.get(m[2].slice(0, 3));
    const day = Number.parseInt(m[1], 10);
    if (month && day >= 1 && day <= 31) found = { day, month };
  }
  if (!found) return null;
  let best: Date | null = null;
  for (const y of [modified.getUTCFullYear() - 1, modified.getUTCFullYear(), modified.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(y, found.month - 1, found.day, 12, 0, 0));
    if (d.getUTCMonth() !== found.month - 1) continue;
    if (!best || Math.abs(d.getTime() - modified.getTime()) < Math.abs(best.getTime() - modified.getTime())) best = d;
  }
  return best ? best.toISOString().slice(0, 10) : null;
}

function parseTime(text: string, defaultMeridiem: "am" | "pm"): string | undefined {
  const m = TIME_RE.exec(text);
  if (!m) return undefined;
  let h = Number.parseInt(m[1], 10);
  const meridiem = (m[3]?.toLowerCase() as "am" | "pm" | undefined) ?? defaultMeridiem;
  if (h > 12 || Number.parseInt(m[2], 10) > 59) return undefined;
  if (meridiem === "pm" && h < 12) h += 12;
  if (meridiem === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function parseHare(text: string): string | undefined {
  const m = HARE_IS_RE.exec(text) ?? IS_THE_HARE_RE.exec(text);
  const hare = m ? clean(m[1]).replace(/["“”]/g, "").trim() : "";
  return hare && !PLACEHOLDER_HARE.test(hare) ? hare : undefined;
}

function parseVenue(text: string): string | undefined {
  const fromTo = FROM_TO_RE.exec(text);
  if (fromTo) return clean(fromTo[1]);
  const m = START_AT_RE.exec(text) ?? A2A_FROM_RE.exec(text);
  return m ? clean(m[1].replaceAll("`", "")) : undefined;
}

/** One rendered page → its current run, or null when no date is stated. Exported for tests. */
export function parseLaosPage(rendered: string, modified: Date, spec: PageSpec): RawEventData | null {
  const text = announcementLines(rendered).join("\n");
  const date = parseLaosDate(text, modified);
  if (!date) return null;
  const runMatch = RUN_HASH_RE.exec(text) ?? RUN_WORD_RE.exec(text);
  const run = runMatch ? Number.parseInt(runMatch[1] ?? runMatch[2], 10) : undefined;
  const fromTo = FROM_TO_RE.exec(text);
  return {
    date,
    kennelTags: [spec.kennelTag],
    runNumber: run,
    startTime: parseTime(text, spec.defaultMeridiem),
    hares: parseHare(text),
    location: parseVenue(text),
    locationUrl: MAPS_RE.exec(text)?.[0],
    description: fromTo ? `A to B: ${clean(fromTo[1])} → ${clean(fromTo[2])}` : undefined,
    sourceUrl: spec.pageUrl,
  };
}

interface WpPage {
  modified?: unknown;
  content?: { rendered?: unknown };
}

async function fetchPage(spec: PageSpec): Promise<{ rendered: string; modified: Date }> {
  const res = await safeFetch(`${API_BASE}${spec.id}?_fields=id,modified,content`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as WpPage;
  if (typeof body.content?.rendered !== "string" || typeof body.modified !== "string") {
    throw new Error("unexpected WP REST payload");
  }
  // WP `modified` is site-local time without an offset; a few hours' skew is
  // irrelevant for picking the year.
  return { rendered: body.content.rendered, modified: new Date(`${body.modified}Z`) };
}

export class LaosHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(_source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const fetchStart = Date.now();
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const notes: Record<string, string> = {};
    const results = await Promise.allSettled(LAOS_PAGES.map((spec) => fetchPage(spec)));
    results.forEach((r, i) => {
      const spec = LAOS_PAGES[i];
      if (r.status === "rejected") {
        errors.push(`Laos ${spec.kennelTag}: page ${spec.id} fetch failed: ${String(r.reason)}`);
        return;
      }
      const event = parseLaosPage(r.value.rendered, r.value.modified, spec);
      if (event) events.push(event);
      else notes[spec.kennelTag] = "no run date in the current page text";
    });
    if (events.length === 0 && errors.length === 0) {
      errors.push("Laos: no run could be parsed from any of the three hashlaos.com pages");
    }
    const windowed = filterEventsByWindow(events, options?.days ?? 90);
    return {
      events: windowed,
      errors,
      diagnosticContext: { parsed: events.length, eventsParsed: windowed.length, notes, fetchDurationMs: Date.now() - fetchStart },
    };
  }
}
