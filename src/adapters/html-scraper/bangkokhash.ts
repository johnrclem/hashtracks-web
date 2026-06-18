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

// bangkokhash.com's WAF 403s the default "HashTracks-Scraper" UA (#2247/#2245),
// even via the residential proxy — it only allows a normal browser UA. Mirror
// the UA the enfield/norfolk proxied adapters use.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
  "when", "where",
  "google map", "google maps", "google map link", "google maps link",
]);

function isFieldLabel(val: string): boolean {
  const normalized = val.toLowerCase().replace(/:\s*$/, "").replaceAll(/\s+/g, " ").trim();
  return FIELD_LABELS.has(normalized);
}

/** Run-headline matcher ("Run #657", "Run 657"). No `g` flag → safe to reuse
 *  across `.test()` and `.exec()` (those are stateful only with `g`). The
 *  `\s*(?:#\s*)?` form avoids adjacent overlapping `\s*` quantifiers (ReDoS
 *  hygiene per the repo regex rule). */
const RUN_NUMBER_RE = /Run\s*(?:#\s*)?(\d+)/i;

/**
 * True when a "Run #NNN …" heading carries a trail name beyond the bare run
 * number (e.g. "Run #657, Suan Eden"). A bare "Run #519" returns false so the
 * caller falls back to the synthesized "<Kennel> Trail #N" instead of
 * persisting a run-number-only title — downstream consumers (e.g.
 * `calendar.ts` `buildTitle`) prepend the run number themselves and would
 * otherwise render it twice.
 */
function runHeadlineHasName(heading: string): boolean {
  const m = RUN_NUMBER_RE.exec(heading);
  if (!m) return false;
  const rest = heading.slice(0, m.index) + heading.slice(m.index + m[0].length);
  // Anything left after stripping separators is a trail name (Latin or Thai).
  return rest.replaceAll(/[\s,.:#@–—-]+/g, "").length > 0;
}

const HTTP_URL_RE = /^https?:\/\//i;

/**
 * Resolve the display location + maps URL from the candidate venue fields.
 * Prefers an explicit Location/Run Site/Station/Restaurant venue name; a
 * "Google Map" label on Run Site is dropped (it's not a venue). Some archive
 * pages put a maps URL directly in the `Location:` field — that's salvaged into
 * `locationUrl` rather than leaking as the venue label.
 */
function resolveLocation(
  locationRaw: string | undefined,
  runSite: string | undefined,
  station: string | undefined,
  restaurant: string | undefined,
  googleMap: string | undefined,
): { location: string | undefined; locationUrl: string | undefined } {
  const runSiteClean = runSite && !/^Google\s*Map/i.test(runSite) ? runSite : undefined;
  const candidate = locationRaw ?? runSiteClean ?? station ?? restaurant;
  const candidateIsUrl = !!candidate && HTTP_URL_RE.test(candidate);
  const location =
    candidate && !candidateIsUrl && candidate.length > 1 ? candidate : undefined;
  const mapUrl = googleMap && HTTP_URL_RE.test(googleMap) ? googleMap : undefined;
  const locationUrl = mapUrl ?? (candidateIsUrl ? candidate : undefined);
  return { location, locationUrl };
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
  // `.item-content` is the homepage Next Run article; `.com-content-article__body`
  // is the archive detail template. Same labeled fields, different wrapper class.
  const article = $(".item-content, .com-content-article__body").first();
  if (!article.length) return null;

  const text = decodeEntities(stripHtmlTags(article.html() ?? "", "\n"));

  // #846: the post-colon whitespace class MUST NOT include `\n`; a bare `\s*`
  // consumes the newline after an empty slot and the capture group then bleeds
  // into the next labelled line (e.g. "Restaurant:\nGooglemaps: ..." captures
  // "Googlemaps: ..."). `[^\S\n]*` is horizontal whitespace only; `[^\n]+` in
  // the capture ensures we never cross a line boundary either. Also anchor at
  // start-of-line so "Date:" can't match inside a word like "Update:".
  const grab = (label: string): string | undefined => {
    const re = new RegExp(String.raw`(?:^|\n)\s*${label}\s*:[^\S\n]*([^\n]+)`, "i");
    const m = re.exec(text);
    const val = m?.[1]?.trim();
    if (!val) return undefined;
    if (isFieldLabel(val)) return undefined;
    return val;
  };

  // Pre-2022 BFMH3 archive uses "When:"/"Where:" instead of "Date:"/"Station:".
  const dateRaw = grab("Date") ?? grab("When");
  if (!dateRaw) return null;
  // Reject dateless entries (e.g. "Friday, January 1st") — chrono would default
  // to the current year and silently produce the wrong date.
  if (!/\b(19|20)\d{2}\b/.test(dateRaw)) return null;
  const date = chronoParseDate(dateRaw, "en-GB");
  if (!date) return null;

  const startTimeRaw = grab("Start\\s*Time");
  const startTime = startTimeRaw && /^\d{1,2}:\d{2}$/.test(startTimeRaw)
    ? startTimeRaw
    : defaultTime;

  // #802: the labeled `Hares:` field sometimes carries filler like "On On Q"
  // instead of a real name. Mirror the API-path boilerplate guard so we don't
  // ship "On On Q" as a hare name. #2189: fold the co-hare into the hares field
  // (the source lists `Hare:` and `Cohare:` on separate lines) so it stops
  // being dropped. `normalizeHaresField` sorts + dedupes, keeping the joined
  // value stable for fingerprinting regardless of source line order.
  const hareParts = [grab("Hares?"), grab("Cohares?")].filter(
    (v): v is string => !!v && !HARE_BOILERPLATE_RE.test(v),
  );
  const hare = hareParts.length > 0 ? hareParts.join(", ") : undefined;
  const station = grab("Station");
  const runSite = grab("Run\\s*Site");
  const restaurant = grab("Restaurant");
  const locationRaw = grab("Location") ?? grab("Where");
  const googleMap = grab("Google\\s*(?:maps?|Map)\\s*(?:Link)?");

  // #2189: the source headlines each run "Run #NNN, <Location>" in the article
  // heading. Use it as the event title instead of letting merge.ts synthesize
  // "<Kennel> Trail #N". The homepage nests `.item-title` INSIDE the parsed
  // `.item-content` article, so scope the lookup there to avoid grabbing a
  // sibling article's title on multi-article pages; archive detail pages put
  // the headline in a page-level `.page-header` OUTSIDE
  // `.com-content-article__body`, so fall back to that (one per detail page).
  // cheerio `.text()` already decodes entities, so no decodeEntities needed.
  const headingRaw = (
    article.find(".item-title").first().text() ||
    $(".page-header h1, .page-header h2").first().text()
  )
    .replaceAll(/\s+/g, " ")
    .trim();
  const title = runHeadlineHasName(headingRaw) ? headingRaw : undefined;

  // Extract the run number. On the homepage the heading lives inside
  // `.item-content` so it's in `text` too; on archive detail pages the
  // "Run #NNN" is ONLY in the page-header heading — so check the heading
  // first, then the body.
  const runMatch = RUN_NUMBER_RE.exec(headingRaw) ?? RUN_NUMBER_RE.exec(text);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  const { location, locationUrl } = resolveLocation(
    locationRaw,
    runSite,
    station,
    restaurant,
    googleMap,
  );

  return {
    date,
    kennelTags: [kennelTag],
    runNumber,
    title,
    hares: normalizeHaresField(hare),
    location,
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
        kennelTags: [fullmoonTag ?? kennelTag],
        runNumber: Number.parseInt(fullmoonMatch[1], 10),
        startTime: "18:30",
        sourceUrl,
      });
      return;
    }

    // Regular run entry: "Run #519" followed by hare name
    const runMatch = RUN_NUMBER_RE.exec(infoText);
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
      kennelTags: [kennelTag],
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

    // bangkokhash.com 403s Vercel's datacenter IP (#2247 / #2245), so both the
    // main Joomla page and the PHP hareline API must egress through the NAS
    // residential proxy. The PHP API is a POST whose JSON body the proxy now
    // forwards (residential-proxy body support added alongside this fix).

    // 1. Fetch the main Joomla page for the next run article
    const page = await fetchHTMLPage(baseUrl, {
      useResidentialProxy: true,
      userAgent: BROWSER_UA,
    });
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
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "User-Agent": BROWSER_UA,
        },
        body: JSON.stringify({ usewamp: 0, hashclub: hashClub, viewoption: "0" }),
        useResidentialProxy: true,
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
        const existingDates = new Set(events.map((e) => `${e.date}|${e.kennelTags[0]}`));
        for (const apiEvent of apiEvents) {
          const key = `${apiEvent.date}|${apiEvent.kennelTags[0]}`;
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
