/**
 * Surrey H3 (Surrey, England) HTML Scraper
 *
 * Scrapes surreyhashhouseharriers.com/receding-hareline/ — an Elementor/Astra
 * WordPress page with no <table>. Each forthcoming run is its own Elementor
 * top-level <section> holding three `text-editor` widgets in document order:
 *   [0] "<run#> <dd Month[ yyyy]>"  (run# usually a link to /trail-<n>-.../)
 *   [1] hare(s)
 *   [2] location
 * Current-year rows omit the year ("08 November"); next-year rows carry it
 * ("03 January 2027"). One-off bonus trails have a date but no run number.
 *
 * Each linked /trail-<n>-.../ detail page is fetched for enrichment: it is a
 * sequence of `heading` widgets ("Trail no:", "Hare(s):", "From:", "On on:",
 * "Directions/details") each followed by a `text-editor` value widget, plus
 * `button` widgets ("Map link to Start" → Google Maps). The detail page's
 * "Trail no:" value ("2650, 8 November 2026") is year-bearing and wins over the
 * grid's year inference.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, buildDateWindow, MONTHS } from "../utils";

const KENNEL_TAG = "surrey-h3";
const DEFAULT_URL = "https://surreyhashhouseharriers.com/receding-hareline/";
const START_TIME = "11:00";

/** "2650 08 November" / "2658 03 January 2027" / "01 January 2027" */
const GRID_DATE_RE = /^(?:(\d{3,5})\s+)?(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/;
/** Detail "Trail no:" value — "2650, 8 November 2026" (older pages omit the year: "2634, 19 July") */
const DETAIL_TRAIL_RE = /^(\d{3,5}),?\s+(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/;

const PLACEHOLDERS = new Set(["", "tbc", "tba", "tbd", "x", "¦", "-", "?"]);

function clean(text: string): string {
  return text.replaceAll(" ", " ").replace(/\s+/g, " ").trim();
}

function valueOrUndefined(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const t = clean(text);
  return PLACEHOLDERS.has(t.toLowerCase()) ? undefined : t;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(name: string): number | undefined {
  return MONTHS[name.toLowerCase().slice(0, 3)];
}

/**
 * Year for a year-less forward-hareline date: the current year, unless that
 * lands more than ~6 months in the past (then it's next year's run). A rolling
 * forward feed never lists runs that far back, so this can't misfile a stale
 * row as a phantom future one.
 */
export function inferYear(month: number, day: number, now = new Date()): number {
  const year = now.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day, 12);
  const sixMonthsMs = 183 * 24 * 60 * 60 * 1000;
  return candidate < now.getTime() - sixMonthsMs ? year + 1 : year;
}

export interface SurreyGridRow {
  runNumber?: number;
  date: string;
  hares?: string;
  location?: string;
  detailUrl?: string;
}

/** Parse one hareline <section>'s three cell texts. Returns null for header/non-run sections. */
export function parseSurreyGridRow(
  cells: string[],
  detailUrl: string | undefined,
  now = new Date(),
): SurreyGridRow | null {
  if (cells.length < 3) return null;
  const m = GRID_DATE_RE.exec(clean(cells[0]));
  if (!m) return null;
  const month = monthNumber(m[3]);
  if (!month) return null;
  const day = Number.parseInt(m[2], 10);
  const year = m[4] ? Number.parseInt(m[4], 10) : inferYear(month, day, now);
  const date = toIsoDate(year, month, day);
  if (!date) return null;
  return {
    runNumber: m[1] ? Number.parseInt(m[1], 10) : undefined,
    date,
    hares: valueOrUndefined(cells[1]),
    location: valueOrUndefined(cells[2]),
    detailUrl,
  };
}

export interface SurreyDetail {
  runNumber?: number;
  date?: string;
  hares?: string;
  from?: string;
  onOn?: string;
  notes?: string;
  directions?: string;
  mapUrl?: string;
}

const LABEL_KEYS: Record<string, keyof SurreyDetail> = {
  "trail no:": "runNumber",
  "hare(s):": "hares",
  "from:": "from",
  "on on:": "onOn",
  "directions/details": "directions",
};

/** Parse a /trail-<n>-.../ detail page (Elementor heading → value widget pairs). */
export function parseSurreyDetail(html: string): SurreyDetail {
  const $ = cheerio.load(html);
  const detail: SurreyDetail = {};
  let pending: keyof SurreyDetail | undefined;
  let lastLabel: keyof SurreyDetail | undefined;

  $(".entry-content .elementor-widget").each((_i, el) => {
    const $el = $(el);
    const type = $el.attr("data-widget_type") ?? "";
    const text = clean($el.text());

    if (type.startsWith("heading")) {
      pending = LABEL_KEYS[text.toLowerCase()];
      return;
    }
    if (type.startsWith("button")) {
      const href = $el.find("a").attr("href");
      if (text.toLowerCase() === "map link to start" && href && /^https?:\/\//.test(href)) {
        detail.mapUrl = href;
      }
      return;
    }
    if (!type.startsWith("text-editor")) return;

    if (pending === "runNumber") {
      const m = DETAIL_TRAIL_RE.exec(text);
      if (m) {
        detail.runNumber = Number.parseInt(m[1], 10);
        const month = monthNumber(m[3]);
        // Year-less values leave `date` unset; the grid row's inference stands.
        if (month && m[4]) {
          detail.date = toIsoDate(Number.parseInt(m[4], 10), month, Number.parseInt(m[2], 10)) ?? undefined;
        }
      }
    } else if (pending) {
      const value = valueOrUndefined(text);
      if (value) (detail[pending] as string) = value;
    } else if (lastLabel === "onOn") {
      // A label-less text-editor right after "On on:" carries run notes
      // ("Remembrance Sunday. Run will start at 11:02.").
      const value = valueOrUndefined(text);
      if (value) detail.notes = detail.notes ? `${detail.notes} ${value}` : value;
    }
    if (pending) lastLabel = pending;
    pending = undefined;
  });

  return detail;
}

/** Combine a grid row with its (optional) detail page into a RawEventData. */
export function buildSurreyEvent(row: SurreyGridRow, detail?: SurreyDetail): RawEventData {
  // The year-bearing detail date is authoritative when the run numbers agree.
  const detailMatches = detail?.runNumber !== undefined && detail.runNumber === row.runNumber;
  const date = detailMatches && detail?.date ? detail.date : row.date;

  const location = row.location ?? detail?.from;
  const locationStreet = detail?.from && detail.from !== location ? detail.from : undefined;

  const descParts = [
    detail?.notes,
    detail?.onOn ? `On On: ${detail.onOn}` : undefined,
    detail?.directions,
  ].filter((p): p is string => Boolean(p));

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: row.runNumber,
    // One-off bonus trails have no run number; their "hares" cell is the
    // event's name ("Bonus Haggis trail, courtesy of Le Pro").
    title: row.runNumber === undefined ? row.hares : undefined,
    hares: row.runNumber === undefined ? undefined : (row.hares ?? detail?.hares),
    location,
    locationStreet,
    locationUrl: detail?.mapUrl,
    startTime: START_TIME,
    description: descParts.length > 0 ? descParts.join("\n\n") : undefined,
    sourceUrl: row.detailUrl ?? DEFAULT_URL,
  };
}

export class SurreyHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const rows: SurreyGridRow[] = [];
    const sections = $(".entry-content section.elementor-top-section");
    sections.each((_i, el) => {
      const $s = $(el);
      const cells = $s
        .find(".elementor-widget-text-editor")
        .map((_j, w) => $(w).text())
        .get();
      const href = $s.find(".elementor-widget-text-editor").first().find("a").attr("href");
      const row = parseSurreyGridRow(cells, href && /\/trail-\d+/.test(href) ? href : undefined);
      if (row) rows.push(row);
    });

    if (rows.length === 0) {
      return {
        events: [],
        errors: ["Surrey H3: 0 rows parsed from receding-hareline — markup drift"],
        structureHash,
        diagnosticContext: { sectionsFound: sections.length, fetchDurationMs },
      };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 120);
    const inWindow = rows.filter((r) => {
      const d = new Date(`${r.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });

    const detailFailures: string[] = [];
    const events = await Promise.all(
      inWindow.map(async (row) => {
        if (!row.detailUrl) return buildSurreyEvent(row);
        const detailPage = await fetchHTMLPage(row.detailUrl);
        if (!detailPage.ok) {
          detailFailures.push(`${row.detailUrl}: ${detailPage.result.errors[0] ?? "fetch failed"}`);
          return buildSurreyEvent(row);
        }
        return buildSurreyEvent(row, parseSurreyDetail(detailPage.html));
      }),
    );

    return {
      events,
      errors: [],
      structureHash,
      diagnosticContext: {
        sectionsFound: sections.length,
        rowsParsed: rows.length,
        eventsInWindow: events.length,
        detailFailures,
        fetchDurationMs,
      },
    };
  }
}
