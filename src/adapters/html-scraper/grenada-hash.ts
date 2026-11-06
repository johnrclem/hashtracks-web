/**
 * Grenada Hash House Harriers (GH3-GD) — first 🇬🇩 Grenada kennel (est. 1985).
 *
 * Two hand-maintained WordPress pages on grenadahash.com:
 *
 *   1. `/schedule/` — a TablePress table (`table.tablepress`) of the next ~6
 *      months: `Date (DD Mon YYYY) | Hash No | Hares | Location | Extra Info`.
 *      Extra Info carries themes ("Halloween Hash", "Red Dress Hash"), used as
 *      the title. `TBA` / blank cells are explicit clears.
 *   2. `/next-hash/` — the confirmed detail for the coming Saturday: labelled
 *      lines `Hash #1424`, `Location: Grand Mal Playing Field, St George <maps>`,
 *      `Date: 7th November 2026`, `Time: Please arrive by 3:00pm for 3:30pm On On`,
 *      `Hares: “Bling Ting”`. It wins over the (planned) table row for that run.
 *
 * Both pages are fetched with a browser User-Agent: the host resets connections
 * from the default scraper UA. The table rolls forward, so the source ships
 * `upcomingOnly: true`. The On On time moves with the season (4:00pm in
 * August, 3:30pm in November), so only the confirmed next run carries one.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, filterEventsByWindow } from "../utils";

const KENNEL_TAG = "gh3-gd";
const DEFAULT_URL = "https://grenadahash.com/schedule/";
const NEXT_HASH_URL = "https://grenadahash.com/next-hash/";
// grenadahash.com resets connections from the default "HashTracks-Scraper" UA
// (Nov 2026); a plain browser UA is served normally.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const MONTHS = new Map<string, number>([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);
// "29 Aug 2026" / "7th November 2026".
const DATE_RE = /(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9}) (\d{4})/;
const RUN_RE = /^\d{3,5}$/;
const HASH_NO_RE = /^Hash #(\d{3,5})/i;
// "for 3:30pm On On" — the On On time, not the arrival time.
const ON_ON_RE = /for (\d{1,2}):(\d{2}) ?(am|pm) on on/i;
const PLACEHOLDERS = new Set(["", "tba", "tbc", "tbd"]);
const QUOTES = ["“", "”", '"'];
const MAPS_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "www.google.com", "google.com", "maps.google.com"]);

function clean(text: string): string {
  return text.replaceAll(" ", " ").replaceAll(/\s+/g, " ").trim();
}

export function parseGrenadaDate(text: string): string | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const month = MONTHS.get(m[2].slice(0, 3).toLowerCase());
  if (!month) return null;
  const day = Number.parseInt(m[1], 10);
  const d = new Date(Date.UTC(Number.parseInt(m[3], 10), month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** Present placeholder → null (merge clears), real value → trimmed text. */
function valueOrNull(text: string): string | null {
  const v = clean(text);
  return PLACEHOLDERS.has(v.toLowerCase()) ? null : v;
}

/** "Bag o Shit, Feckless Father & Poke ma hole" → sorted list; blank → null. */
export function splitHares(text: string): string | null {
  let s = clean(text);
  for (const q of QUOTES) s = s.replaceAll(q, "");
  const names = s
    .replaceAll(" and ", ",")
    .replaceAll("&", ",")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n && !PLACEHOLDERS.has(n.toLowerCase()));
  if (names.length === 0) return null;
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
}

/** Parse the TablePress schedule. Exported for tests. */
export function parseGrenadaSchedule(html: string): { events: RawEventData[]; parseErrors: ParseError[]; tableFound: boolean } {
  const $ = cheerio.load(html);
  const table = $("table.tablepress").first();
  const events: RawEventData[] = [];
  const parseErrors: ParseError[] = [];
  table.find("tbody tr").each((i, tr) => {
    const cells = $(tr).find("td").toArray().map((td) => clean($(td).text()));
    if (cells.length < 4 || !RUN_RE.test(cells[1])) return;
    const date = parseGrenadaDate(cells[0]);
    if (!date) {
      parseErrors.push({ row: i, section: "schedule", error: `GH3-GD: unparseable date "${cells[0]}" on hash ${cells[1]}` });
      return;
    }
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: Number.parseInt(cells[1], 10),
      title: valueOrNull(cells[4] ?? "") ?? undefined,
      hares: splitHares(cells[2]),
      location: valueOrNull(cells[3]),
      sourceUrl: DEFAULT_URL,
    });
  });
  return { events, parseErrors, tableFound: table.length > 0 };
}

export interface NextHash {
  runNumber?: number;
  date?: string;
  location?: string;
  locationUrl?: string;
  startTime?: string;
  hares?: string | null;
}

function labelValue(line: string, label: string): string | undefined {
  return line.toLowerCase().startsWith(label) ? clean(line.slice(label.length)) : undefined;
}

/** Text lines of the entry content, splitting paragraphs on `<br>`. */
function contentLines(html: string): string[] {
  const $ = cheerio.load(html);
  $(".entry-content br").replaceWith("\n");
  return $(".entry-content p, .entry-content li")
    .toArray()
    .flatMap((el) => $(el).text().split("\n"))
    .map(clean)
    .filter(Boolean);
}

function isMapsUrl(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === "https:" && MAPS_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function parseOnOnTime(time: string): string | undefined {
  const onOn = ON_ON_RE.exec(time);
  if (!onOn) return undefined;
  let h = Number.parseInt(onOn[1], 10);
  if (onOn[3].toLowerCase() === "pm" && h < 12) h += 12;
  return `${String(h).padStart(2, "0")}:${onOn[2]}`;
}

/** Parse the `/next-hash/` labelled block. Exported for tests. */
export function parseNextHash(html: string): NextHash {
  const next: NextHash = {};
  let lastLabel = "";
  for (const line of contentLines(html)) {
    const hashNo = HASH_NO_RE.exec(line);
    if (hashNo) next.runNumber = Number.parseInt(hashNo[1], 10);
    if (isMapsUrl(line)) {
      if (lastLabel === "location:") next.locationUrl = line;
      continue;
    }
    const loc = labelValue(line, "location:");
    if (loc) next.location = loc;
    const date = labelValue(line, "date:");
    if (date) next.date = parseGrenadaDate(date) ?? undefined;
    const time = labelValue(line, "time:");
    if (time) next.startTime = parseOnOnTime(time);
    const hares = labelValue(line, "hares:");
    if (hares !== undefined) next.hares = splitHares(hares);
    const colon = line.indexOf(":");
    if (colon > 0 && colon < 20) lastLabel = line.slice(0, colon + 1).toLowerCase();
  }
  return next;
}

/** Overlay the confirmed next-hash detail onto its schedule row. */
export function applyNextHash(events: RawEventData[], next: NextHash): void {
  const row = events.find((e) => (next.runNumber && e.runNumber === next.runNumber) || (next.date && e.date === next.date));
  if (!row) return;
  if (next.location) row.location = next.location;
  if (next.locationUrl) row.locationUrl = next.locationUrl;
  if (next.startTime) row.startTime = next.startTime;
  if (next.hares) row.hares = next.hares;
}

export class GrenadaHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const [schedule, nextHash] = await Promise.all([
      fetchHTMLPage(url, { userAgent: BROWSER_UA }),
      fetchHTMLPage(NEXT_HASH_URL, { userAgent: BROWSER_UA }),
    ]);
    if (!schedule.ok) return schedule.result;

    const { events, parseErrors, tableFound } = parseGrenadaSchedule(schedule.html);
    const errors = parseErrors.map((p) => p.error);
    const errorDetails: ErrorDetails = {};
    if (parseErrors.length > 0) errorDetails.parse = parseErrors;
    if (!tableFound) errors.push(`GH3-GD: schedule table not found at ${url}`);
    else if (events.length === 0) errors.push(`GH3-GD: no hash rows parsed at ${url}`);

    // Enrichment only: a failed next-hash fetch never blocks the schedule rows.
    if (nextHash.ok) applyNextHash(events, parseNextHash(nextHash.html));
    else errorDetails.fetch = nextHash.result.errorDetails?.fetch;

    const windowed = filterEventsByWindow(events, options?.days ?? 90);
    return {
      events: windowed,
      errors,
      structureHash: schedule.structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        totalBeforeFilter: events.length,
        eventsParsed: windowed.length,
        nextHashEnriched: nextHash.ok,
        fetchDurationMs: schedule.fetchDurationMs,
      },
    };
  }
}
