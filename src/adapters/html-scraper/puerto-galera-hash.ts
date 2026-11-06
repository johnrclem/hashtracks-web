/**
 * Puerto Galera Hash House Harriers (PGH3) — Sabang, Puerto Galera, Mindoro,
 * Philippines.
 *
 * Two surfaces on pgh3.org (HostGator, behind mod_security):
 *
 *   1. `/upcoming-runs.html` — server-rendered accordion `#runListAccordion`:
 *        <h3>Saturday November 7th</h3>
 *        <div class='runList'><p><strong>Run 1905</strong><br>
 *          <strong>Departure: <span>3:00 pm <em>(sign-in closes at 2:50 pm)</em></span></strong><br>
 *          <strong>Hare(s): </strong>Free Sex<br><strong>Location: </strong>Away to home<br>
 *          <strong>Comments: </strong> …<br><strong>Fees: </strong> regular fee</p></div>
 *      Headings carry no year; each date takes the year nearest to today.
 *      "Hare Needed!" / "Walang Hare!" (Tagalog: "no hare") mean no hare yet.
 *   2. `/assets/php/runList.php` — the JSON behind the Run List DataTable: every
 *      run since #940 (Aug 2008) with ISO date, hares, location and On On venue.
 *      Recent rows complete the window after a run leaves the upcoming page; the
 *      deep archive is loaded once by scripts/backfill-pgh3-history.ts.
 *
 * mod_security returns 406 for some header combinations, so requests send a
 * plain `Accept: *\/*` and (for the JSON) the Run List page as Referer. Runs
 * age off the upcoming page, so the source ships `upcomingOnly: true`.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { filterEventsByWindow } from "../utils";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";

const KENNEL_TAG = "pgh3";
const DEFAULT_URL = "https://www.pgh3.org/upcoming-runs.html";
const RUN_LIST_JSON = "https://www.pgh3.org/assets/php/runList.php";
const RUN_LIST_PAGE = "https://www.pgh3.org/run-list.html";
const UA = "Mozilla/5.0 (compatible; HashTracks-Scraper)";

const MONTHS = new Map<string, number>([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);
// "Saturday November 7th" — month then day, no year.
const HEADING_RE = /\b([A-Za-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?\b/;
const RUN_RE = /\bRun (\d{3,5})\b/;
const TIME_RE = /(\d{1,2}):(\d{2}) ?(am|pm)/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUN_LINK_RE = />(\d{3,5})</;
const NO_HARE = new Set(["hare needed!", "hare needed", "walang hare!", "walang hare", "tba", "tbc"]);
const NO_LOCATION = new Set(["", "tba", "tbc", "tbd"]);

function clean(text: string | null | undefined): string {
  return (text ?? "").replaceAll(" ", " ").replaceAll(/\s+/g, " ").trim();
}

/** Month + day heading → the YYYY-MM-DD nearest to `now`. */
export function resolveHeadingDate(text: string, now: Date = new Date()): string | null {
  const m = HEADING_RE.exec(text);
  const month = m ? MONTHS.get(m[1].slice(0, 3).toLowerCase()) : undefined;
  if (!m || !month) return null;
  const day = Number.parseInt(m[2], 10);
  let best: Date | null = null;
  for (const y of [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(y, month - 1, day, 12, 0, 0));
    if (d.getUTCMonth() !== month - 1) return null;
    if (!best || Math.abs(d.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime())) best = d;
  }
  return best ? best.toISOString().slice(0, 10) : null;
}

/** "A, B" → sorted; a no-hare placeholder → null (explicit clear). */
export function cleanHares(text: string): string | null {
  const v = clean(text);
  if (NO_HARE.has(v.toLowerCase()) || !v) return null;
  const names = v.split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
}

function to24h(h: string, m: string, ampm: string): string {
  let hour = Number.parseInt(h, 10);
  if (ampm.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (ampm.toLowerCase() === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${m}`;
}

/** Label → value lines of one run's `<p>`, split on `<br>`. */
function labelledLines(html: string): Map<string, string> {
  const lines = cheerio.load(html.replaceAll(/<br\s*\/?>/gi, "\n")).root().text().split("\n").map(clean).filter(Boolean);
  const fields = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0 && colon < 20) fields.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
    else if (RUN_RE.test(line)) fields.set("run", line);
  }
  return fields;
}

/** Parse the upcoming-runs accordion. Exported for tests. */
export function parseUpcomingRuns(html: string, now: Date = new Date()): { events: RawEventData[]; accordionFound: boolean } {
  const $ = cheerio.load(html);
  const accordion = $("#runListAccordion");
  const events: RawEventData[] = [];
  accordion.children("h3").each((_i, h3) => {
    const date = resolveHeadingDate(clean($(h3).text()), now);
    const body = $(h3).next(".runList").find("p").first();
    if (!date || body.length === 0) return;
    const fields = labelledLines(body.html() ?? "");
    const run = RUN_RE.exec(fields.get("run") ?? "");
    const time = TIME_RE.exec(fields.get("departure") ?? "");
    const location = clean(fields.get("location"));
    const comments = clean(fields.get("comments"));
    const fees = clean(fields.get("fees"));
    const notes = [comments, fees && fees.toLowerCase() !== "regular fee" ? `Fees: ${fees}` : ""].filter(Boolean);
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: run ? Number.parseInt(run[1], 10) : undefined,
      startTime: time ? to24h(time[1], time[2], time[3]) : undefined,
      hares: cleanHares(fields.get("hare(s)") ?? ""),
      location: NO_LOCATION.has(location.toLowerCase()) ? null : location,
      description: notes.length > 0 ? notes.join(" — ") : undefined,
      sourceUrl: DEFAULT_URL,
    });
  });
  return { events, accordionFound: accordion.length > 0 };
}

export interface RunListRow {
  Run?: unknown;
  Date?: unknown;
  Hares?: unknown;
  Location?: unknown;
  OnOn?: unknown;
  Comments?: unknown;
}

/** One archive JSON row → event; null when the run number or date is missing. Exported for the backfill. */
export function runListRowToEvent(row: RunListRow): RawEventData | null {
  const run = typeof row.Run === "string" ? RUN_LINK_RE.exec(row.Run) : null;
  const date = typeof row.Date === "string" && ISO_RE.test(row.Date) ? row.Date : null;
  if (!run || !date) return null;
  const location = typeof row.Location === "string" ? clean(row.Location) : "";
  const onOn = typeof row.OnOn === "string" ? clean(row.OnOn) : "";
  const comments = typeof row.Comments === "string" ? clean(row.Comments) : "";
  const notes = [onOn ? `On On: ${onOn}` : "", comments].filter(Boolean);
  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: Number.parseInt(run[1], 10),
    hares: typeof row.Hares === "string" ? cleanHares(row.Hares) ?? undefined : undefined,
    location: location || undefined,
    description: notes.length > 0 ? notes.join(" — ") : undefined,
    sourceUrl: `https://www.pgh3.org/run-runners.html?run=${run[1]}`,
  };
}

async function fetchText(url: string, referer?: string): Promise<string> {
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "*/*" };
  if (referer) headers.Referer = referer;
  const res = await safeFetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export class PuertoGaleraHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const fetchStart = Date.now();
    let html: string;
    try {
      html = await fetchText(url);
    } catch (err) {
      const message = `PGH3: fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } };
    }
    const { events: upcoming, accordionFound } = parseUpcomingRuns(html);
    const errors: string[] = [];
    if (!accordionFound) errors.push(`PGH3: run accordion not found at ${url}`);

    // Archive rows fill in runs that have left the upcoming page. Best-effort:
    // a failure here never blocks the forward feed.
    let archive: RawEventData[] = [];
    let archiveError: string | undefined;
    try {
      const body = JSON.parse(await fetchText(RUN_LIST_JSON, RUN_LIST_PAGE)) as { data?: unknown };
      const rows = Array.isArray(body.data) ? (body.data as RunListRow[]) : [];
      archive = rows.map(runListRowToEvent).filter((e): e is RawEventData => e !== null);
    } catch (err) {
      archiveError = err instanceof Error ? err.message : String(err);
    }

    const upcomingRuns = new Set(upcoming.map((e) => e.runNumber));
    const merged = [...upcoming, ...archive.filter((e) => !upcomingRuns.has(e.runNumber))];
    const windowed = filterEventsByWindow(merged, options?.days ?? 90);
    return {
      events: windowed,
      errors,
      structureHash: generateStructureHash(html),
      diagnosticContext: {
        upcoming: upcoming.length,
        archiveRows: archive.length,
        archiveError,
        eventsParsed: windowed.length,
        fetchDurationMs: Date.now() - fetchStart,
      },
    };
  }
}
