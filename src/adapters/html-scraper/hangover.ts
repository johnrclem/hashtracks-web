import * as cheerio from "cheerio";
import type { AnyNode, ChildNode as DomHandlerChildNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { safeFetch } from "../safe-fetch";
import { chronoParseDate, parse12HourTime, googleMapsSearchUrl } from "../utils";

const DEFAULT_START_TIME = "10:15";
const TRAIL_MARKER = /H4 Trail\s*#\d+/i;

/**
 * Sibling-label boundaries the `Location:` value must stop at, even when the
 * source HTML collapses adjacent paragraph breaks or omits whitespace before
 * a new label (e.g. `Greenbelt)D'Erections:` — #1323).
 *
 * Each pattern is kept simple to keep SonarQube S5843 (alternation complexity)
 * comfortably under 20 — we scan all of them and take the earliest match
 * (`findFirstLocationStopIndex`).
 */
const HANGOVER_LOCATION_STOP_PATTERNS: readonly RegExp[] = [
  /Metro\s*Acce[s]+ibility\s*:/i,
  /Acce[s]+ibility\s*:/i,
  /Shiggy\s*Rating\s*:/i,
  /D.Erections?\s*:/i,
  /Trail\s*Length\s*:/i,
  /Pack\s*Meet\s*:/i,
  /Pre[\s-]?lube\s*:/i,
  /On[\s-]?After\s*:/i,
  /Hash\s*Cash\s*:/i,
  /Cost\s*:/i,
  /\bHares?\s*:/i,
  /Pack\s*Away\s/i,
  /Hare\s*Away\s/i,
  /Directions\s*:/i,
  /Parking\s*:/i,
  /Dog\s*Friendly\s*:/i,
  /Stroller\s*Friendly\s*:/i,
];

function findFirstLocationStopIndex(s: string): number {
  let min = -1;
  for (const re of HANGOVER_LOCATION_STOP_PATTERNS) {
    const m = re.exec(s);
    if (m && (min === -1 || m.index < min)) min = m.index;
  }
  return min;
}

/** Non-English country-locale tail from Google Maps widget exports
 *  (`Clarksburg, MD 20871, États-Unis` etc.). Lifted to module scope so
 *  `cleanHangoverLocation` doesn't recompile it per event.
 *
 *  NOSONAR S5852 — `\s*` prefix runs against literal locale alternatives
 *  (distinct first characters), `[\s-]?` is bounded; linear in practice. */
const HANGOVER_LOCALE_TAIL_RE =
  /,?\s*(?:États[\s-]?Unis|Estados Unidos|Vereinigte Staaten|Stati Uniti)\b[^\n]*$/i; // NOSONAR

/** Trailing whitespace / sentence punctuation stripped after a label cut.
 *  Deliberately does NOT include `)` — balanced parentheses like `(rear)`
 *  belong to the address and must survive the cut.
 *  NOSONAR S5852 — character-class quantifier at end-of-string is linear. */
const HANGOVER_TRAILING_PUNCT_RE = /[\s,;.!?]+$/; // NOSONAR

/**
 * Clean a captured location string: strip map-widget concatenation, non-English
 * locale leaks, and trailing labeled fields that survived HTML normalization
 * (#1323). Returns undefined when the cleaned string is too short to be a
 * usable address.
 */
export function cleanHangoverLocation(raw: string): string | undefined {
  let cleaned = raw;

  // Map widget vomit (#211): "<addr>**<dup-addr> · <dup-addr>, États-Unis**".
  // The `**` markdown-bold pair is the reliable widget signal; we cut there.
  // We don't cut on a bare `·` because it appears in legitimate addresses
  // (e.g. `Main St · Suite B`).
  const boldIdx = cleaned.indexOf("**");
  if (boldIdx >= 0) cleaned = cleaned.slice(0, boldIdx);

  cleaned = cleaned.replace(HANGOVER_LOCALE_TAIL_RE, "");

  // Truncate at the next labeled sibling-field. Strip trailing whitespace and
  // sentence punctuation so the cut produces a clean trailing token, BUT keep
  // closing parens (an address like `123 Main St (rear)` must survive).
  const stopIdx = findFirstLocationStopIndex(cleaned);
  if (stopIdx >= 0) {
    cleaned = cleaned.slice(0, stopIdx).replace(HANGOVER_TRAILING_PUNCT_RE, "");
  }

  // NOSONAR S5852 — anchored character-class quantifier at end-of-string; linear.
  cleaned = cleaned.replace(/[,\s·*]+$/, "").trim(); // NOSONAR
  if (cleaned.length < 3) return undefined;
  return cleaned;
}

/**
 * Ghost Content API key — this is a public read-only key embedded in every page
 * response of the DigitalPress site (in the ghost-portal script tag's data-key attribute).
 * If it rotates, find the new one by inspecting the page source for `data-key="..."`.
 */
const GHOST_CONTENT_API_KEY = "970e3b5bd552591e25f0610a97";

export function parseHangoverTitle(title: string): {
  runNumber?: number;
  trailName?: string;
} | null {
  const match = title.match(/^#(\d+)\s*[-–—]\s*(.+)$/);
  if (match) {
    return {
      runNumber: parseInt(match[1], 10),
      trailName: match[2].trim(),
    };
  }
  return null;
}

/**
 * Parse a date string using chrono-node.
 * Handles: "February 19, 2026", "January 29th, 2026", "Dec 25 2025"
 */
export function parseHangoverDate(text: string): string | null {
  return chronoParseDate(text, "en-US");
}

const parseTime = parse12HourTime;

/**
 * Extract the trail section from a Hangover H4 post's HTML body.
 *
 * H4 posts contain two sections separated by an `<hr>`:
 *   1. Prelubes section (events before the main trail)
 *   2. Trail section (the actual hash event details)
 *
 * We extract only the trail section to avoid prelube dates polluting
 * the date extraction with chrono-node fallback.
 *
 * Exported for testing.
 */
/** Collect text from consecutive siblings, preserving <br> as newlines. */
function collectSiblingText(
  $: cheerio.CheerioAPI,
  start: DomHandlerChildNode | undefined | null,
  direction: "forward" | "backward",
): string {
  const parts: string[] = [];
  let node = start;
  while (node) {
    const $n = $(node as AnyNode);
    $n.find?.("br").replaceWith("\n");
    const t = $n.text().trim();
    if (t) parts.push(t);
    node = direction === "forward" ? node.nextSibling : node.previousSibling;
  }
  if (direction === "backward") parts.reverse();
  return parts.join("\n");
}

export function extractTrailSection(html: string): string {
  const $ = cheerio.load(html);
  const hr = $("hr").first();

  if (hr.length === 0) {
    // No <hr> separator — return full text (older posts may not have prelubes)
    $("br").replaceWith("\n");
    return $.text().trim();
  }

  const beforeText = collectSiblingText($, hr.get(0)?.previousSibling, "backward");
  const afterText = collectSiblingText($, hr.get(0)?.nextSibling, "forward");

  // Return whichever section contains the trail header; if the trail marker
  // appears before <hr> (and NOT after), trail data is in the first section.
  if (TRAIL_MARKER.test(beforeText) && !TRAIL_MARKER.test(afterText)) {
    return beforeText;
  }

  // Default: after <hr> (prelubes → trail case)
  return afterText;
}

export function parseHangoverBody(text: string): {
  date?: string;
  hares?: string;
  location?: string;
  hashCash?: string;
  startTime?: string;
  trailType?: string;
  onAfter?: string;
  distances?: string;
} {
  const normalized = text
    .replace(/\r/g, "") // Normalize Windows newlines.
    .replace(/\s+/g, " ") // Collapse inconsistent spacing from extracted HTML text.
    // Put labeled fields on their own logical lines so downstream field regexes are reliable.
    .replace(/\s+(Date|When|Hare(?:\(s\)|s)?|Trail Start|Start|Location|Where|Hash Cash|Cost|Directions|Trail (?:Type|Length)|On[- ]?After|On On(?: Brunch)?|Metro Accessibility|D.Erections|Parking|Shiggy Rating|Dog Friendly|Stroller Friendly)\s*:/gi, "\n$1: ")
    // Normalize compact "Pack Away at" / "Hare Away at" variants into a line boundary.
    .replace(/\s+(Pack Away|Hares? Away)\s+at\s+/gi, "\n$1 at ")
    // Normalize distance labels so Eagle/Turkey/Penguin can be extracted independently.
    .replace(/\s+(Eagle|Turkey|Penguin)\s+/gi, "\n$1 ")
    .trim();

  const dateMatch = normalized.match(/(?:^|\n)\s*(?:Date|When)\s*:\s*(.+?)(?=\n|$)/im);
  let date = dateMatch ? parseHangoverDate(dateMatch[1].trim()) : undefined;

  // Fallback: use chrono-node on the full text when no Date:/When: label present.
  // Safe when text has been pre-filtered via extractTrailSection (no prelube dates).
  if (!date) {
    // Normalize "Thursday January 1st, 2026" → "Thursday, January 1st, 2026"
    // Without the comma, chrono may treat the day-of-week as a separate reference.
    const dayMonthNormalized = text.replace(
      /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(January|February|March|April|May|June|July|August|September|October|November|December)/gi,
      "$1, $2",
    );
    date = chronoParseDate(dayMonthNormalized, "en-US") ?? undefined;
  }

  const hareMatch = normalized.match(/(?:^|\n)\s*Hare(?:\(s\)|s)?\s*:\s*(.+?)(?=\n|$)/im);
  const locationMatch = normalized.match(/(?:^|\n)\s*(?:Trail Start|Start|Location|Where)\s*:\s*(.+?)(?=\n|$)/im);
  const cashMatch = normalized.match(/(?:^|\n)\s*Hash Cash\s*:\s*(.+?)(?=\n|$)/im);
  const timeMatch = normalized.match(/(?:Pack Away|Hares? Away)\s*(?:at|:)\s*(\d{1,2}:\d{2}\s*(?:am|pm))/im);
  const startTime = timeMatch ? parseTime(timeMatch[1]) : undefined;
  const trailTypeMatch = normalized.match(/(?:^|\n)\s*Trail Type\s*:\s*(.+?)(?=\n|$)/im);
  const onAfterMatch = normalized.match(/(?:^|\n)\s*(?:On[- ]?After|On On|On On Brunch)\s*:\s*(.+?)(?=\n|$)/im);

  const distanceParts: string[] = [];
  const eagleMatch = normalized.match(/Eagle\s*(?:~|:)?\s*([\d.]+)\s*mi/i);
  const turkeyMatch = normalized.match(/Turkey\s*(?:~|:)?\s*([\d.]+)\s*mi/i);
  const penguinMatch = normalized.match(/Penguin\s*(?:~|:)?\s*([\d.]+)\s*mi/i);
  if (eagleMatch) distanceParts.push(`Eagle: ~${eagleMatch[1]} mi`);
  if (turkeyMatch) distanceParts.push(`Turkey: ~${turkeyMatch[1]} mi`);
  if (penguinMatch) distanceParts.push(`Penguin: ~${penguinMatch[1]} mi`);

  const rawLocation = locationMatch ? locationMatch[1].trim() : undefined;
  const location = rawLocation ? cleanHangoverLocation(rawLocation) : undefined;

  return {
    date: date ?? undefined,
    hares: hareMatch ? hareMatch[1].trim() : undefined,
    location,
    hashCash: cashMatch ? cashMatch[1].trim() : undefined,
    startTime,
    trailType: trailTypeMatch ? trailTypeMatch[1].trim() : undefined,
    onAfter: onAfterMatch ? onAfterMatch[1].trim() : undefined,
    distances: distanceParts.length > 0 ? distanceParts.join(", ") : undefined,
  };
}

function resolveUrl(baseUrl: string, href: string | undefined): string {
  if (!href) return baseUrl;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function extractIsoDateFromArticle(article: cheerio.Cheerio<AnyNode>): string | undefined {
  const datetime = article.find("time[datetime]").first().attr("datetime");
  if (!datetime) return undefined;

  const isoMatch = datetime.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoMatch?.[1];
}

function shouldFetchDetailPage(fields: ReturnType<typeof parseHangoverBody>, eventDate?: string): boolean {
  if (!eventDate) return true;
  return !fields.location || !fields.hares || !fields.hashCash;
}

async function fetchDetailBody(postUrl: string, headers: HeadersInit): Promise<string | null> {
  try {
    const response = await safeFetch(postUrl, { headers });
    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);
    const content = $(".gh-content, .post-content, article .gh-content, article .post-content").first().text();
    return content || $.text();
  } catch {
    return null;
  }
}

/** Enrich body fields from a detail page when listing page data is incomplete. */
async function enrichFromDetailPage(
  bodyFields: ReturnType<typeof parseHangoverBody>,
  postUrl: string,
  headers: HeadersInit,
): Promise<{ bodyFields: ReturnType<typeof parseHangoverBody>; eventDate: string | undefined }> {
  const detailBodyText = await fetchDetailBody(postUrl, headers);
  if (!detailBodyText) {
    return { bodyFields, eventDate: bodyFields.date };
  }
  const detailFields = parseHangoverBody(detailBodyText);
  const merged = {
    date: detailFields.date ?? bodyFields.date,
    hares: detailFields.hares ?? bodyFields.hares,
    location: detailFields.location ?? bodyFields.location,
    hashCash: detailFields.hashCash ?? bodyFields.hashCash,
    startTime: detailFields.startTime ?? bodyFields.startTime,
    trailType: detailFields.trailType ?? bodyFields.trailType,
    onAfter: detailFields.onAfter ?? bodyFields.onAfter,
    distances: detailFields.distances ?? bodyFields.distances,
  };
  return { bodyFields: merged, eventDate: merged.date };
}

/** Build a description string from Hangover body fields. */
function buildHangoverDescription(fields: ReturnType<typeof parseHangoverBody>): string | undefined {
  const descParts: string[] = [];
  if (fields.trailType) descParts.push(`Trail Type: ${fields.trailType}`);
  if (fields.distances) descParts.push(fields.distances);
  if (fields.hashCash) descParts.push(`Hash Cash: ${fields.hashCash}`);
  if (fields.onAfter) descParts.push(`On After: ${fields.onAfter}`);
  return descParts.length > 0 ? descParts.join(" | ") : undefined;
}

/** Ghost Content API post shape (subset of fields we request). */
interface GhostPost {
  title: string;
  url: string;
  html: string;
  published_at: string;
}

export class HangoverAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://hangoverhash.digitalpress.blog/";

    // Try Ghost Content API first (structured JSON, no CSS selector fragility)
    const apiResult = await this.fetchViaGhostApi(baseUrl);
    if (apiResult.events.length > 0) return apiResult;

    // Fallback to HTML scraping (for when API is unavailable or returns no posts)
    return this.fetchViaHtmlScrape(baseUrl);
  }

  /** Fetch events via the Ghost Content API. */
  private async fetchViaGhostApi(baseUrl: string): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Build API URL from the site's base URL
    const apiBase = baseUrl.replace(/\/+$/, "");
    const apiUrl = `${apiBase}/ghost/api/content/posts/?key=${GHOST_CONTENT_API_KEY}&limit=20&fields=title,url,html,published_at`;

    const fetchStart = Date.now();
    let posts: GhostPost[];
    try {
      const response = await safeFetch(apiUrl, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return {
          events: [],
          errors: [`Ghost API HTTP ${response.status}`],
          errorDetails: { fetch: [{ url: apiUrl, status: response.status, message: `HTTP ${response.status}` }] },
          diagnosticContext: { fetchMethod: "ghost-api", apiStatus: response.status },
        };
      }
      const data = await response.json() as { posts?: GhostPost[] };
      posts = data.posts ?? [];
    } catch (err) {
      return {
        events: [],
        errors: [`Ghost API fetch failed: ${err}`],
        errorDetails: { fetch: [{ url: apiUrl, message: `${err}` }] },
        diagnosticContext: { fetchMethod: "ghost-api" },
      };
    }
    const fetchDurationMs = Date.now() - fetchStart;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const parsed = parseHangoverTitle(post.title);
      if (!parsed) continue; // Non-trail post (e.g., "About", "Hash Markings Guide")

      // Extract only the trail section (after <hr>) to avoid prelube dates
      const trailText = extractTrailSection(post.html);
      const bodyFields = parseHangoverBody(trailText);

      // Use parsed date, fall back to API published_at
      let eventDate = bodyFields.date;
      if (!eventDate && post.published_at) {
        const isoMatch = post.published_at.match(/^(\d{4}-\d{2}-\d{2})/);
        eventDate = isoMatch?.[1];
      }

      if (!eventDate) {
        errors.push(`No date for post: ${post.title}`);
        continue;
      }

      const locationUrl = bodyFields.location
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bodyFields.location)}`
        : undefined;

      events.push({
        date: eventDate,
        kennelTags: ["h4"],
        runNumber: parsed.runNumber,
        title: parsed.trailName,
        hares: bodyFields.hares,
        location: bodyFields.location,
        locationUrl,
        startTime: bodyFields.startTime || DEFAULT_START_TIME,
        sourceUrl: post.url,
        description: buildHangoverDescription(bodyFields),
      });
    }

    return {
      events,
      errors,
      errorDetails: errors.length > 0 ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "ghost-api",
        postsFound: posts.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }

  /** Fetch events via HTML scraping (fallback path). */
  private async fetchViaHtmlScrape(baseUrl: string): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const requestHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };

    let html: string;
    try {
      const response = await safeFetch(baseUrl, { headers: requestHeaders });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [{ url: baseUrl, status: response.status, message }];
        return { events: [], errors: [message], errorDetails };
      }
      html = await response.text();
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [{ url: baseUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }

    const structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);
    const articles = $("article.gh-card, article.post, .post-card, article").toArray();

    for (let i = 0; i < articles.length; i++) {
      const article = $(articles[i]);

      const titleEl = article.find("h2 a, h3 a, .gh-card-title, .post-card-title, .gh-article-title").first();
      let titleText = titleEl.text().trim();
      if (!titleText) titleText = article.find("h2, h3, h1").first().text().trim();
      const postHref = titleEl.attr("href") || article.find("a").first().attr("href");
      const postUrl = resolveUrl(baseUrl, postHref);

      if (!titleText) continue;
      const parsed = parseHangoverTitle(titleText);
      if (!parsed) continue;

      const bodyEl = article.find(".gh-content, .post-content, .gh-card-excerpt, .post-card-excerpt").first();
      let bodyFields = parseHangoverBody(bodyEl.text() || "");
      let eventDate = bodyFields.date ?? extractIsoDateFromArticle(article);

      if (shouldFetchDetailPage(bodyFields, eventDate)) {
        const enriched = await enrichFromDetailPage(bodyFields, postUrl, requestHeaders);
        bodyFields = enriched.bodyFields;
        eventDate = enriched.eventDate ?? eventDate;
      }

      if (!eventDate) continue;

      const locationUrl = bodyFields.location
        ? googleMapsSearchUrl(bodyFields.location)
        : undefined;

      events.push({
        date: eventDate,
        kennelTags: ["h4"],
        runNumber: parsed.runNumber,
        title: parsed.trailName,
        hares: bodyFields.hares,
        location: bodyFields.location,
        locationUrl,
        startTime: bodyFields.startTime || DEFAULT_START_TIME,
        sourceUrl: postUrl,
        description: buildHangoverDescription(bodyFields),
      });
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: (errorDetails.fetch?.length ?? 0) > 0 ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "html-scrape",
        articlesFound: articles.length,
        eventsParsed: events.length,
      },
    };
  }
}
