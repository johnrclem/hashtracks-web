/**
 * Muscateers Hash House Harriers (MusH3) — first 🇴🇲 Oman kennel (Muscat, est. 2023).
 *
 * Two server-rendered WordPress.com pages:
 *
 *   1. Receding Hareline (`/mush3-meets/receding-hareline/`) — one `<table>` of
 *      every meet since #1 (1.9.23): `Date | Meet | Details | Hares`, newest
 *      first. Dates are dotted D.M.YY. Rows without a meet number are socials or
 *      specials; their Details cell becomes the title. The kennel only fills a row
 *      in after the meet, so this page is the archive.
 *   2. Diary (`/mush3-meets/calendar/`) — the forward schedule: bold "Month YYYY"
 *      headings followed by one paragraph per meet ("25th September",
 *      "27th November – 50 years of Hashing in Oman event."). Dates only.
 *
 * Diary dates with no hareline row on the same day are emitted as bare upcoming
 * meets. Both pages drop or rewrite rows over time, so the source ships
 * `upcomingOnly: true`. A numbered row whose date runs backwards against the
 * meet numbering is a year typo ("5.6.25" for #72 among 2026 rows) and is
 * dropped. No start times are published (meets are by prior registration).
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, filterEventsByWindow } from "../utils";

const KENNEL_TAG = "mush3";
const DEFAULT_URL = "https://muscateersh3.com/mush3-meets/receding-hareline/";
const DIARY_URL = "https://muscateersh3.com/mush3-meets/calendar/";

const MONTHS = new Map<string, number>([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);
const DOTTED_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/;
const MONTH_HEADING_RE = /^([A-Za-z]{3,9}) (\d{4})$/;
const DIARY_DAY_RE = /^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9})\b/;
const RUN_RE = /^\d{1,4}$/;
const TYPO_GAP_MS = 120 * 86_400_000;

function clean(text: string): string {
  return text.replaceAll(" ", " ").replaceAll(/\s+/g, " ").trim();
}

function toIso(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** "11.9.26" / "12.04.25" → "YYYY-MM-DD"; null if malformed. */
export function parseDottedDate(text: string): string | null {
  const m = DOTTED_DATE_RE.exec(text.trim());
  if (!m) return null;
  let year = Number.parseInt(m[3], 10);
  if (year < 100) year += 2000;
  return toIso(year, Number.parseInt(m[2], 10), Number.parseInt(m[1], 10));
}

/** "Prozac man, Omar Sharifa" → sorted "Omar Sharifa, Prozac man"; blank → undefined. */
export function splitHares(text: string): string | undefined {
  const names = clean(text)
    .replaceAll("&", ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return undefined;
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
}

function isCancelled(cells: string[]): boolean {
  return cells.some((c) => c.toLowerCase().includes("cancel"));
}

/** Parse the receding-hareline table (newest first). Exported for tests. */
export function parseRecedingHareline(html: string): { events: RawEventData[]; droppedTypos: number } {
  const $ = cheerio.load(html);
  const rows: RawEventData[] = [];
  $("table tr").each((_i, tr) => {
    const cells = $(tr).find("td").toArray().map((td) => clean($(td).text()));
    if (cells.length < 4 || isCancelled(cells)) return;
    const date = parseDottedDate(cells[0]);
    if (!date) return; // header / spacer rows
    const numbered = RUN_RE.test(cells[1]);
    const details = cells[2] || undefined;
    rows.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: numbered ? Number.parseInt(cells[1], 10) : undefined,
      // Numbered meets: Details is the venue and merge synthesizes the title.
      // Un-numbered socials/specials: Details names the event itself.
      title: numbered ? undefined : details,
      location: numbered ? details : undefined,
      hares: splitHares(cells[3]),
      sourceUrl: DEFAULT_URL,
    });
  });

  // Year-typo guard: a numbered meet whose date is far (>120 days) from BOTH of
  // its run-number neighbours has a mistyped year ("5.6.25" for #72 among 2026
  // rows). A small disagreement between neighbours (#43 28.4.25 vs #44 25.4.25)
  // is left alone.
  const numbered = rows.filter((e) => e.runNumber !== undefined).sort((a, b) => a.runNumber! - b.runNumber!);
  const typos = new Set<RawEventData>();
  numbered.forEach((e, i) => {
    const t = Date.parse(e.date);
    const far = (other: RawEventData | undefined) => !other || Math.abs(t - Date.parse(other.date)) > TYPO_GAP_MS;
    const hasNeighbour = i > 0 || i < numbered.length - 1;
    if (hasNeighbour && far(numbered[i - 1]) && far(numbered[i + 1])) typos.add(e);
  });
  return { events: rows.filter((e) => !typos.has(e)), droppedTypos: typos.size };
}

function diaryParagraphs($: CheerioAPI): string[] {
  return $("p")
    .toArray()
    .map((p) => clean($(p).text()))
    .filter(Boolean);
}

/** Parse the Diary page's "Month YYYY" headings + "Nth Month" lines. Exported for tests. */
export function parseDiary(html: string): RawEventData[] {
  const events: RawEventData[] = [];
  let year: number | undefined;
  for (const line of diaryParagraphs(cheerio.load(html))) {
    const heading = MONTH_HEADING_RE.exec(line);
    if (heading && MONTHS.has(heading[1].slice(0, 3).toLowerCase())) {
      year = Number.parseInt(heading[2], 10);
      continue;
    }
    const day = DIARY_DAY_RE.exec(line);
    if (!day || year === undefined) continue;
    const month = MONTHS.get(day[2].slice(0, 3).toLowerCase());
    const date = month ? toIso(year, month, Number.parseInt(day[1], 10)) : null;
    if (!date) continue;
    const dash = Math.max(line.indexOf("–"), line.indexOf(" - "));
    const note = dash >= 0 ? clean(line.slice(dash + 1)).replace(/^-\s?/, "").replace(/\.$/, "") : "";
    events.push({ date, kennelTags: [KENNEL_TAG], title: note || undefined, sourceUrl: DIARY_URL });
  }
  return events;
}

export class MuscateersHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const [hareline, diary] = await Promise.all([fetchHTMLPage(url), fetchHTMLPage(DIARY_URL)]);
    if (!hareline.ok) return hareline.result;

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { events, droppedTypos } = parseRecedingHareline(hareline.html);
    if (events.length === 0) errors.push(`MusH3: no meets parsed from ${url}`);

    let diaryEvents: RawEventData[] = [];
    if (diary.ok) {
      const known = new Set(events.map((e) => e.date));
      diaryEvents = parseDiary(diary.html).filter((e) => !known.has(e.date));
    } else {
      errors.push(`MusH3: diary fetch failed (${diary.result.errors.join("; ")})`);
      errorDetails.fetch = diary.result.errorDetails?.fetch;
    }

    const windowed = filterEventsByWindow([...events, ...diaryEvents], options?.days ?? 90);
    return {
      events: windowed,
      errors,
      structureHash: hareline.structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        harelineRows: events.length,
        diaryOnly: diaryEvents.length,
        droppedTypos,
        eventsParsed: windowed.length,
        fetchDurationMs: hareline.fetchDurationMs,
      },
    };
  }
}
