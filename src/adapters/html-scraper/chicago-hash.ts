import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
} from "../types";
import { chronoParseDate, googleMapsSearchUrl } from "../utils";
export { parseRunNumber, parseDateFromDatetime, parseTimeString } from "./chicago-shared";
import { parseRunNumber, parseDateFromDatetime, parseTimeString, fetchWordPressBlogEvents } from "./chicago-shared";

const mapsUrl = googleMapsSearchUrl;

/**
 * Parse a date from text using chrono-node.
 * Handles: "February 15, 2026", "Feb 15, 2026"
 * Requires an explicit 4-digit year in the text.
 */
export function parseDateFromText(text: string): string | null {
  if (!/\b\d{4}\b/.test(text)) return null;
  return chronoParseDate(text, "en-US");
}

// Strip leading dash/bullet artifacts (#1467 — CH3 Memorial Day post used
// `<strong>Hares –</strong>` and `Hares: -` formats that leaked the
// separator into the captured value). Safe for all CH3 fields: no
// legitimate value starts with a hyphen, dash, or bullet character.
const LEADING_BULLET_RE = /^[\s\-–—•*]+/;

// Label set + terminator inlined as regex literals to avoid Codacy's
// `security/detect-non-literal-regexp` / `security-node/non-literal-reg-expr`
// findings on `new RegExp(<expression>)` — these only fire on the constructor
// form. The terminator recognizes both `:` and dash separators so a dash-
// separated Hares value can't overrun into a subsequent dash-separated label
// (codex review follow-up). `[\s\S]+?` is used in place of `.+?` because the
// tsconfig target (ES2017) predates the `s` (dotall) regex flag.
// S5852 false-positive — the `\s*` adjacent to a literal-alternation lookahead
// is flagged by Sonar's ReDoS heuristic, but the engine doesn't backtrack
// into a non-capturing lookahead anchored to a finite label set. Inputs come
// from a small WordPress excerpt (<2KB), not user-supplied text.
const CH3_VENUE_RE = /(?:Venue|Where):\s*([\s\S]+?)(?=(?:Venue|Hares?|Event|Hash Cash|Transit|Shag Wagon|When|Where|Time)\s*[:–—\-]|$)/i; // NOSONAR S5852
const CH3_HARES_RE = /Hares?\s*[:–—\-]\s*([\s\S]+?)(?=(?:Venue|Hares?|Event|Hash Cash|Transit|Shag Wagon|When|Where|Time)\s*[:–—\-]|$)/i; // NOSONAR S5852
const CH3_CASH_RE = /Hash Cash:\s*([\s\S]+?)(?=(?:Venue|Hares?|Event|Hash Cash|Transit|Shag Wagon|When|Where|Time)\s*[:–—\-]|$)/i; // NOSONAR S5852
const CH3_EVENT_RE = /Event:\s*([\s\S]+?)(?=(?:Venue|Hares?|Event|Hash Cash|Transit|Shag Wagon|When|Where|Time)\s*[:–—\-]|$)/i; // NOSONAR S5852
const CH3_TIME_RE = /(?:When|Time):\s*([\s\S]+?)(?=(?:Venue|Hares?|Event|Hash Cash|Transit|Shag Wagon|When|Where|Time)\s*[:–—\-]|$)/i; // NOSONAR S5852

function cleanFieldValue(raw: string): string | undefined {
  const cleaned = raw.trim().replace(/\s+/g, " ").replace(LEADING_BULLET_RE, "").trim();
  return cleaned || undefined;
}

/**
 * Parse the body content of a CH3 WordPress post to extract labeled fields.
 * Fields are delimited by labels like "Venue:", "Hare:", "Hash Cash:", etc.
 * WordPress Gutenberg text runs together — use lookahead to split on labels.
 */
export function parseBodyFields(bodyText: string): {
  hares?: string;
  location?: string;
  hashCash?: string;
  eventName?: string;
  startTime?: string;
} {
  const result: {
    hares?: string;
    location?: string;
    hashCash?: string;
    eventName?: string;
    startTime?: string;
  } = {};

  const venueMatch = CH3_VENUE_RE.exec(bodyText);
  if (venueMatch) result.location = cleanFieldValue(venueMatch[1]);

  // `Hares –` (no colon) is accepted alongside `Hares:` — Memorial Day post
  // shape (#1467). `cleanFieldValue` strips any residual leading bullet.
  const hareMatch = CH3_HARES_RE.exec(bodyText);
  if (hareMatch) result.hares = cleanFieldValue(hareMatch[1]);

  const cashMatch = CH3_CASH_RE.exec(bodyText);
  if (cashMatch) result.hashCash = cleanFieldValue(cashMatch[1]);

  const eventMatch = CH3_EVENT_RE.exec(bodyText);
  if (eventMatch) result.eventName = cleanFieldValue(eventMatch[1]);

  const timeMatch = CH3_TIME_RE.exec(bodyText);
  if (timeMatch) {
    const parsed = parseTimeString(timeMatch[1].trim());
    if (parsed) result.startTime = parsed;
  }

  return result;
}

/**
 * Parse a single WordPress article element into RawEventData.
 */
export function parseArticle(
  $: CheerioAPI,
  $article: Cheerio<AnyNode>,
  baseUrl: string,
): RawEventData | null {
  // Title: look for entry-title heading with link
  const titleEl = $article.find(".entry-title a, .entry-title, h2 a, h2").first();
  const titleText = titleEl.text().trim();
  if (!titleText) return null;

  // Run number from title
  const runNumber = parseRunNumber(titleText) ?? undefined;

  // Date: prefer <time datetime="..."> attribute, fall back to text
  let date: string | null = null;
  const timeEl = $article.find("time[datetime]").first();
  if (timeEl.length) {
    const datetime = timeEl.attr("datetime") ?? "";
    date = parseDateFromDatetime(datetime);
  }
  if (!date) {
    // Fall back to date text from entry-date or time element text
    const dateText = $article.find(".entry-date, time, .posted-on").first().text().trim();
    if (dateText) {
      date = parseDateFromText(dateText);
    }
  }
  if (!date) return null;

  // Source URL from title link or article permalink
  const titleHref = titleEl.attr("href") ?? titleEl.find("a").attr("href");
  const sourceUrl = titleHref
    ? new URL(titleHref, baseUrl).toString()
    : baseUrl;

  // Parse body content for labeled fields
  const bodyText = $article.find(".entry-content, .post-content, .entry-summary").text();
  const fields = parseBodyFields(bodyText);

  // Look for Google Maps links in the article
  let locationUrl: string | undefined;
  $article.find("a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    if (/maps\./i.test(href) || /google\.\w+\/maps/i.test(href)) {
      locationUrl = href;
      return false; // break
    }
  });
  if (!locationUrl && fields.location) {
    locationUrl = mapsUrl(fields.location);
  }

  // Build description from supplementary fields
  const descParts: string[] = [];
  if (fields.eventName) descParts.push(fields.eventName);
  if (fields.hashCash) descParts.push(`Hash Cash: ${fields.hashCash}`);
  const description = descParts.length > 0 ? descParts.join(". ") : undefined;

  return {
    date,
    kennelTags: ["ch3"],
    runNumber,
    title: titleText,
    hares: fields.hares,
    location: fields.location,
    locationUrl,
    startTime: fields.startTime,
    sourceUrl,
    description,
  };
}

/**
 * Chicago Hash (CH3) WordPress Blog Scraper
 *
 * Scrapes chicagohash.org for hash run details. The site is a WordPress blog
 * where each run is posted as an <article> with structured labels in the body
 * (Venue, Hare, Event, Hash Cash, Transit, Shag Wagon).
 * Supports pagination via WordPress /page/N/ URLs.
 */
export class ChicagoHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    return fetchWordPressBlogEvents(source, parseArticle, "https://chicagohash.org/");
  }
}
