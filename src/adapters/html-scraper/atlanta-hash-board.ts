/**
 * Atlanta Hash Board phpBB Atom Feed Adapter
 *
 * Scrapes board.atlantahash.com for trail announcements via built-in phpBB Atom
 * feeds. Each subforum exposes a feed at:
 *   https://board.atlantahash.com/app.php/feed/forum/{forumId}
 *
 * Returns up to 15 entries per feed with full post content inline.
 * One HTTP request per kennel subforum (9 forums → 9 requests, fetched concurrently).
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails, ParseError } from "../types";
import { safeFetch } from "../safe-fetch";
import { parse12HourTime, validateSourceConfig, decodeEntities, stripHtmlTags, chronoParseDate, buildDateWindow } from "../utils";

// ── Config shape ──

interface ForumConfig {
  kennelTag: string;
  hashDay: string; // e.g. "Saturday", "Monday"
}

interface AtlantaHashBoardConfig {
  forums: Record<string, ForumConfig>;
}

// ── Atom feed types ──

export interface AtomEntry {
  title: string;
  published: string; // ISO 8601
  author: string;
  link: string;
  category: string; // subforum label
  content: string; // raw HTML
}

// ── Exported helpers (for unit testing) ──

/** Check if an Atom entry is a reply (not a new topic). */
export function isReplyEntry(title: string): boolean {
  // phpBB reply titles contain " • Re: " (bullet + "Re:")
  return /\s[•·]\s*Re:\s/i.test(title);
}

/** Parse Atom XML feed into structured entries. */
export function parseAtomFeed(xml: string): AtomEntry[] {
  const $ = cheerio.load(xml, { xml: true });
  const entries: AtomEntry[] = [];

  $("entry").each((_, el) => {
    const entry = $(el);
    const title = decodeEntities(entry.find("title").text().trim());
    const published = entry.find("published").text().trim();
    const author = decodeEntities(entry.find("author > name").text().trim());
    const link = entry.find("link").attr("href") ?? "";
    const category = decodeEntities(entry.find("category").attr("label") ?? "");
    const content = entry.find("content").text().trim();

    if (title && published) {
      entries.push({ title, published, author, link, category, content });
    }
  });

  return entries;
}

/**
 * Extract the event date from a phpBB post title and body.
 *
 * Priority:
 * 1. Explicit date in body (e.g., "When: 3/8/26", "Date: March 8, 2026")
 * 2. Date hint in title (e.g., "Saturday March 8th", "#1638 March 2nd")
 * 3. Infer from post date + kennel's regular hash day
 */
export function extractEventDate(
  title: string,
  body: string,
  postDate: string,
  hashDay: string,
): string | null {
  const refDate = new Date(postDate);
  if (isNaN(refDate.getTime())) return null;

  // 1. Check body for explicit date patterns
  const dateLinePatterns = [
    /(?:When|Date|Day)\s*:\s*(.+?)(?:\n|<br|$)/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
  ];
  for (const pattern of dateLinePatterns) {
    const match = pattern.exec(body);
    if (match) {
      const parsed = chronoParseDate(match[1], "en-US", refDate, { forwardDate: true });
      if (parsed) return parsed;
    }
  }

  // 2. Try parsing date from title
  // Strip kennel prefix like "Atlanta Hash (Saturdays) • " or "Moonlite #1638 "
  let titleClean = title.includes("•") ? title.split("•").pop()!.trim() : title;
  // Strip run numbers (e.g., "#1638") that confuse chrono-node
  titleClean = titleClean.replace(/#\d+/g, "").trim();
  const titleParsed = chronoParseDate(titleClean, "en-US", refDate, { forwardDate: true });
  if (titleParsed) return titleParsed;

  // 3. Infer: find the next occurrence of hashDay after the post date
  return inferDateFromHashDay(refDate, hashDay);
}

/** Find the next occurrence of a named day of week on or after the reference date. */
function inferDateFromHashDay(refDate: Date, hashDay: string): string | null {
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const target = dayMap[hashDay.toLowerCase()];
  if (target === undefined) return null;

  const d = new Date(refDate);
  const current = d.getUTCDay();
  const daysAhead = (target - current + 7) % 7 || 7; // at least 1 day ahead
  d.setUTCDate(d.getUTCDate() + daysAhead);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Extract structured event fields from pre-parsed content.
 * Accepts pre-computed plain text (to avoid re-parsing HTML) and Cheerio instance
 * for link extraction.
 */
export function extractEventFields(
  htmlContent: string,
  precomputedText?: string,
  preloaded$?: cheerio.CheerioAPI,
): Partial<RawEventData> {
  const fields: Partial<RawEventData> = {};
  const text = precomputedText ?? stripHtmlTags(htmlContent, "\n");

  // Hares
  const hareMatch = /Hares?\s*:\s*(.+?)(?:\n|$)/i.exec(text);
  if (hareMatch) {
    fields.hares = hareMatch[1].trim();
  }

  // Location — look for labeled fields first
  const locMatch = /(?:Start|Where|Location|Meeting|Meet)\s*:\s*(.+?)(?:\n|$)/i.exec(text);
  if (locMatch) {
    fields.location = locMatch[1].trim();
  }

  // Google Maps URL from HTML
  const $ = preloaded$ ?? cheerio.load(htmlContent);
  const mapsLink = $('a[href*="maps"]').first().attr("href")
    ?? $('a[href*="goo.gl"]').first().attr("href");
  if (mapsLink) {
    fields.locationUrl = mapsLink;
  }

  // Time
  const timeMatch = /(?:Time|Meet|Gather|Show)\s*[:\-]?\s*.*?(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/i.exec(text);
  if (timeMatch) {
    const parsed = parse12HourTime(timeMatch[1]);
    if (parsed) fields.startTime = parsed;
  }

  // Run number from text (e.g., "#1638" or "Run #123")
  const runMatch = /#(\d{2,})/.exec(text) ?? /Run\s*#?\s*(\d{2,})/i.exec(text);
  if (runMatch) {
    fields.runNumber = parseInt(runMatch[1], 10);
  }

  // Cost
  const costMatch = /\$(\d+)/i.exec(text);
  if (costMatch) {
    const desc = fields.description ? `${fields.description} | Hash Cash: $${costMatch[1]}` : `Hash Cash: $${costMatch[1]}`;
    fields.description = desc;
  }

  return fields;
}

/** Extract run number from Atom entry title. */
function extractRunNumberFromTitle(title: string): number | undefined {
  const match = /#(\d{2,})/.exec(title);
  return match ? parseInt(match[1], 10) : undefined;
}

/** Extract a clean trail name from the Atom title. */
function extractTitleName(title: string): string | undefined {
  // Titles look like: "Atlanta Hash (Saturdays) • Trail Name Here"
  const afterBullet = title.includes("•") ? title.split("•").pop()!.trim() : null;
  if (!afterBullet) return undefined;

  // Strip "Re: " prefix (shouldn't get here but just in case)
  const cleaned = afterBullet.replace(/^Re:\s*/i, "").trim();
  return cleaned || undefined;
}

// ── Adapter class ──

/** Fetch result from a single forum feed. */
interface ForumFetchResult {
  forumId: string;
  forumConfig: ForumConfig;
  xml?: string;
  error?: { url: string; status?: number; message: string };
}

export class AtlantaHashBoardAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<AtlantaHashBoardConfig>(
      source.config,
      "AtlantaHashBoardAdapter",
      { forums: "object" },
    );

    const baseUrl = source.url || "https://board.atlantahash.com";
    const { minDate, maxDate } = buildDateWindow(options?.days);

    const allEvents: RawEventData[] = [];
    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const parseErrors: ParseError[] = [];
    let totalEntries = 0;
    let skippedReplies = 0;

    // Fetch all forum feeds concurrently
    const forumEntries = Object.entries(config.forums);
    const feedResults = await Promise.allSettled(
      forumEntries.map(async ([forumId, forumConfig]): Promise<ForumFetchResult> => {
        const feedUrl = `${baseUrl}/app.php/feed/forum/${forumId}`;
        try {
          const response = await safeFetch(feedUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
          });
          if (!response.ok) {
            return {
              forumId, forumConfig,
              error: { url: feedUrl, status: response.status, message: `Forum ${forumId} (${forumConfig.kennelTag}): HTTP ${response.status}` },
            };
          }
          return { forumId, forumConfig, xml: await response.text() };
        } catch (err) {
          return {
            forumId, forumConfig,
            error: { url: feedUrl, message: `Forum ${forumId} (${forumConfig.kennelTag}): Fetch failed: ${err}` },
          };
        }
      }),
    );

    // Process results
    for (const settled of feedResults) {
      if (settled.status === "rejected") continue;
      const result = settled.value;

      if (result.error) {
        allErrors.push(result.error.message);
        errorDetails.fetch ??= [];
        errorDetails.fetch.push(result.error);
        continue;
      }
      if (!result.xml) continue;

      const entries = parseAtomFeed(result.xml);
      totalEntries += entries.length;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];

        // Skip replies — only original topic posts have event data
        if (isReplyEntry(entry.title)) {
          skippedReplies++;
          continue;
        }

        try {
          // Parse content once, reuse for date extraction and field extraction
          const textContent = stripHtmlTags(entry.content, "\n");
          const $content = cheerio.load(entry.content);

          const date = extractEventDate(
            entry.title,
            textContent,
            entry.published,
            result.forumConfig.hashDay,
          );

          if (!date) {
            parseErrors.push({
              row: i,
              section: `forum-${result.forumId}`,
              field: "date",
              error: "Could not extract event date",
              rawText: entry.title.slice(0, 200),
            });
            continue;
          }

          // Filter to date window
          const eventDate = new Date(date + "T12:00:00Z");
          if (eventDate < minDate || eventDate > maxDate) continue;

          const fields = extractEventFields(entry.content, textContent, $content);
          const titleRunNumber = extractRunNumberFromTitle(entry.title);
          const titleName = extractTitleName(entry.title);

          const event: RawEventData = {
            date,
            kennelTag: result.forumConfig.kennelTag,
            runNumber: fields.runNumber ?? titleRunNumber,
            title: titleName,
            hares: fields.hares,
            location: fields.location,
            locationUrl: fields.locationUrl,
            startTime: fields.startTime,
            sourceUrl: entry.link,
            description: fields.description,
          };

          allEvents.push(event);
        } catch (err) {
          parseErrors.push({
            row: i,
            section: `forum-${result.forumId}`,
            error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
            rawText: entry.title.slice(0, 200),
          });
        }
      }
    }

    if (parseErrors.length > 0) {
      errorDetails.parse = parseErrors;
    }

    return {
      events: allEvents,
      errors: allErrors,
      errorDetails: Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
      diagnosticContext: {
        forumsScraped: Object.keys(config.forums).length,
        totalEntries,
        skippedReplies,
        eventsParsed: allEvents.length,
        parseErrors: parseErrors.length,
      },
    };
  }
}
