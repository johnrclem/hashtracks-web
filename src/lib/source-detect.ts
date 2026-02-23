/**
 * Deterministic source-type detection and config extraction from URLs.
 * Pure functions — no side effects, fully testable.
 */

import type { SourceType } from "@/generated/prisma/client";

export type SourceDetectResult = {
  /** Suggested SourceType based on the URL */
  type: SourceType;
  /**
   * For GOOGLE_CALENDAR: the calendarId extracted from the embed URL.
   * The adapter stores the calendarId in source.url (not the full URL).
   */
  extractedUrl?: string;
  /**
   * For GOOGLE_SHEETS: the spreadsheet ID extracted from the URL.
   * Should be auto-populated into SheetsConfig.sheetId.
   */
  sheetId?: string;
  /**
   * For MEETUP: the group URL name extracted from the URL path.
   * e.g. https://www.meetup.com/brooklyn-hash-house-harriers/ → "brooklyn-hash-house-harriers"
   */
  groupUrlname?: string;
};

/**
 * Detect source type from a URL and extract relevant IDs.
 * Returns null if the URL doesn't match any known pattern.
 */
export function detectSourceType(rawUrl: string): SourceDetectResult | null {
  let url: URL;
  try {
    // Support webcal:// by normalising to https://
    url = new URL(rawUrl.replace(/^webcal:\/\//i, "https://"));
  } catch {
    return null;
  }

  // Google Sheets
  if (url.hostname === "docs.google.com" && url.pathname.startsWith("/spreadsheets")) {
    const sheetId = extractSheetId(rawUrl);
    return { type: "GOOGLE_SHEETS", sheetId };
  }

  // Google Calendar (embed URL or public URL with ?src= param)
  if (url.hostname === "calendar.google.com") {
    const calendarId = extractCalendarId(rawUrl);
    return { type: "GOOGLE_CALENDAR", extractedUrl: calendarId };
  }

  // Hash Rego
  if (url.hostname === "hashrego.com" || url.hostname.endsWith(".hashrego.com")) {
    return { type: "HASHREGO" };
  }

  // Meetup.com
  if (url.hostname === "meetup.com" || url.hostname.endsWith(".meetup.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const groupUrlname = parts[0] ?? undefined;
    return { type: "MEETUP", groupUrlname };
  }

  // iCal feed: .ics extension or ical/ics in query params, or webcal scheme
  const isIcal =
    url.pathname.toLowerCase().endsWith(".ics") ||
    url.searchParams.get("format")?.toLowerCase() === "ical" ||
    url.searchParams.has("ical") ||
    rawUrl.toLowerCase().startsWith("webcal://");
  if (isIcal) {
    return { type: "ICAL_FEED" };
  }

  // RSS feed: common path suffixes and query params
  const rssSuffixes = ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml"];
  const pathNorm = url.pathname.toLowerCase().replace(/\/$/, "");
  const isRss =
    rssSuffixes.some((s) => pathNorm.endsWith(s)) ||
    url.searchParams.get("feed") === "rss2" ||
    url.searchParams.get("format") === "rss";
  if (isRss) {
    return { type: "RSS_FEED" };
  }

  return null;
}

/**
 * Extract the spreadsheet ID from a Google Sheets URL.
 * e.g. https://docs.google.com/spreadsheets/d/SHEET_ID/edit → "SHEET_ID"
 */
export function extractSheetId(url: string): string | undefined {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1];
}

/**
 * Extract the calendarId from a Google Calendar embed/public URL.
 * Handles:
 *   - ?src=CALENDAR_ID (embed URL)
 *   - ?cid=CALENDAR_ID ("Add to Google Calendar" links)
 *   - /calendar/ical/CALENDAR_ID/public/basic.ics
 * Returns `undefined` if no calendarId can be extracted.
 */
export function extractCalendarId(url: string): string | undefined {
  // ?cid= param ("Add to Google Calendar" links)
  const cidMatch = url.match(/[?&]cid=([^&]+)/);
  if (cidMatch) return decodeURIComponent(cidMatch[1]);

  // ?src= param (embed URLs)
  const srcMatch = url.match(/[?&]src=([^&]+)/);
  if (srcMatch) return decodeURIComponent(srcMatch[1]);

  // /ical/CALENDAR_ID/public/
  const icalMatch = url.match(/\/ical\/([^/]+)\/public\//);
  if (icalMatch) return decodeURIComponent(icalMatch[1]);

  return undefined;
}

/**
 * Suggest literal [pattern, tag] pairs for unmatched kennel tags.
 * Each suggestion is a simple exact-match regex for the tag string itself.
 * The admin can refine the regex after accepting.
 *
 * e.g. ["EWH3", "BFM"] → [["EWH3", "EWH3"], ["BFM", "BFM"]]
 */
export function suggestKennelPatterns(unmatchedTags: string[]): [string, string][] {
  return [...new Set(unmatchedTags)]
    .filter((tag) => tag.trim().length > 0)
    .map((tag) => [tag, tag]);
}
