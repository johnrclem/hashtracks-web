import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { safeFetch } from "../safe-fetch";
import { parseCSV } from "../google-sheets/adapter";
import {
  applyDateWindow,
  chronoParseDate,
  cleanLocationName,
  fetchHTMLPage,
  isPlaceholder,
  normalizeCostSigil,
  normalizeHaresField,
} from "../utils";

/**
 * True Trail H3 (Edmonton, AB) — truetrailh3.com.
 *
 * The Nov-2026 Astro rebuild renders the hareline client-side from a published
 * Google Sheet: the page script does `fetch(SHEET_URL)` where
 * `SHEET_URL = "https://docs.google.com/spreadsheets/d/e/<id>/pub?…&output=csv"`.
 * We read that CSV directly. Header row (matched by name, not position):
 *
 *   published, trailNumber, title, date, time, locationName, address, hares,
 *   theme, hashCash, description, mapUrl, paypalUrl
 *
 * `published` gates rows (TRUE only). `date` comes as ISO ("2026-07-02") or
 * prose ("August 13 2026"). Placeholders — "Sexy Hares Needed" (title and
 * hares), "TBD" venue — are dropped so merge synthesizes defaults.
 *
 * The sheet URL is discovered from the homepage on each scrape (so a
 * republished sheet keeps working); `config.csvUrl` pins it instead.
 */

const KENNEL_TAG = "tth3-ab";
const DEFAULT_URL = "https://truetrailh3.com/";
const DEFAULT_START_TIME = "18:30";
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Scraper)";
const SHEET_URL_RE = /https:\/\/docs\.google\.com\/spreadsheets\/d\/e\/[\w-]+\/pub\?[^"'`\s]*output=csv/;
const TIME_RE = /^(\d{1,2}):(\d{2})/;

/** Find the published-sheet CSV URL in the homepage source. Exported for tests. */
export function findSheetUrl(html: string): string | undefined {
  return SHEET_URL_RE.exec(html)?.[0].replaceAll("&amp;", "&");
}

function clean(value: string | undefined): string | undefined {
  const v = value?.replaceAll(/\s+/g, " ").trim();
  return v && !isPlaceholder(v) && !/hares?\s+needed/i.test(v) ? v : undefined;
}

/** Bare "8" → "$8"; anything else passes through. */
function formatCost(cash: string | undefined): string | undefined {
  if (!cash) return undefined;
  return normalizeCostSigil(/^\d+(?:\.\d+)?$/.test(cash) ? `$${cash}` : cash);
}

const COLUMNS = [
  "published", "trailNumber", "title", "date", "time", "locationName",
  "address", "hares", "hashCash", "description", "mapUrl",
] as const;
type Column = (typeof COLUMNS)[number];

/**
 * Parse the True Trail sheet CSV into events. Exported for unit testing.
 */
export function parseTrueTrailCsv(csv: string, sourceUrl: string): RawEventData[] {
  const [header, ...rows] = parseCSV(csv);
  if (!header) return [];
  const headerKeys = header.map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(
    COLUMNS.map((c) => [c, headerKeys.indexOf(c.toLowerCase())]),
  ) as Record<Column, number>;
  if (idx.date === -1) return [];
  const get = (row: string[], c: Column) => (idx[c] === -1 ? undefined : row[idx[c]]);

  const events: RawEventData[] = [];
  for (const row of rows) {
    if (idx.published !== -1 && get(row, "published")?.trim().toUpperCase() !== "TRUE") continue;
    const dateRaw = get(row, "date")?.trim();
    if (!dateRaw || !/\b(?:19|20)\d{2}\b/.test(dateRaw)) continue;
    const date = chronoParseDate(dateRaw, "en-US");
    if (!date) continue;

    const runDigits = get(row, "trailNumber")?.replace(/\D/g, "");
    const time = TIME_RE.exec(get(row, "time")?.trim() ?? "");
    const hares = clean(get(row, "hares"));
    const mapUrl = get(row, "mapUrl")?.trim();
    const address = clean(get(row, "address"));
    const location = cleanLocationName(clean(get(row, "locationName"))) ?? undefined;

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: runDigits ? Number.parseInt(runDigits, 10) : undefined,
      title: clean(get(row, "title")),
      hares: normalizeHaresField(hares?.split(/\s+(?:&|and)\s+/i).join(", ")),
      location,
      locationStreet: address && address !== location ? address : undefined,
      locationUrl: mapUrl && /^https?:\/\//i.test(mapUrl) ? mapUrl : undefined,
      startTime: time ? `${time[1].padStart(2, "0")}:${time[2]}` : DEFAULT_START_TIME,
      cost: formatCost(clean(get(row, "hashCash"))),
      description: clean(get(row, "description")),
      sourceUrl,
    });
  }
  return events;
}

export class TrueTrailH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const days = options?.days ?? source.scrapeDays ?? 365;
    const pinned = (source.config as { csvUrl?: unknown } | null)?.csvUrl;
    const fetchStart = Date.now();

    let csvUrl = typeof pinned === "string" ? pinned : undefined;
    if (!csvUrl) {
      const page = await fetchHTMLPage(url);
      if (!page.ok) return page.result;
      csvUrl = findSheetUrl(page.html);
      if (!csvUrl) {
        return { events: [], errors: ["True Trail H3: SHEET_URL not found on homepage (site drift?)"] };
      }
    }

    let csv: string;
    try {
      const response = await safeFetch(csvUrl, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) {
        return { events: [], errors: [`True Trail H3: sheet CSV returned HTTP ${response.status}`] };
      }
      csv = await response.text();
    } catch (err) {
      return { events: [], errors: [`True Trail H3: sheet CSV fetch failed: ${err}`] };
    }

    const events = parseTrueTrailCsv(csv, url);
    const errors = events.length === 0 ? ["True Trail H3: 0 runs parsed from sheet CSV (header drift?)"] : [];
    return applyDateWindow(
      {
        events,
        errors,
        diagnosticContext: { fetchMethod: "published-sheet-csv", csvUrl, fetchDurationMs: Date.now() - fetchStart },
      },
      days,
    );
  }
}
