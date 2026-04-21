import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  fetchHTMLPage,
  HARE_BOILERPLATE_RE,
  normalizeHaresField,
  stripHtmlTags,
} from "../utils";

/**
 * Bangkok Hash (bangkokhash.com) adapter — shared Joomla site for 3 kennels.
 *
 * bangkokhash.com hosts three sub-sites under one domain:
 *   /thursday/  → Bangkok Thursday H3 (BTH3) — weekly Thu 18:30
 *   /fullmoon/  → Bangkok Full Moon H3 (BFMH3) — monthly Fri 18:30
 *   /siamsunday/ → Siam Sunday H3 (S2H3) — 2nd & 4th Sun 16:30
 *
 * Each sub-site has:
 *   1. A Joomla article with labeled fields for the next run:
 *      <strong>Date</strong>: 16-Apr-2026
 *      <strong>Start Time</strong>: 18:30
 *      <strong>Hare</strong>: Jessticles
 *      <strong>Station</strong>: BTS Chong Nonsi
 *
 *   2. A PHP JSON API hareline iframe at:
 *      /H222k3/Runs/05_Hareline/ViewHL_Server.php (BTH3, BFMH3)
 *      /H220j/Runs/05_Hareline/ViewHL_Server.php  (S2H3)
 *      POST body: {"usewamp":0,"hashclub":"BTH3","viewoption":"0"}
 *
 * The PHP API returns JSON array: [debugInfo, harelineHtml, tableName]
 * The harelineHtml contains date blocks with run#/hare info.
 *
 * The hareline iframe also shows Fullmoon entries inline with BTH3 dates,
 * identified by "Fullmoon-NNN" labels instead of "Run #NNN".
 *
 * Source config:
 *   { "subSite": "thursday", "hashClub": "BTH3", "apiBase": "/H222k3" }
 */

interface BangkokHashConfig {
  subSite: string;     // "thursday" | "fullmoon" | "siamsunday"
  hashClub: string;    // "BTH3" | "BFMH3" | "S2H3"
  apiBase: string;     // "/H222k3" or "/H220j"
  kennelTag: string;   // "bth3" | "bfmh3" | "s2h3"
  defaultTime: string; // "18:30" or "16:30"
}

const SITE_CONFIGS: Record<string, BangkokHashConfig> = {
  thursday: { subSite: "thursday", hashClub: "BTH3", apiBase: "/H222k3", kennelTag: "bth3", defaultTime: "18:30" },
  fullmoon: { subSite: "fullmoon", hashClub: "BFMH3", apiBase: "/H222k3", kennelTag: "bfmh3", defaultTime: "18:30" },
  siamsunday: { subSite: "siamsunday", hashClub: "S2H3", apiBase: "/H220j", kennelTag: "s2h3", defaultTime: "16:30" },
};

// #827: guard against label strings leaking as field values when the source
// emits an empty slot (e.g. "Run Site: Run Site:" → captures "Run Site:").
// Set membership beats an alternation regex for maintainability (and sidesteps
// SonarCloud's regex-complexity ceiling). Mirrors the `grab()` label list.
const FIELD_LABELS = new Set([
  "run site", "station", "restaurant", "location",
  "hare", "hares", "date", "start time",
  "google map", "google maps", "google map link", "google maps link",
]);

function isFieldLabel(val: string): boolean {
  const normalized = val.toLowerCase().replace(/:\s*$/, "").replace(/\s+/g, " ").trim();
  return FIELD_LABELS.has(normalized);
}

/**
 * Parse the Joomla next-run article. This has labeled fields in
 * `<strong>Label</strong>: Value` format within `.item-content`.
 *
 * Exported for unit testing.
 */
export function parseNextRunArticle(
  html: string,
  kennelTag: string,
  defaultTime: string,
  sourceUrl: string,
): RawEventData | null {
  const $ = cheerio.load(html);
  const article = $(".item-content").first();
  if (!article.length) return null;

  const text = decodeEntities(stripHtmlTags(article.html() ?? "", "\n"));

  const grab = (label: string): string | undefined => {
    const re = new RegExp(`${label}\\s*:\\s*(.+?)(?:\\n|$)`, "i");
    const m = re.exec(text);
    const val = m?.[1]?.trim();
    if (!val) return undefined;
    if (isFieldLabel(val)) return undefined;
    return val;
  };

  const dateRaw = grab("Date");
  if (!dateRaw) return null;
  const date = chronoParseDate(dateRaw, "en-GB");
  if (!date) return null;

  const startTimeRaw = grab("Start\\s*Time");
  const startTime = startTimeRaw && /^\d{1,2}:\d{2}$/.test(startTimeRaw)
    ? startTimeRaw
    : defaultTime;

  // #802: the labeled `Hares:` field sometimes carries filler like "On On Q"
  // instead of a real name. Mirror the API-path boilerplate guard so we don't
  // ship "On On Q" as a hare name.
  const hareRaw = grab("Hares?");
  const hare = hareRaw && !HARE_BOILERPLATE_RE.test(hareRaw) ? hareRaw : undefined;
  const station = grab("Station");
  const runSite = grab("Run\\s*Site");
  const restaurant = grab("Restaurant");
  const locationRaw = grab("Location");
  const googleMap = grab("Google\\s*(?:maps?|Map)\\s*(?:Link)?");

  // Extract run number from the article title
  const titleMatch = /Run\s*#?\s*(\d+)/i.exec(text);
  const runNumber = titleMatch ? Number.parseInt(titleMatch[1], 10) : undefined;

  // Strip "Google Map:" prefix from runSite — when the kennel uses that as the label it's not
  // a useful venue name. Fall back to station (BTS stop etc.) when runSite is just a map label.
  const runSiteClean = runSite && !/^Google\s*Map/i.test(runSite) ? runSite : undefined;
  const locationCandidate = locationRaw ?? runSiteClean ?? station ?? restaurant ?? undefined;
  // Filter out empty/placeholder values
  const location = locationCandidate && locationCandidate.length > 1 ? locationCandidate : undefined;
  const locationUrl = googleMap && /^https?:\/\//.test(googleMap) ? googleMap : undefined;

  return {
    date,
    kennelTag,
    runNumber,
    hares: normalizeHaresField(hare),
    location: location || undefined,
    locationUrl,
    startTime,
    sourceUrl,
  };
}

/**
 * Parse the PHP hareline API response HTML.
 * The HTML is a series of div blocks:
 *   <div style='...'>
 *     <div style='font-weight: bold; ...'>DD-Mon-YYYY <span>Thursday</span></div>
 *     <div style='...'>
 *       <label>Run #519</label>Jessticles
 *       OR
 *       <label>&nbsp;</label><label>Fullmoon-255</label>
 *     </div>
 *   </div>
 *
 * Exported for unit testing.
 */
export function parseHarelineApiHtml(
  harelineHtml: string,
  kennelTag: string,
  fullmoonTag: string | null,
  defaultTime: string,
  sourceUrl: string,
): RawEventData[] {
  const $ = cheerio.load(harelineHtml);
  const events: RawEventData[] = [];

  // Each top-level div is a run entry
  $("body > div").each((_i, el) => {
    const $entry = $(el);

    // Date header: first child div with bold styling
    const dateDiv = $entry.find("div").first();
    const dateText = dateDiv.text().trim();
    // Pattern: "DD-Mon-YYYY" followed by day name
    const dateMatch = /(\d{1,2}-[A-Za-z]{3}-\d{4})/.exec(dateText);
    if (!dateMatch) return;

    const date = chronoParseDate(dateMatch[1], "en-GB");
    if (!date) return;

    // Info row: second div with run# and hare
    const infoDiv = $entry.find("div").eq(1);
    const infoText = infoDiv.text().trim();

    // Check if this is a Fullmoon entry — route to fullmoonTag if set
    // (Thursday subsite cross-lists FM runs), otherwise fall back to the
    // current kennel (the FM subsite itself is the target).
    const fullmoonMatch = /Fullmoon-(\d+)/i.exec(infoText);
    if (fullmoonMatch) {
      events.push({
        date,
        kennelTag: fullmoonTag ?? kennelTag,
        runNumber: Number.parseInt(fullmoonMatch[1], 10),
        startTime: "18:30",
        sourceUrl,
      });
      return;
    }

    // Regular run entry: "Run #519" followed by hare name
    const runMatch = /Run\s*#?\s*(\d+)/i.exec(infoText);
    const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

    let hares: string | undefined;
    if (runMatch) {
      const afterRun = infoText.slice(runMatch.index + runMatch[0].length).trim();
      if (afterRun && !HARE_BOILERPLATE_RE.test(afterRun)) {
        hares = normalizeHaresField(afterRun);
      }
    }

    events.push({
      date,
      kennelTag,
      runNumber,
      hares,
      startTime: defaultTime,
      sourceUrl,
    });
  });

  return events;
}

export class BangkokHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = (source.config ?? {}) as Record<string, unknown>;
    const subSite = (config.subSite as string) ?? "thursday";
    const siteConfig = SITE_CONFIGS[subSite];

    if (!siteConfig) {
      return {
        events: [],
        errors: [`BangkokHash: unknown subSite "${subSite}"`],
      };
    }

    const baseUrl = source.url || `https://www.bangkokhash.com/${siteConfig.subSite}/index.php`;
    const { kennelTag, defaultTime, hashClub, apiBase } = siteConfig;
    const fullmoonTag = subSite === "thursday" ? "bfmh3" : null;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let structureHash: string | undefined;
    let fetchDurationMs = 0;

    // 1. Fetch the main Joomla page for the next run article
    const page = await fetchHTMLPage(baseUrl);
    if (page.ok) {
      structureHash = page.structureHash;
      fetchDurationMs = page.fetchDurationMs;
      const nextRun = parseNextRunArticle(page.html, kennelTag, defaultTime, baseUrl);
      if (nextRun) {
        events.push(nextRun);
      }
    } else {
      errors.push(`Failed to fetch main page: ${page.result.errors[0]}`);
    }

    // 2. Fetch the PHP hareline API for future runs
    const apiUrl = `https://www.bangkokhash.com${apiBase}/Runs/05_Hareline/ViewHL_Server.php`;
    try {
      const apiStart = Date.now();
      const response = await safeFetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ usewamp: 0, hashclub: hashClub, viewoption: "0" }),
      });
      const apiDurationMs = Date.now() - apiStart;

      if (response.ok) {
        const json: unknown = await response.json();
        if (!Array.isArray(json) || json.length < 2 || typeof json[1] !== "string") {
          errors.push("Hareline API returned unexpected payload shape");
        } else {
        const harelineHtml = json[1];
        const apiEvents = parseHarelineApiHtml(harelineHtml, kennelTag, fullmoonTag, defaultTime, baseUrl);

        // Deduplicate: prefer the article's next-run event (richer data) over API data
        const existingDates = new Set(events.map((e) => `${e.date}|${e.kennelTag}`));
        for (const apiEvent of apiEvents) {
          const key = `${apiEvent.date}|${apiEvent.kennelTag}`;
          if (!existingDates.has(key)) {
            events.push(apiEvent);
            existingDates.add(key);
          }
        }

        fetchDurationMs += apiDurationMs;
        } // close else (valid json array)
      } else {
        errors.push(`Hareline API returned ${response.status}`);
      }
    } catch (err) {
      errors.push(`Hareline API fetch failed: ${err}`);
    }

    if (events.length === 0 && errors.length === 0) {
      errors.push(`BangkokHash ${subSite}: zero events parsed`);
    }

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        structureHash,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "joomla+php-api",
          subSite,
          hashClub,
          eventsParsed: events.length,
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
