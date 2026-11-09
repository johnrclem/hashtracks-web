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
 *     Rows with no run number (holidays, breaks, ad-hoc socials) are skipped.
 *   - Dates are D/M/YYYY, D/M/YY or D.M.YYYY, sometimes with trailing notes
 *     ("18/3/2023 SATURDAY!!!") or a range ("25-27/10/2024" → the first day).
 *   - Column 4 mixes venues ("A-A Piata Sudului Metro") with themes ("Sturgeon
 *     Moon", "Halloween Hash"). A cell naming a metro/park/square is the venue;
 *     anything else is the run's theme and becomes the title.
 *   - Column 5 may hold a start time ("2:00 PM", "14:00", "3pm start"); otherwise
 *     the Carrd schedule applies — Sundays 14:00 (BH3), full-moon Fridays 19:00.
 *
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

const RUN_RE = /^(FM)? ?#(\d{1,5})$/i;
// "26/2/2023", "06/10/24", "31.10.2026", "25-27/10/2024". Bounded quantifiers only.
const DATE_RE = /(\d{1,2})(?:-\d{1,2})?[./](\d{1,2})[./](\d{4}|\d{2})\b/;
// "2:00 PM", "3.00pm", "3pm", "14:00", "4:00:00 PM". Bounded, no nested quantifiers.
const TIME_TOKEN_RE = /\b(\d{1,2})(?:[:.]([0-5]\d))?(?::\d{2})? ?(am|pm)?\b/gi;
const START_AT_RE = /\bstart(?:s|ing)? at (?:the )?([^,.!]{3,60})/i;
const TRAIL_TYPE_PREFIXES = ["A-A ", "A-B ", "A to B ", "A to A "];
const PLACE_PREFIXES = ["starting at ", "starts at ", "start at ", "at "];

/** Words that mark a cell as a meeting place rather than a theme. */
const VENUE_WORDS = [
  "metro", "station", "park", "parcul", "piata", "piața", "cismigiu", "clubhouse",
  "club house", "herastrau", "gara", "stop",
];

function clean(text: string | undefined): string {
  return (text ?? "").replaceAll(/\s+/g, " ").trim();
}

/** First D/M/Y date in the cell → "YYYY-MM-DD"; null if none or invalid. */
export function parseBucharestDate(text: string): string | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  let year = Number.parseInt(m[3], 10);
  if (year < 100) year += 2000;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
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

/** "A, B + C and D" → sorted "A, B, C, D"; blank → undefined. */
export function splitHares(text: string): string | undefined {
  const names = clean(text)
    .replaceAll(" and ", ",")
    .replaceAll("+", ",")
    .replaceAll("&", ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return undefined;
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
}

export function looksLikeVenue(text: string): boolean {
  const lower = text.toLowerCase();
  if (TRAIL_TYPE_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()))) return true;
  return VENUE_WORDS.some((w) => lower.includes(w));
}

/**
 * "Worm Moon Parcul Păsărari" / "Hunter's Moon - Piata Romana" → the moon name
 * plus the place after it (#2824). Null when the cell isn't that shape.
 */
export function splitMoonPrefix(text: string): { moon: string; place: string } | null {
  const idx = text.toLowerCase().indexOf(" moon");
  if (idx === -1) return null;
  const end = idx + " moon".length;
  if (/\p{L}/u.test(text.charAt(end))) return null; // "Moonlight"
  const moon = text.slice(0, end).trim();
  if (moon.split(/\s+/).length > 3) return null;
  const place = trimEdgeChars(text.slice(end), " \t-–—:,");
  return place ? { moon, place } : null;
}

function stripPrefix(text: string, prefixes: string[]): string {
  for (const prefix of prefixes) {
    if (text.toLowerCase().startsWith(prefix)) return text.slice(prefix.length).trim();
  }
  return text;
}

/** "A-B start at Parcul Casa Alba" → "Parcul Casa Alba". */
function stripTrailType(text: string): string {
  return stripPrefix(stripPrefix(text, TRAIL_TYPE_PREFIXES.map((p) => p.toLowerCase())), PLACE_PREFIXES);
}

/** True when the extra cell says more than a bare time ("2:00 PM", "14:00"). */
function hasNotes(extra: string): boolean {
  const letters = extra.replaceAll(/\b(?:am|pm)\b/gi, "").replaceAll(/[^A-Za-z]/g, "");
  return letters.length >= 3;
}

/** One sheet row → event, or null for header / unnumbered / undated rows. */
export function parseBucharestRow(row: string[]): RawEventData | null {
  const run = RUN_RE.exec(clean(row[0]));
  if (!run) return null;
  const date = parseBucharestDate(clean(row[1]));
  if (!date) return null;
  const kennel = run[1] ? FULL_MOON : BH3;
  const place = clean(row[3]);
  const extra = clean(row.slice(4).join(", ").replaceAll(/(?:, )+$/g, ""));

  let location: string | undefined;
  let title: string | undefined;
  const moonSplit = splitMoonPrefix(place);
  if (moonSplit && looksLikeVenue(moonSplit.place)) {
    title = moonSplit.moon;
    location = stripTrailType(moonSplit.place);
  } else if (place && looksLikeVenue(place)) location = stripTrailType(place);
  else if (place) title = place;
  const startAt = START_AT_RE.exec(extra);
  if (!location && startAt) location = clean(startAt[1]);

  const time = parseBucharestTime(extra) ?? parseBucharestTime(place);
  return {
    date,
    kennelTags: [kennel.tag],
    runNumber: Number.parseInt(run[2], 10),
    title,
    hares: splitHares(clean(row[2])),
    location,
    startTime: time ?? kennel.defaultTime,
    description: hasNotes(extra) ? extra : undefined,
    sourceUrl: SHEET_URL,
  };
}

/**
 * Parse the CSV. A numbered row whose date lands more than ~6 months before the
 * previous kept row of the same kennel is a typo (e.g. #1141 "27/05/2022" among
 * 2023 rows) and is dropped rather than filed in the wrong year.
 */
export function parseBucharestSheet(csv: string): { events: RawEventData[]; skippedOutOfOrder: number } {
  const events: RawEventData[] = [];
  const lastDate = new Map<string, string>();
  let skippedOutOfOrder = 0;
  for (const row of parseCSV(csv)) {
    const event = parseBucharestRow(row);
    if (!event) continue;
    const tag = event.kennelTags[0];
    const prev = lastDate.get(tag);
    if (prev && Date.parse(event.date) < Date.parse(prev) - 180 * 86_400_000) {
      skippedOutOfOrder++;
      continue;
    }
    lastDate.set(tag, event.date);
    events.push(event);
  }
  return { events, skippedOutOfOrder };
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
    const { events, skippedOutOfOrder } = parseBucharestSheet(csv);
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
        fetchDurationMs: Date.now() - fetchStart,
      },
    };
  }
}
