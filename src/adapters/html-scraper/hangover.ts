import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";

const DEFAULT_START_TIME = "10:15";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

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

export function parseHangoverDate(text: string): string | null {
  const match = text.match(/(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (!match) return null;

  const monthNum = MONTHS[match[1].toLowerCase()];
  if (!monthNum) return null;

  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (day < 1 || day > 31) return null;

  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseTime(text: string): string | undefined {
  const match = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return undefined;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const ampm = match[3].toLowerCase();

  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
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
    .replace(/\s+(Date|When|Hare(?:\(s\)|s)?|Trail Start|Start|Location|Where|Hash Cash|Trail Type|On[- ]?After|On On(?: Brunch)?)\s*:/gi, "\n$1: ")
    // Normalize compact "Pack Away at" / "Hare Away at" variants into a line boundary.
    .replace(/\s+(Pack Away|Hares? Away)\s+at\s+/gi, "\n$1 at ")
    // Normalize distance labels so Eagle/Turkey/Penguin can be extracted independently.
    .replace(/\s+(Eagle|Turkey|Penguin)\s+/gi, "\n$1 ")
    .trim();

  const dateMatch = normalized.match(/(?:^|\n)\s*(?:Date|When)\s*:\s*(.+?)(?=\n|$)/im);
  const date = dateMatch ? parseHangoverDate(dateMatch[1].trim()) : undefined;

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

  return {
    date: date ?? undefined,
    hares: hareMatch ? hareMatch[1].trim() : undefined,
    location: locationMatch ? locationMatch[1].trim() : undefined,
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
    const response = await fetch(postUrl, { headers });
    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);
    const content = $(".gh-content, .post-content, article .gh-content, article .post-content").first().text();
    return content || $.text();
  } catch {
    return null;
  }
}

export class HangoverAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://hangoverhash.digitalpress.blog/";

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
      const response = await fetch(baseUrl, {
        headers: requestHeaders,
      });
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
      if (!titleText) {
        titleText = article.find("h2, h3, h1").first().text().trim();
      }
      const postHref = titleEl.attr("href") || article.find("a").first().attr("href");
      const postUrl = resolveUrl(baseUrl, postHref);

      if (!titleText) continue;

      const parsed = parseHangoverTitle(titleText);
      if (!parsed) continue;

      const bodyEl = article.find(".gh-content, .post-content, .gh-card-excerpt, .post-card-excerpt").first();
      const listingBodyText = bodyEl.text() || "";
      let bodyFields = parseHangoverBody(listingBodyText);

      let eventDate = bodyFields.date ?? extractIsoDateFromArticle(article);

      if (shouldFetchDetailPage(bodyFields, eventDate)) {
        const detailBodyText = await fetchDetailBody(postUrl, requestHeaders);
        if (detailBodyText) {
          const detailFields = parseHangoverBody(detailBodyText);
          bodyFields = {
            date: detailFields.date ?? bodyFields.date,
            hares: detailFields.hares ?? bodyFields.hares,
            location: detailFields.location ?? bodyFields.location,
            hashCash: detailFields.hashCash ?? bodyFields.hashCash,
            startTime: detailFields.startTime ?? bodyFields.startTime,
            trailType: detailFields.trailType ?? bodyFields.trailType,
            onAfter: detailFields.onAfter ?? bodyFields.onAfter,
            distances: detailFields.distances ?? bodyFields.distances,
          };
          eventDate = bodyFields.date ?? eventDate;
        }
      }

      if (!eventDate) continue;

      const descParts: string[] = [];
      if (bodyFields.trailType) descParts.push(`Trail Type: ${bodyFields.trailType}`);
      if (bodyFields.distances) descParts.push(bodyFields.distances);
      if (bodyFields.hashCash) descParts.push(`Hash Cash: ${bodyFields.hashCash}`);
      if (bodyFields.onAfter) descParts.push(`On After: ${bodyFields.onAfter}`);

      let locationUrl: string | undefined;
      if (bodyFields.location) {
        locationUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bodyFields.location)}`;
      }

      events.push({
        date: eventDate,
        kennelTag: "H4",
        runNumber: parsed.runNumber,
        title: parsed.trailName,
        hares: bodyFields.hares,
        location: bodyFields.location,
        locationUrl,
        startTime: bodyFields.startTime || DEFAULT_START_TIME,
        sourceUrl: postUrl,
        description: descParts.length > 0 ? descParts.join(" | ") : undefined,
      });
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: (errorDetails.fetch?.length ?? 0) > 0 ? errorDetails : undefined,
      diagnosticContext: {
        articlesFound: articles.length,
        eventsParsed: events.length,
      },
    };
  }
}
