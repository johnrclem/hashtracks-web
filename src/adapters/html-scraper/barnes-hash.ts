import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { safeFetch } from "../safe-fetch";
import { parseCSV } from "../google-sheets/adapter";
import { applyDateWindow, chronoParseDate, googleMapsSearchUrl, isPlaceholder, normalizeHaresField } from "../utils";

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
 * rediscovered on every scrape, so a republished sheet keeps working.
 */

const KENNEL_TAG = "barnesh3";
const DEFAULT_URL = "https://barnesh3.com/hareline/";
const DEFAULT_START_TIME = "19:30";
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Scraper)";
const RUNS_CSV_RE = /\brunsCsvUrl:\s*"([^"]*)"/g;
const VENUES_CSV_RE = /\bvenuesCsvUrl:\s*"([^"]*)"/g;
const TIME_RE = /^(\d{1,2})[:.](\d{2})$/;
const HARE_SEPARATOR_RE = /\s+(?:&|and)\s+/gi;

/** The last assignment of a key wins, as with config.js's own `Object.assign` overrides. */
function lastHttpsValue(configJs: string, re: RegExp): string | undefined {
  const value = [...configJs.matchAll(re)].at(-1)?.[1];
  return value?.startsWith("https://") ? value : undefined;
}

/** The published-sheet CSV links in the site's config.js. Exported for tests. */
export function findSheetUrls(configJs: string): { runsCsvUrl?: string; venuesCsvUrl?: string } {
  return { runsCsvUrl: lastHttpsValue(configJs, RUNS_CSV_RE), venuesCsvUrl: lastHttpsValue(configJs, VENUES_CSV_RE) };
}

function clean(value: string | undefined): string | undefined {
  const v = value?.replaceAll(/\s+/g, " ").trim();
  return v && !isPlaceholder(v) ? v : undefined;
}

/** Header-keyed rows: `header` names (lowercased) → cell text. */
function csvRecords(csv: string): Map<string, string>[] {
  const [header, ...rows] = parseCSV(csv);
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return rows.map((row) => new Map(keys.map((k, i) => [k, row[i] ?? ""])));
}

/** Hare names; "Hare Wanted" is null (explicit clear) so merge scrubs a dropped hare. */
function parseHares(raw: string | undefined): string | null | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const hares = clean(text);
  return hares ? normalizeHaresField(hares.replaceAll(HARE_SEPARATOR_RE, ", ")) : null;
}

function venueKey(name: string): string {
  return name.replaceAll(/\s+/g, " ").trim().toLowerCase();
}

/** Venue name → "Address, Postcode", from the venues sheet. Exported for tests. */
export function parseBarnesVenues(csv: string): Map<string, string> {
  const venues = new Map<string, string>();
  for (const rec of csvRecords(csv)) {
    const name = clean(rec.get("venue"));
    const street = [clean(rec.get("address")), clean(rec.get("postcode"))].filter(Boolean).join(", ");
    if (name && street) venues.set(venueKey(name), street);
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
    const venueRaw = rec.get("venue")?.trim();
    const location = clean(venueRaw);
    // A "TBA" venue is an explicit clear, so a pub that fell through doesn't linger.
    const venueCleared = !location && Boolean(venueRaw);
    const locationStreet = location ? venues.get(venueKey(location)) : undefined;
    const time = TIME_RE.exec(rec.get("start")?.trim() ?? "");

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      // Kept from the old HareLine.htm adapter so titles don't drift.
      title: runNumber ? `Barnes Hash Run #${runNumber}` : undefined,
      hares: parseHares(rec.get("hares")),
      location: venueCleared ? null : location,
      locationStreet: venueCleared ? null : locationStreet,
      locationUrl: locationStreet ? googleMapsSearchUrl(`${location}, ${locationStreet}`) : undefined,
      startTime: time ? `${time[1].padStart(2, "0")}:${time[2]}` : DEFAULT_START_TIME,
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

export class BarnesHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const pageUrl = source.url || DEFAULT_URL;
    const days = options?.days ?? source.scrapeDays ?? 90;
    const fetchStart = Date.now();

    let runsCsv: string;
    let venuesCsv = "";
    let venuesError: string | undefined;
    let csvUrls: ReturnType<typeof findSheetUrls>;
    try {
      csvUrls = findSheetUrls(await fetchText(new URL("/config.js", pageUrl).href));
      const { runsCsvUrl, venuesCsvUrl } = csvUrls;
      if (!runsCsvUrl) throw new Error("runsCsvUrl not found in config.js (site drift?)");
      const runsFetch = fetchText(runsCsvUrl);
      // Venues only add the street address; a failure there isn't worth failing the scrape.
      const venuesFetch = venuesCsvUrl
        ? fetchText(venuesCsvUrl).catch((err: unknown) => {
            venuesError = err instanceof Error ? err.message : String(err);
            return "";
          })
        : Promise.resolve("");
      [runsCsv, venuesCsv] = await Promise.all([runsFetch, venuesFetch]);
    } catch (err) {
      const message = `Barnes H3: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: pageUrl, message }] } };
    }

    const events = parseBarnesRuns(runsCsv, parseBarnesVenues(venuesCsv), pageUrl);
    const errors = events.length === 0 ? ["Barnes H3: 0 runs parsed from the runs sheet (header drift?)"] : [];
    return applyDateWindow(
      {
        events,
        errors,
        diagnosticContext: {
          fetchMethod: "published-sheet-csv",
          runsCsvUrl: csvUrls.runsCsvUrl,
          venuesError,
          fetchDurationMs: Date.now() - fetchStart,
        },
      },
      days,
    );
  }
}
