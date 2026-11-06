/**
 * Donnington H3 (Telford, Shropshire, England) HTML Scraper
 *
 * Scrapes donningtonh3.co.uk — a classic WordPress site whose homepage carries
 * a single forward run <table>:
 *   Run No | Date (DD/MM/YYYY) | Time ("18.30") | Venue | Area | Post Code |
 *   Hare 1 | Hare 2 | Notes
 * The per-year archive pages use the same columns with slightly different
 * header labels ("Run Number", "Hare One", "Postcode", "Hare1") and older date
 * formats ("21 Jun 1976", "03/01/10"), so columns are mapped by header text and
 * the row parser is shared with the one-shot history backfill.
 *
 * Far-future rows are blank skeletons (run# + date only) and the table can
 * carry impossible dates ("31/02/2027") — both are handled without inventing
 * data. Rows without an integer run number (Christmas Day "No Trail", spacer
 * rows) are skipped.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, buildDateWindow, MONTHS } from "../utils";

const KENNEL_TAG = "donnington-h3";
const DEFAULT_URL = "https://www.donningtonh3.co.uk/";

export type DonningtonColumn =
  | "run" | "date" | "time" | "venue" | "area" | "postcode" | "hare1" | "hare2" | "notes";

/** Map a header cell's text to a column key (header labels vary across archive pages). */
export function headerKey(text: string): DonningtonColumn | undefined {
  const t = text.toLowerCase().replaceAll(" ", "");
  if (t.startsWith("run")) return "run";
  if (t === "date") return "date";
  if (t === "time") return "time";
  if (t === "venue") return "venue";
  if (t === "area") return "area";
  if (t.startsWith("postcode")) return "postcode";
  if (t === "hare1" || t === "hareone") return "hare1";
  if (t === "hare2" || t === "haretwo") return "hare2";
  if (t === "notes") return "notes";
  return undefined;
}

const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;
const NAMED_DATE_RE = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/;
const TIME_RE = /^(\d{1,2})[.:]?(\d{2})$/;

function toIsoDate(year: number, month: number, day: number): string | undefined {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "08/11/2026", "03/01/10", "21 Jun 1976" → "YYYY-MM-DD" (undefined if invalid). */
export function parseDonningtonDate(text: string): string | undefined {
  const t = text.trim();
  const slash = SLASH_DATE_RE.exec(t);
  if (slash) {
    let year = Number.parseInt(slash[3], 10);
    if (year < 100) year += 2000;
    return toIsoDate(year, Number.parseInt(slash[2], 10), Number.parseInt(slash[1], 10));
  }
  const named = NAMED_DATE_RE.exec(t);
  if (named) {
    const month = MONTHS[named[2].toLowerCase().slice(0, 3)];
    if (!month) return undefined;
    return toIsoDate(Number.parseInt(named[3], 10), month, Number.parseInt(named[1], 10));
  }
  return undefined;
}

/** "18.30" / "1830" / "11:00" → "HH:MM"; non-time labels → undefined. */
export function parseDonningtonTime(text: string): string | undefined {
  const m = TIME_RE.exec(text.trim());
  if (!m) return undefined;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const PLACEHOLDER_RE = /^(?:tba|tbc|tbd|n\/a|-|\?|hares? needed!?)$/i;

function cellValue(text: string | undefined): string | undefined {
  const t = text?.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
  if (!t || PLACEHOLDER_RE.test(t)) return undefined;
  return t;
}

/** A hare cell that is a call for volunteers, not a name. */
function hareValue(text: string | undefined): string | undefined {
  const t = cellValue(text);
  if (!t) return undefined;
  return t.toLowerCase().includes("volunteer") ? undefined : t;
}

/** Parse one table row (cells keyed by header column). Returns null for non-run rows. */
export function parseDonningtonRow(
  cells: Partial<Record<DonningtonColumn, string>>,
  sourceUrl = DEFAULT_URL,
): RawEventData | null {
  const runText = cells.run?.trim() ?? "";
  if (!/^\d{1,5}$/.test(runText)) return null;
  const date = parseDonningtonDate(cells.date ?? "");
  if (!date) return null;

  const venue = cellValue(cells.venue);
  const area = cellValue(cells.area);
  const postcode = cellValue(cells.postcode);
  const street = [area, postcode].filter(Boolean).join(", ");
  const hares = [hareValue(cells.hare1), hareValue(cells.hare2)].filter(Boolean).join(", ");

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: Number.parseInt(runText, 10),
    startTime: parseDonningtonTime(cells.time ?? ""),
    location: venue ?? area,
    locationStreet: venue && street ? street : undefined,
    hares: hares || undefined,
    description: cellValue(cells.notes),
    sourceUrl,
  };
}

/**
 * Parse every run-table row on a Donnington page (homepage or archive).
 * Exported for the one-shot history backfill.
 */
export function parseDonningtonTable(html: string, sourceUrl: string): RawEventData[] {
  const doc = cheerio.load(html);
  const events: RawEventData[] = [];
  doc("table").each((_t, table) => {
    let columns: (DonningtonColumn | undefined)[] | undefined;
    doc(table).find("tr").each((_r, tr) => {
      const texts = doc(tr).find("td,th").map((_c, cell) => doc(cell).text()).get();
      if (!columns) {
        const keys = texts.map(headerKey);
        if (keys.includes("run") && keys.includes("date")) columns = keys;
        return;
      }
      const cells: Partial<Record<DonningtonColumn, string>> = {};
      texts.forEach((text, i) => {
        const key = columns?.[i];
        if (key) cells[key] = text;
      });
      const event = parseDonningtonRow(cells, sourceUrl);
      if (event) events.push(event);
    });
  });
  return events;
}

export class DonningtonHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { html, $, structureHash, fetchDurationMs } = page;

    const parsed = parseDonningtonTable(html, sourceUrl);
    if (parsed.length === 0) {
      return {
        events: [],
        errors: ["Donnington H3: 0 run rows parsed from the homepage table — markup drift"],
        structureHash,
        diagnosticContext: { tablesFound: $("table").length, fetchDurationMs },
      };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);
    const events = parsed.filter((e) => {
      const d = new Date(`${e.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });

    return {
      events,
      errors: [],
      structureHash,
      diagnosticContext: { rowsParsed: parsed.length, eventsInWindow: events.length, fetchDurationMs },
    };
  }
}
