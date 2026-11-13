import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { safeFetch } from "../safe-fetch";
import { parseCSV, parseSheetStartTimeCell } from "../google-sheets/adapter";
import { applyDateWindow, chronoParseDate, googleMapsSearchUrl, normalizeHaresField, stripPlaceholder } from "../utils";

/**
 * Barnes Hash House Harriers (BarnesH3) — weekly Wednesday 19:30 runs around
 * the M25 in Surrey & Sussex.
 *
 * The Nov-2026 rebuild moved the site to GitHub Pages (barnesh3.com; the old
 * www.barnesh3.com/HareLine.htm is gone). `/hareline/` renders client-side from
 * the club's published Google Sheet, whose CSV links live in the site's
 * `/config.js` (`runsCsvUrl`, `venuesCsvUrl`). We read the same two CSVs:
 *
 *   runs:   Run, Date (DD/MM/YYYY), Venue, Hares, Start, Notes
 *   venues: Venue, Address, Postcode, Website, Phone, Notes
 *
 * Venue names join the two. The site's `/hareline.ics` and `/data/*.csv` are
 * build-time copies that lag the sheet, so they're not used. The sheet URLs are
 * rediscovered on every scrape, so a republished sheet keeps working;
 * `config.runsCsvUrl` / `config.venuesCsvUrl` pin them instead.
 */

const KENNEL_TAG = "barnesh3";
const DEFAULT_URL = "https://barnesh3.com/hareline/";
const DEFAULT_START_TIME = "19:30";
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Scraper)";
const SHEET_URL_RE = /\b(runsCsvUrl|venuesCsvUrl):\s*"([^"]*)"/g;
const HARE_SEPARATOR_RE = /\s+(?:&|and)\s+/gi;

interface SheetUrls {
  runsCsvUrl?: string;
  venuesCsvUrl?: string;
}

const httpsOnly = (url: unknown) => (typeof url === "string" && url.startsWith("https://") ? url : undefined);

/**
 * The published-sheet CSV links in the site's config.js. The last assignment of
 * a key wins, as with config.js's own `Object.assign` overrides. Exported for tests.
 */
export function findSheetUrls(configJs: string): SheetUrls {
  const last = Object.fromEntries([...configJs.matchAll(SHEET_URL_RE)].map((m) => [m[1], m[2]]));
  return { runsCsvUrl: httpsOnly(last.runsCsvUrl), venuesCsvUrl: httpsOnly(last.venuesCsvUrl) };
}

/** Cell text with whitespace collapsed; undefined when empty or a placeholder. */
function clean(value: string | undefined): string | undefined {
  return stripPlaceholder(value?.replaceAll(/\s+/g, " "));
}

/** Blank cell → undefined (unknown); placeholder ("TBA", "Hare Wanted") → null (explicit clear). */
function cellOrClear(raw: string | undefined): string | null | undefined {
  return raw?.trim() ? (clean(raw) ?? null) : undefined;
}

/** Header-keyed rows: `header` names (lowercased) → cell text. */
function csvRecords(csv: string): Map<string, string>[] {
  const [header, ...rows] = parseCSV(csv);
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return rows.map((row) => new Map(keys.map((k, i) => [k, row[i] ?? ""])));
}

/** Venue name (lowercased) → "Address, Postcode", from the venues sheet. Exported for tests. */
export function parseBarnesVenues(csv: string): Map<string, string> {
  const venues = new Map<string, string>();
  for (const rec of csvRecords(csv)) {
    const name = clean(rec.get("venue"));
    const street = [clean(rec.get("address")), clean(rec.get("postcode"))].filter(Boolean).join(", ");
    if (name && street) venues.set(name.toLowerCase(), street);
  }
  return venues;
}

/** Parse the runs sheet CSV into events. Exported for tests. */
export function parseBarnesRuns(
  csv: string,
  venues: Map<string, string>,
  sourceUrl: string,
): RawEventData[] {
  const events: RawEventData[] = [];
  for (const rec of csvRecords(csv)) {
    const dateRaw = rec.get("date")?.trim();
    if (!dateRaw || !/\b(?:19|20)\d{2}\b/.test(dateRaw)) continue;
    const date = chronoParseDate(dateRaw, "en-GB");
    if (!date) continue;

    const runDigits = rec.get("run")?.trim();
    const runNumber = runDigits && /^\d+$/.test(runDigits) ? Number.parseInt(runDigits, 10) : undefined;
    // A "TBA" venue or "Hare Wanted" clears what was there before; a blank cell is unknown.
    const location = cellOrClear(rec.get("venue"));
    const locationStreet = location ? venues.get(location.toLowerCase()) : location;
    const hares = cellOrClear(rec.get("hares"));

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      // Kept from the old HareLine.htm adapter so titles don't drift.
      title: runNumber ? `Barnes Hash Run #${runNumber}` : undefined,
      hares: hares ? normalizeHaresField(hares.replaceAll(HARE_SEPARATOR_RE, ", ")) : hares,
      location,
      locationStreet,
      locationUrl: locationStreet ? googleMapsSearchUrl(`${location}, ${locationStreet}`) : undefined,
      startTime: parseSheetStartTimeCell(rec.get("start")) ?? DEFAULT_START_TIME,
      description: clean(rec.get("notes")),
      sourceUrl,
    });
  }
  return events;
}

async function fetchText(url: string): Promise<string> {
  const res = await safeFetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

/**
 * The runs and venues CSVs. Their URLs come from `source.config` when pinned
 * (for an outage where config.js changed shape), else from the site's config.js.
 * Venues only add the street address, so their failure is reported, not thrown.
 */
async function fetchSheets(pageUrl: string, pinned: SheetUrls) {
  const urls = pinned.runsCsvUrl ? pinned : findSheetUrls(await fetchText(new URL("/config.js", pageUrl).href));
  const { runsCsvUrl, venuesCsvUrl } = urls;
  if (!runsCsvUrl) throw new Error("runsCsvUrl not found in config.js (site drift?)");
  let venuesError: string | undefined;
  const [runsCsv, venuesCsv] = await Promise.all([
    fetchText(runsCsvUrl),
    venuesCsvUrl
      ? fetchText(venuesCsvUrl).catch((err: unknown) => {
          venuesError = err instanceof Error ? err.message : String(err);
          return "";
        })
      : "",
  ]);
  return { runsCsvUrl, runsCsv, venuesCsv, venuesError };
}

export class BarnesHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const pageUrl = source.url || DEFAULT_URL;
    const days = options?.days ?? source.scrapeDays ?? 90;
    const config = (source.config ?? {}) as Record<string, unknown>;
    const pinned = { runsCsvUrl: httpsOnly(config.runsCsvUrl), venuesCsvUrl: httpsOnly(config.venuesCsvUrl) };
    const fetchStart = Date.now();

    let sheets: Awaited<ReturnType<typeof fetchSheets>>;
    try {
      sheets = await fetchSheets(pageUrl, pinned);
    } catch (err) {
      const message = `Barnes H3: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: pageUrl, message }] } };
    }

    const events = parseBarnesRuns(sheets.runsCsv, parseBarnesVenues(sheets.venuesCsv), pageUrl);
    const errors = events.length === 0 ? ["Barnes H3: 0 runs parsed from the runs sheet (header drift?)"] : [];
    return applyDateWindow(
      {
        events,
        errors,
        diagnosticContext: {
          fetchMethod: "published-sheet-csv",
          runsCsvUrl: sheets.runsCsvUrl,
          venuesError: sheets.venuesError,
          fetchDurationMs: Date.now() - fetchStart,
        },
      },
      days,
    );
  }
}
