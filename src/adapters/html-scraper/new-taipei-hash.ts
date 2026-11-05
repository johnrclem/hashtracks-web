import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { appendDescriptionSuffix, applyDateWindow, buildDateWindow, normalizeHaresField } from "../utils";
import { safeFetch } from "../safe-fetch";

/**
 * New Taipei Hash House Harriers (新北捷兔) — `nth3-tw`.
 *
 * The kennel's legacy Big5 `newtaipeihash.com/run_site_<YYYY>.htm` page now
 * 301s to a rebuilt site at nth3.taipeihash.com.tw (Nov 2026), which is backed
 * by a public JSON API:
 *
 *   GET /api/runs?page=N&limit=50   → `data.runs[]` (upcoming + completed,
 *       newest first) + `data.pagination {page, limit, total, total_pages}`.
 *       The server caps `limit` at 50.
 *   GET /api/runs/this-week         → `data.run` — one run with the detail
 *       fields the list omits (description, on-after `bash_place`, `event_link`,
 *       `loc_map_url`). Phone fields (`hare_phone`, `cohare_phone`) are PII and
 *       are never read.
 *
 * Per run: `run_number`, `run_date` "YYYY-MM-DD", `start_time` "14:30:00",
 * `loc_name(_en)` (district), `loc_place(_en)` (venue or street address),
 * `special_note` (theme, e.g. "年會" AGM), `status` ("upcoming" | "completed"),
 * `hare_name(_zh)`, `cohare_name(_zh)`.
 *
 * The adapter pages the list newest→oldest until it passes the start of the
 * ±days window, so a scrape covers the upcoming hareline plus the recent past.
 * History before 2026 was loaded once by scripts/backfill-nth3-tw-history.ts;
 * the source is `upcomingOnly` so aged-out runs are never reconcile-cancelled.
 */

const KENNEL_TAG = "nth3-tw";
const API_BASE = "https://nth3.taipeihash.com.tw/api";
const PAGE_LIMIT = 50; // server-side cap
const MAX_PAGES = 20; // 1000 runs ≈ 19 years — bounds a pagination bug
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Scraper)";
const TIMEOUT_MS = 30_000;

/** Subset of the API run shape we consume. All fields optional — validated at runtime. */
export interface Nth3ApiRun {
  run_number?: number | null;
  run_date?: string | null;
  start_time?: string | null;
  loc_name?: string | null;
  loc_name_en?: string | null;
  loc_place?: string | null;
  loc_place_en?: string | null;
  loc_map_url?: string | null;
  bash_place?: string | null;
  bash_place_en?: string | null;
  description?: string | null;
  event_link?: string | null;
  special_note?: string | null;
  status?: string | null;
  hare_name?: string | null;
  hare_name_zh?: string | null;
  cohare_name?: string | null;
  cohare_name_zh?: string | null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HTTP_URL_RE = /^https?:\/\//i;
const TIME_RE = /^(\d{1,2}):(\d{2})/;

/** First non-empty trimmed string, else undefined. */
function pick(...values: Array<string | null | undefined>): string | undefined {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return undefined;
}

/** Drop tracking params (e.g. `?utm_source=chatgpt.com`) from a maps short-link. */
function cleanMapUrl(raw: string | undefined): string | undefined {
  if (!raw || !HTTP_URL_RE.test(raw)) return undefined;
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

// Overseas specials prefix the country in Chinese ("泰國 清邁", "日本 沖繩").
// merge.ts drops geocodes >200km from the kennel centroid unless
// `countryOverride` is set; "" bypasses that guard with no geocode bias (the
// venue text already names the country). Mirrors new-tokyo-katch.ts.
const FOREIGN_COUNTRY_TOKENS = [
  "泰國", "日本", "越南", "馬來西亞", "菲律賓", "韓國", "香港",
  "新加坡", "中國", "柬埔寨", "印尼", "寮國", "緬甸",
];
function foreignCountryOverride(...texts: Array<string | null | undefined>): string | undefined {
  return texts.some((t) => t && FOREIGN_COUNTRY_TOKENS.some((tok) => t.includes(tok))) ? "" : undefined;
}

/**
 * `loc_place` is the specific venue or street address ("Magong Friendship
 * Park", "No. 141, Chajiao, Sanxia Dist., …"); `loc_name` is usually the
 * district ("Xindian District") and sometimes repeats the venue. Qualify the
 * venue with the district unless the venue already names it.
 */
function composeLocation(place: string | undefined, area: string | undefined): string | undefined {
  if (!place) return area;
  if (!area || area === place) return place;
  const areaRoot = area.replace(/\s*(?:District|Dist\.?)$/i, "").replace(/區$/, "").trim();
  if (areaRoot && place.toLowerCase().includes(areaRoot.toLowerCase())) return place;
  return `${place}, ${area}`;
}

/**
 * Map one API run to RawEventData. Returns null for rows without a valid date.
 * Exported for unit testing.
 */
export function mapNth3Run(run: Nth3ApiRun, sourceUrl: string): RawEventData | null {
  const date = run.run_date?.trim() ?? "";
  if (!DATE_RE.test(date)) return null;
  if (run.status && !["upcoming", "completed"].includes(run.status)) return null;

  const timeMatch = TIME_RE.exec(run.start_time ?? "");
  const startTime = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : undefined;

  // English hash name preferred; fall back to the Chinese name.
  const hares = normalizeHaresField(
    [pick(run.hare_name, run.hare_name_zh), pick(run.cohare_name, run.cohare_name_zh)]
      .filter((h): h is string => !!h)
      .join(", "),
  );

  const location = composeLocation(pick(run.loc_place_en, run.loc_place), pick(run.loc_name_en, run.loc_name));
  const onAfter = pick(run.bash_place_en, run.bash_place);
  const eventLink = pick(run.event_link);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: typeof run.run_number === "number" ? run.run_number : undefined,
    title: pick(run.special_note),
    hares,
    location,
    countryOverride: foreignCountryOverride(run.loc_name, run.loc_place, location),
    locationUrl: cleanMapUrl(pick(run.loc_map_url)),
    startTime,
    description: appendDescriptionSuffix(pick(run.description), onAfter ? `On-after: ${onAfter}` : undefined),
    externalLinks:
      eventLink && HTTP_URL_RE.test(eventLink) ? [{ url: eventLink, label: "Event page" }] : undefined,
    sourceUrl,
  };
}

/** Overlay the this-week detail onto the list row for the same date (detail fields win). */
export function mergeDetail(events: RawEventData[], detail: RawEventData): RawEventData[] {
  const idx = events.findIndex((e) => e.date === detail.date);
  if (idx === -1) return [...events, detail];
  const defined = Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== undefined));
  const merged: RawEventData = { ...events[idx], ...defined };
  return events.map((e, i) => (i === idx ? merged : e));
}

async function getJson(url: string): Promise<unknown> {
  const response = await safeFetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

interface ListPage {
  runs: Nth3ApiRun[];
  totalPages: number;
}

function asListPage(json: unknown): ListPage | null {
  const data = (json as { data?: { runs?: unknown; pagination?: { total_pages?: unknown } } } | null)?.data;
  if (!data || !Array.isArray(data.runs)) return null;
  const totalPages = typeof data.pagination?.total_pages === "number" ? data.pagination.total_pages : 1;
  return { runs: data.runs as Nth3ApiRun[], totalPages };
}

export class NewTaipeiHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const days = options?.days ?? source.scrapeDays ?? 365;
    const sourceUrl = source.url || "https://nth3.taipeihash.com.tw/";
    const windowStart = buildDateWindow(days).minDate.toISOString().slice(0, 10);
    const fetchStart = Date.now();

    const events: RawEventData[] = [];
    const errors: string[] = [];
    let pagesFetched = 0;
    let rowsSeen = 0;

    // This week's run carries the detail fields — independent of the list, so
    // start it now. Enrichment only: a failure is reported below only when the
    // list also produced nothing.
    const detailPromise: Promise<RawEventData | null | Error> = getJson(`${API_BASE}/runs/this-week`).then(
      (json) => {
        const run = (json as { data?: { run?: Nth3ApiRun | null } } | null)?.data?.run;
        return run ? mapNth3Run(run, sourceUrl) : null;
      },
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    );

    // 1. Page the run list newest → oldest until we pass the window start.
    for (let page = 1; page <= MAX_PAGES; page++) {
      let listPage: ListPage | null;
      try {
        listPage = asListPage(await getJson(`${API_BASE}/runs?page=${page}&limit=${PAGE_LIMIT}`));
      } catch (err) {
        errors.push(`Run list page ${page} failed: ${err}`);
        break;
      }
      if (!listPage) {
        errors.push(`Run list page ${page}: unexpected payload shape (no data.runs array)`);
        break;
      }
      pagesFetched++;
      rowsSeen += listPage.runs.length;
      for (const run of listPage.runs) {
        const event = mapNth3Run(run, sourceUrl);
        if (event) events.push(event);
      }
      const oldest = listPage.runs.at(-1)?.run_date ?? "";
      if (listPage.runs.length === 0 || page >= listPage.totalPages || oldest < windowStart) break;
    }

    // 2. Merge the this-week detail.
    const detail = await detailPromise;
    const detailMerged = !!detail && !(detail instanceof Error);
    const merged = detailMerged ? mergeDetail(events, detail) : events;
    if (detail instanceof Error && events.length === 0) {
      errors.push(`This-week detail failed: ${detail}`);
    }

    // Fail loud: a clean fetch with zero runs is API drift, not an empty hareline
    // (weekly kennel, hareline pre-assigned for the year).
    if (merged.length === 0 && errors.length === 0) {
      errors.push(`New Taipei Hash: 0 runs parsed from ${rowsSeen} API rows (API drift?)`);
    }

    return applyDateWindow(
      {
        events: merged,
        errors,
        diagnosticContext: {
          fetchMethod: "nth3-json-api",
          pagesFetched,
          rowsSeen,
          detailMerged,
          fetchDurationMs: Date.now() - fetchStart,
        },
      },
      days,
    );
  }
}
