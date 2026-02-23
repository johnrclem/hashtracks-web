import * as cheerio from "cheerio";
import type { RawEventData } from "../types";

const BASE_URL = "https://hashrego.com";

/** Entry from the events index table */
export interface IndexEntry {
  slug: string; // URL slug: "ewh3-1506-huaynaputinas-revenge-february-19-2026-"
  kennelSlug: string; // "EWH3", "BFMH3", etc.
  title: string;
  startDate: string; // "MM/DD/YY"
  startTime: string; // "HH:MM AM/PM" or empty
  type: string; // "Trail", "Hash Weekend", "Hash Campout"
  cost: string; // "$10", "$85", etc.
}

/** Parsed event detail from a single event page */
export interface ParsedEvent {
  title: string;
  dates: string[]; // YYYY-MM-DD format — 1 for single-day, 2+ for multi-day
  startTimes: string[]; // HH:MM per date (or empty array)
  location?: string;
  locationAddress?: string;
  locationUrl?: string;
  hares?: string;
  description?: string;
  cost?: string;
  kennelSlug: string;
  isMultiDay: boolean;
}

/**
 * Parse the events index table from hashrego.com/events.
 * Table structure: #eventListTable > tbody > tr > td
 * Columns: Event Name | Type | Host Kennel | Start Date | Cost | Rego'd Hashers
 */
export function parseEventsIndex(html: string): IndexEntry[] {
  const $ = cheerio.load(html);
  const entries: IndexEntry[] = [];

  $("#eventListTable tbody tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return;

    // Col 0: Event name with link to /events/{slug}
    const eventLink = $(cells[0]).find("a");
    const href = eventLink.attr("href") || "";
    const slugMatch = href.match(/^\/events\/([^/]+)/);
    if (!slugMatch) return;
    const slug = slugMatch[1];
    const title = eventLink.text().trim();

    // Col 1: Type (Trail, Hash Weekend, etc.)
    const type = $(cells[1]).text().trim();

    // Col 2: Host Kennel with link to /kennels/{slug}/
    const kennelLink = $(cells[2]).find("a");
    const kennelHref = kennelLink.attr("href") || "";
    const kennelMatch = kennelHref.match(/^\/kennels\/([^/]+)/);
    if (!kennelMatch) return;
    const kennelSlug = kennelMatch[1];

    // Col 3: Start Date "MM/DD/YY\nHH:MM AM/PM"
    const dateCell = $(cells[3]).html() || "";
    // Date and time are separated by <br>
    const dateParts = dateCell.split(/<br\s*\/?>/i).map((s) => s.replace(/<[^>]+>/g, "").trim());
    const startDate = dateParts[0] || "";
    const startTime = dateParts[1] || "";

    // Col 4: Cost
    const cost = $(cells[4]).text().trim();

    entries.push({ slug, kennelSlug, title, startDate, startTime, type, cost });
  });

  return entries;
}

/**
 * Parse Hash Rego date "MM/DD/YY" or "MM/DD" into "YYYY-MM-DD".
 * Uses referenceYear when only MM/DD is provided.
 */
export function parseHashRegoDate(
  text: string,
  referenceYear?: number,
): string | null {
  const trimmed = text.trim();

  // MM/DD/YY or MM/DD/YYYY
  const fullMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (fullMatch) {
    const month = parseInt(fullMatch[1], 10);
    const day = parseInt(fullMatch[2], 10);
    let year = parseInt(fullMatch[3], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // MM/DD only — needs reference year
  const shortMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (shortMatch && referenceYear) {
    const month = parseInt(shortMatch[1], 10);
    const day = parseInt(shortMatch[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${referenceYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

/**
 * Parse Hash Rego time "HH:MM AM/PM" into 24h "HH:MM".
 */
export function parseHashRegoTime(text: string): string | null {
  const match = text.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();

  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  // 11:59 PM is Hash Rego's "no time set" placeholder
  if (hours === 23 && minutes === 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Extract structured data from an event detail page.
 * The description is in the og:description meta tag (markdown-like).
 * Kennel slug is in sidebar links: /kennels/{slug}/
 * Date/time is in the h4 header in the content area.
 */
export function parseEventDetail(
  html: string,
  slug: string,
  indexEntry?: IndexEntry,
): ParsedEvent {
  const $ = cheerio.load(html);

  // Title from <title> tag or og:title
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  // og:title format: "MM/DD EventTitle"
  const titleFromOg = ogTitle.replace(/^\d{2}\/\d{2}\s+/, "").trim();
  const title = titleFromOg || $("title").text().trim();

  // Kennel slug from sidebar link
  const kennelLink = $('a[href^="/kennels/"]').first();
  const kennelHref = kennelLink.attr("href") || "";
  const kennelMatch = kennelHref.match(/\/kennels\/([^/]+)/);
  const kennelSlug = kennelMatch?.[1] || indexEntry?.kennelSlug || "";

  // Description from og:description meta tag
  const rawDescription = $('meta[property="og:description"]').attr("content") || "";

  // Parse structured fields from the description text
  const hares = extractField(rawDescription, "Hare(s)") || extractField(rawDescription, "Hares");
  const cost = extractField(rawDescription, "Cost") || indexEntry?.cost;
  const location = extractLocationFromDescription(rawDescription);
  const locationAddress = extractAddressFromDescription(rawDescription);

  // Parse dates from the description or index entry
  const { dates, startTimes, isMultiDay } = extractDates(rawDescription, indexEntry);

  // Location URL from Google Maps link in description
  const mapsMatch = rawDescription.match(/maps\.google\.com\/maps\?q=([^)\s"]+)/);
  const locationUrl = mapsMatch
    ? `https://maps.google.com/maps?q=${mapsMatch[1]}`
    : undefined;

  // Clean description: remove structured fields we already extracted
  const description = cleanDescription(rawDescription);

  return {
    title,
    dates,
    startTimes,
    location: location || locationAddress,
    locationAddress,
    locationUrl,
    hares,
    description,
    cost,
    kennelSlug,
    isMultiDay,
  };
}

/**
 * Split a parsed event into per-day RawEventData entries.
 * For single-day events, returns one entry.
 * For multi-day events, returns one per date with seriesId set.
 */
export function splitToRawEvents(
  parsed: ParsedEvent,
  slug: string,
): RawEventData[] {
  const hashRegoUrl = `${BASE_URL}/events/${slug}`;
  const externalLinks = [{ url: hashRegoUrl, label: "Hash Rego" }];

  if (!parsed.isMultiDay || parsed.dates.length <= 1) {
    // Single-day event
    const date = parsed.dates[0];
    if (!date) return [];

    return [
      {
        date,
        kennelTag: parsed.kennelSlug,
        title: parsed.title,
        description: parsed.description,
        hares: parsed.hares,
        location: parsed.location,
        locationUrl: parsed.locationAddress || parsed.locationUrl,
        startTime: parsed.startTimes[0] || undefined,
        sourceUrl: hashRegoUrl,
        externalLinks,
      },
    ];
  }

  // Multi-day event: one RawEventData per date
  const seriesId = slug; // Use the Hash Rego slug as series identifier
  return parsed.dates.map((date, i) => {
    const dayLabel =
      i === 0 ? "Day 1" : i === parsed.dates.length - 1 ? `Day ${i + 1}` : `Day ${i + 1}`;
    return {
      date,
      kennelTag: parsed.kennelSlug,
      title: `${parsed.title} (${dayLabel})`,
      description: parsed.description,
      hares: parsed.hares,
      location: parsed.location,
      locationUrl: parsed.locationAddress || parsed.locationUrl,
      startTime: parsed.startTimes[i] || parsed.startTimes[0] || undefined,
      sourceUrl: hashRegoUrl,
      externalLinks,
      seriesId,
    };
  });
}

// ── Internal helpers ──

/** Extract a **Field:** value from markdown-like text */
function extractField(text: string, fieldName: string): string | undefined {
  // Match both **Field:** and **Field: ** patterns
  const pattern = new RegExp(
    `\\*\\*${escapeRegExp(fieldName)}:?\\*\\*:?\\s*(.+?)(?:\\n|$)`,
    "i",
  );
  const match = text.match(pattern);
  if (match) return match[1].trim();

  // Also match plain "Field: value" (no bold)
  const plainPattern = new RegExp(
    `(?:^|\\n)\\s*${escapeRegExp(fieldName)}:?\\s+(.+?)(?:\\n|$)`,
    "i",
  );
  const plainMatch = text.match(plainPattern);
  return plainMatch ? plainMatch[1].trim() : undefined;
}

/** Extract location from "Where:" field in description */
function extractLocationFromDescription(text: string): string | undefined {
  return extractField(text, "Where");
}

/** Extract address from description (Google Maps URL or address line) */
function extractAddressFromDescription(text: string): string | undefined {
  // Look for address pattern after maps link or "Where" field
  const addressMatch = text.match(
    /(\d+\s+[\w\s]+(?:St|Ave|Rd|Blvd|Dr|Ln|Way|Pl|Ct|Pkwy|Hwy|Cir)[^,]*,\s*\w[\w\s]*,?\s*[A-Z]{2}\s*\d{5})/i,
  );
  return addressMatch ? addressMatch[1].trim() : undefined;
}

/** Generate all YYYY-MM-DD date strings in a range (inclusive). */
function generateDatesInRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    const m = current.getUTCMonth() + 1;
    const d = current.getUTCDate();
    const y = current.getUTCFullYear();
    dates.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/** Extract per-day start times from description text. */
function extractPerDayStartTimes(description: string, dateCount: number): string[] {
  const startTimes: string[] = [];
  const timePatterns = description.matchAll(
    /(\d{1,2}):(\d{2})\s+(show|go|start)/gi,
  );
  for (const tm of timePatterns) {
    const h = parseInt(tm[1], 10);
    const min = parseInt(tm[2], 10);
    const adjustedH = h < 12 && h >= 1 && h <= 9 ? h + 12 : h;
    startTimes.push(
      `${String(adjustedH).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
    );
  }
  while (startTimes.length < dateCount) {
    startTimes.push(startTimes[0] || "");
  }
  return startTimes;
}

/** Try to parse a date range from the description and index entry. */
function parseDateRangeFromDescription(
  description: string,
  indexEntry: IndexEntry,
): { dates: string[]; startTimes: string[]; isMultiDay: boolean } | null {
  const rangeMatch = description.match(
    /(\d{1,2})\/(\d{1,2})\s+\d{1,2}:\d{2}\s*(?:AM|PM)\s+to\s+(\d{1,2})\/(\d{1,2})\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i,
  );
  if (!rangeMatch) return null;

  const year = parseYearFromIndex(indexEntry.startDate);
  if (!year) return null;

  const startMonth = parseInt(rangeMatch[1], 10);
  const startDay = parseInt(rangeMatch[2], 10);
  const endMonth = parseInt(rangeMatch[3], 10);
  const endDay = parseInt(rangeMatch[4], 10);

  const startDate = new Date(Date.UTC(year, startMonth - 1, startDay));
  const endDate = new Date(Date.UTC(year, endMonth - 1, endDay));

  const dates = generateDatesInRange(startDate, endDate);
  const startTimes = extractPerDayStartTimes(description, dates.length);

  return { dates, startTimes, isMultiDay: dates.length > 1 };
}

/** Extract dates and detect multi-day events */
function extractDates(
  description: string,
  indexEntry?: IndexEntry,
): { dates: string[]; startTimes: string[]; isMultiDay: boolean } {
  if (indexEntry) {
    const rangeResult = parseDateRangeFromDescription(description, indexEntry);
    if (rangeResult) return rangeResult;

    const date = parseHashRegoDate(indexEntry.startDate);
    const time = parseHashRegoTime(indexEntry.startTime);
    if (date) {
      return {
        dates: [date],
        startTimes: time ? [time] : [],
        isMultiDay: false,
      };
    }
  }

  return { dates: [], startTimes: [], isMultiDay: false };
}

/** Extract year from "MM/DD/YY" format */
function parseYearFromIndex(dateStr: string): number | null {
  const match = dateStr.match(/\d{1,2}\/\d{1,2}\/(\d{2,4})/);
  if (!match) return null;
  let year = parseInt(match[1], 10);
  if (year < 100) year += 2000;
  return year;
}

/** Clean description by removing structured fields already extracted */
function cleanDescription(text: string): string | undefined {
  if (!text) return undefined;

  let cleaned = text
    // Remove **Field:** lines for fields we extract separately
    .replace(/\*\*(?:Hare\(s\)|Hares|Cost|Where|When):?\*\*:?\s*[^\n]*/gi, "")
    // Remove plain Field: lines
    .replace(/^(?:Hare\(s\)|Hares|Cost|Where|When):?\s+[^\n]*/gim, "")
    // Remove Google Maps URLs
    .replace(/\/\/maps\.google\.com\S+/g, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Don't return empty or whitespace-only
  if (!cleaned || cleaned.length < 10) return undefined;

  // Truncate very long descriptions
  if (cleaned.length > 2000) {
    cleaned = cleaned.slice(0, 2000) + "...";
  }

  return cleaned;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
