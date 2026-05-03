import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import {
  buildUrlVariantCandidates,
  chronoParseDate,
  decodeEntities,
  formatAmPmTime,
  isPlaceholder,
} from "../utils";
import { safeFetch } from "../safe-fetch";

const USE_RESIDENTIAL_PROXY = true;

/**
 * Infer the year for a month/day when the source omits the year.
 * Picks the year that places the date closest to `now` (within ±6 months).
 *   - If the candidate date with the current year is >6 months in the future → previous year
 *   - If it's >6 months in the past → next year
 *   - Otherwise → current year
 *
 * Exported for testing.
 */
export function inferYear(
  monthNum: number,
  day: number,
  now: Date = new Date(),
): number {
  const currentYear = now.getFullYear();
  const candidate = new Date(Date.UTC(currentYear, monthNum - 1, day));
  const diffMs = candidate.getTime() - now.getTime();
  const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

  if (diffMs > SIX_MONTHS_MS) return currentYear - 1;
  if (diffMs < -SIX_MONTHS_MS) return currentYear + 1;
  return currentYear;
}

/**
 * Parse a date from Enfield Hash text using chrono-node.
 *
 * Handles all formats:
 *   "Wednesday 18th March 2026", "18th March 2026", "March 18, 2026",
 *   "18/03/2026", "Wed 25 February" (year inferred via ±6 month window)
 */
export function parseEnfieldDate(text: string, now?: Date): string | null {
  const result = chronoParseDate(text, "en-GB", now);
  if (!result || !now) return result;

  // If chrono parsed a year from the text (explicit year), use as-is.
  // If year was inferred (year-less input), apply ±6 month window logic.
  const parsed = result.split("-").map(Number);
  const month = parsed[1];
  const day = parsed[2];
  const inferredYear = inferYear(month, day, now);

  // Check if the text contains an explicit year — if so, trust chrono's result.
  // Matches: 4-digit year ("2026"), or slash-form with year ("25/02/26", "25/02/2026")
  if (/\b\d{4}\b/.test(text) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text)) return result;

  // Year-less date: override with ±6 month inference
  return `${inferredYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse labeled fields from an Enfield Hash blog post body.
 *
 * Handles structured posts with labels:
 *   "Date: Wednesday 18th March 2026"
 *   "Pub: The King's Head"
 *   "Station: Enfield Chase"
 *   "Hare: Name"
 *
 * Also handles unstructured prose (new site format):
 *   "Rose and Crown pub, Clay Hill, Enfield. P trail from Gordon Hill station."
 */
export function parseEnfieldBody(text: string, now?: Date): {
  date?: string;
  hares?: string;
  location?: string;
  station?: string;
} {
  // Stop pattern: only match label words when followed by a colon (i.e., the start
  // of a new labeled field), not bare words inside values like "The Station Hotel"
  const labelBoundary = "(?:Date|When|Pub|Where|Location|Station|Hares?|Start|Time|Meet)\\s*:";
  const stopPattern = `(?=${labelBoundary}|\\n|$)`;

  // Date from "Date:" or "When:" label
  const dateMatch = text.match(new RegExp(`(?:Date|When):\\s*(.+?)${stopPattern}`, "i"));
  const date = dateMatch ? parseEnfieldDate(dateMatch[1].trim(), now) : parseEnfieldDate(text, now);

  // Hare from "Hare:" or "Hares:" label
  const hareMatch = text.match(new RegExp(`Hares?:\\s*(.+?)${stopPattern}`, "i"));
  let hares: string | undefined;
  if (hareMatch) {
    const haresText = hareMatch[1].trim();
    if (!/tba|tbd|tbc|needed|required/i.test(haresText)) {
      hares = haresText;
    }
  }

  // Location from "Pub:" or "Where:" or "Location:" label
  const pubMatch = text.match(new RegExp(`(?:Pub|Where|Location|Venue):\\s*(.+?)${stopPattern}`, "i"));
  let location = pubMatch ? pubMatch[1].trim() : undefined;

  // Station from "Station:" label
  const stationMatch = text.match(new RegExp(`Station:\\s*(.+?)${stopPattern}`, "i"));
  let station = stationMatch ? stationMatch[1].trim() : undefined;

  // Fallback: extract station from prose like "P trail from Gordon Hill station"
  if (!station) {
    const proseStation = text.match(/trail from\s+(.+?)\s+station/i);
    if (proseStation) {
      station = proseStation[1].trim();
    }
  }

  // Fallback: extract location from prose — capture address after "running from",
  // stopping at period, or non-address phrases like ", with" / ", for"
  if (!location) {
    const proseLocation = text.match(/running from\s+(.+?)(?:\.\s|,\s*(?:with|for|and\s+(?:a|the))\b|$)/i);
    if (proseLocation) {
      location = proseLocation[1].replace(/,\s*$/, "").trim();
    }
  }

  // Fallback: "Meet at The Old Wheatsheaf, opposite Enfield Chase station"
  if (!location) {
    const meetAt = text.match(/[Mm]eet\s+at\s+(.+?)(?:\.|$)/i);
    if (meetAt) location = meetAt[1].trim();
  }

  // Fallback: "Rose and Crown pub, Clay Hill, Enfield"
  if (!location) {
    const pubWord = text.match(/([A-Z][^.]+?\bpub\b[^.]*)/i);
    if (pubWord) location = pubWord[1].trim();
  }

  if (location && isPlaceholder(location)) location = undefined;

  // Geocode disambiguation: an "Enfield" village in Lincolnshire otherwise
  // outranks the London borough — ensure "London" appears so the geocoder
  // lands in the right place. Trade-off: an away-weekend trail run from
  // outside London (e.g. Hatfield) would be wrongly coerced too. EH3 has no
  // such events today; revisit if joint-with-other-kennel runs become regular.
  if (location) {
    const hasEnfield = /\benfield\b/i.test(location);
    const hasLondon = /\blondon\b/i.test(location);
    if (!hasEnfield && !hasLondon) {
      location = `${location}, Enfield, London`;
    } else if (!hasLondon) {
      location = `${location}, London`;
    }
  }

  return {
    date: date ?? undefined,
    hares,
    location: location || undefined,
    station: station && !isPlaceholder(station) ? station : undefined,
  };
}

/**
 * Range-validated wrapper around `formatAmPmTime`. Regex `\d{1,2}` admits
 * "13"–"99", `\d{2}` admits "60"–"99" — reject those rather than emit
 * `25:99` style garbage as a startTime. Minute group is optional ("7pm").
 */
function timeFromMatch(m: RegExpMatchArray): string | undefined {
  const h = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  if (h < 1 || h > 12 || minute > 59) return undefined;
  return formatAmPmTime(h, minute, m[3]);
}

/**
 * Scan an Enfield post body for an explicit per-event start-time override.
 * Returns "HH:MM" (24h) when found, otherwise undefined → caller keeps the
 * kennel default.
 *
 * Order of preference, most explicit to least:
 *   1. "for [a] HH(:MM)?(am|pm) start|run|trail"  ("for 7:15pm run")
 *   2. "HH(:MM)?(am|pm) start"                     ("7:30pm start")
 *   3. with "EARLY START" present: first time token after that phrase
 *      ("EARLY START meet 7pm" → 7pm when no later "for X start" exists)
 */
export function extractStartTimeOverride(text: string): string | undefined {
  const forMatch = text.match(
    /\bfor\s+(?:a\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:start|run|trail)\b/i,
  );
  if (forMatch) {
    const t = timeFromMatch(forMatch);
    if (t) return t;
  }

  const startMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+start\b/i);
  if (startMatch) {
    const t = timeFromMatch(startMatch);
    if (t) return t;
  }

  if (/early\s+start/i.test(text)) {
    const earlyMatch = text.match(
      /early\s+start[\s\S]*?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
    );
    if (earlyMatch) {
      const t = timeFromMatch(earlyMatch);
      if (t) return t;
    }
  }

  return undefined;
}

/**
 * Process a single post into a RawEventData.
 * Returns null if the post cannot be parsed (e.g., missing date).
 */
function processPost(
  titleText: string,
  bodyText: string,
  sourceUrl: string,
  index: number,
  errors: string[],
  errorDetails: ErrorDetails,
  now?: Date,
): RawEventData | null {
  // Prefer title date — titles are structured ("Run 318 - Wed 25 February")
  // while body prose can contain ambiguous day names ("THE FOURTH WEDNESDAY")
  // that chrono-node misinterprets as relative dates.
  // Only use title date when it includes a specific day (not just "March 2026").
  const titleDate = parseEnfieldDate(titleText, now);
  const bodyFields = parseEnfieldBody(bodyText, now);
  const titleHasDay = titleDate && /\b\d{1,2}\s+\w+|\w+\s+\d{1,2}\b/.test(titleText);
  const date = (titleHasDay ? titleDate : null) ?? bodyFields.date ?? titleDate;

  if (!date) {
    if (bodyText.trim().length > 0) {
      errors.push(
        `Could not parse date from post: ${titleText || "(untitled)"}`,
      );
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        {
          row: index,
          section: "post",
          field: "date",
          error: `No date found in post: ${titleText || "(untitled)"}`,
          rawText: `Title: ${titleText}\n\n${bodyText}`.slice(0, 2000),
          partialData: { kennelTags: ["eh3"], title: titleText || undefined },
        },
      ];
    }
    return null;
  }

  // Preserve body prose — joint-run / early-start / change-of-date callouts
  // live only here.
  const description = bodyText.trim() || undefined;

  // Per-event override; falls back to EH3's 3rd-Wednesday 7:30 PM default.
  const startTime = extractStartTimeOverride(bodyText) ?? "19:30";

  return {
    date,
    kennelTags: ["eh3"],
    title: titleText || undefined,
    hares: bodyFields.hares,
    location: bodyFields.location,
    startTime,
    sourceUrl,
    description,
  };
}

/**
 * Enfield Hash House Harriers (EH3) Website Scraper
 *
 * Scrapes enfieldhash.org for run announcements. The site hosts a simple
 * HTML page with .paragraph-box containers, each containing an <h1> title
 * (with run number and date) and <p> paragraphs with details.
 *
 * Monthly kennel (3rd Wednesday, 7:30 PM).
 */
export class EnfieldHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.enfieldhash.org/";
    // Site is a client-side SPA — the shell has an empty #content div.
    // Content is loaded via fetch("home.html"), so we fetch that directly.
    const contentUrl = new URL(
      "home.html",
      baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
    ).toString();
    return this.fetchViaHtmlScrape(contentUrl);
  }

  /** Try fetching HTML from URL variants with browser-like headers. */
  private async tryFetchWithUrlVariants(
    baseUrl: string,
    errorDetails: ErrorDetails,
  ): Promise<{ html: string; fetchUrl: string } | null> {
    const requestHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "max-age=0",
      "Sec-Ch-Ua": '"Chromium";v="124", "Not(A:Brand";v="24", "Google Chrome";v="124"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    };

    const candidateUrls = buildUrlVariantCandidates(baseUrl);

    for (const candidateUrl of candidateUrls) {
      try {
        const response = await safeFetch(candidateUrl, { headers: requestHeaders, useResidentialProxy: USE_RESIDENTIAL_PROXY });

        if (response.ok) {
          const html = await response.text();
          return { html, fetchUrl: candidateUrl };
        }

        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url: candidateUrl, status: response.status, message },
        ];

        // Only continue trying variants on 403/404 (host/protocol mismatch)
        if (response.status !== 403 && response.status !== 404) {
          return null;
        }
      } catch (err) {
        const message = `Fetch failed: ${err}`;
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url: candidateUrl, message },
        ];
      }
    }

    return null;
  }

  private async fetchViaHtmlScrape(baseUrl: string): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const now = new Date();

    const fetchStart = Date.now();
    const fetchResult = await this.tryFetchWithUrlVariants(baseUrl, errorDetails);

    if (!fetchResult) {
      const last = errorDetails.fetch?.[errorDetails.fetch.length - 1];
      const fallbackMessage = last?.message ?? "Fetch failed";
      return {
        events: [],
        errors: [fallbackMessage],
        errorDetails,
        diagnosticContext: { fetchMethod: "html-scrape" },
      };
    }

    const { html, fetchUrl } = fetchResult;
    const fetchDurationMs = Date.now() - fetchStart;

    const structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);

    // New site structure: .paragraph-box containers with <h1> title
    let posts = $(".paragraph-box").toArray();

    // Fallback: try legacy Blogger selectors in case the site reverts
    if (posts.length === 0) {
      posts = $(".post-outer").toArray();
    }
    if (posts.length === 0) {
      posts = $(".post, .blog-post").toArray();
    }

    for (let i = 0; i < posts.length; i++) {
      const post = $(posts[i]);

      // New format: <h1> inside .paragraph-box
      let titleText = decodeEntities(post.find("h1").first().text().trim());
      let postUrl = fetchUrl;

      // Legacy fallback: Blogger title links
      if (!titleText) {
        const titleEl = post
          .find(".post-title a, .entry-title a, h3.post-title a")
          .first();
        titleText = titleEl.text().trim() ||
          post.find(".post-title, .entry-title, h3").first().text().trim();
        postUrl = titleEl.attr("href") || fetchUrl;
      }

      // Body: combine <p> elements (new format) or find .post-body (legacy)
      const paragraphs = post.find("p").toArray();
      let bodyText: string;
      if (paragraphs.length > 0) {
        bodyText = paragraphs
          .map((p) => $(p).text().trim())
          .filter((t) => t.length > 0 && !/^on\s*on$/i.test(t))
          .join("\n");
      } else {
        const bodyEl = post.find(".post-body, .entry-content").first();
        bodyText = bodyEl.text() || "";
      }

      const event = processPost(
        titleText,
        bodyText,
        postUrl,
        i,
        errors,
        errorDetails,
        now,
      );
      if (event) events.push(event);
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "html-scrape",
        postsFound: posts.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
