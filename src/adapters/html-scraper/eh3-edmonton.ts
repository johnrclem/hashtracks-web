import * as cheerio from "cheerio";
import * as chrono from "chrono-node";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails, ParseError } from "../types";
import { safeFetch } from "../safe-fetch";
import { decodeEntities, stripPlaceholder, parse12HourTime, buildDateWindow } from "../utils";

/**
 * Page→kennel mapping for EH3 WordPress site.
 * Each page hosts the hareline for one Edmonton-area kennel.
 */
const PAGE_KENNEL_MAP: Record<number, { kennelTag: string; defaultStartTime: string }> = {
  423: { kennelTag: "eh3-ab", defaultStartTime: "18:30" },
  425: { kennelTag: "osh3-ab", defaultStartTime: "14:00" },
  429: { kennelTag: "efmh3", defaultStartTime: "19:00" },
  431: { kennelTag: "bash-eh3", defaultStartTime: "18:30" },
  433: { kennelTag: "snash-eh3", defaultStartTime: "18:30" },
  437: { kennelTag: "divah3-eh3", defaultStartTime: "19:00" },
  439: { kennelTag: "rash-eh3", defaultStartTime: "13:00" },
};

/** Header patterns for each kennel — each page formats headers differently. */
const HEADER_PATTERNS: Record<string, RegExp[]> = {
  // EH3: "EH3 Run # 1845 – Monday April 6 – Title" or "EH3 Run #1854 – Monday June 8 – D-Day Run"
  // Also: "EH Run #1882 Saturday Dec 19 – Christmas Hash"
  // Also without separator: "EH3 Run # 1847 Monday April 20"
  "eh3-ab": [
    /^EH3?\s+Run\s*#\s*(\d+)\s*[–—-]?\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(.+?)(?:\s*[–—-]\s*(.+))?$/i,
  ],
  // OSH3: "OSH3 #1061 – Title" (date on next line)
  "osh3-ab": [
    /^OSH3\s*#\s*(\d+)\s*[–—-]\s*(.+)$/i,
  ],
  // EFMH3: "Friday April 3, 2026, 7pm: Full Moon Run 352" (date-first)
  "efmh3": [
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(.+?):\s*(.+?)(\d+)\s*$/i,
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(.+?):\s*(.+)$/i,
  ],
  // BASH: "Bash#857 – Title" (date on next line)
  "bash-eh3": [
    /^Bash\s*#\s*(\d+)\s*[–—-]\s*(.+)$/i,
  ],
  // SNASH: "SNASH #285 – Title" (date on next line)
  "snash-eh3": [
    /^SNASH\s*#\s*(\d+)\s*[–—-]\s*(.+)$/i,
  ],
  // DivaH3: "Friday, March 13, 2026 – Title" (date-first, no run number)
  "divah3-eh3": [
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(.+?)\s*[–—-]\s*(.+)$/i,
  ],
  // RASH: "RASH #89 – Title" (date on next line)
  "rash-eh3": [
    /^RASH\s*#\s*(\d+)\s*[–—-]\s*(.+)$/i,
  ],
};

/**
 * Parse EH3 seasonal start time: Monday → 18:30 (summer), Saturday → 14:00 (winter).
 */
function eh3StartTimeFromDay(dayOfWeek: string): string {
  return /saturday/i.test(dayOfWeek) ? "14:00" : "18:30";
}

/** Extract labeled field value from a line, e.g., "Hares: Foo and Bar" → "Foo and Bar" */
function extractField(line: string, ...labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(`^${label}\\s*:\\s*(.+)`, "i");
    const m = re.exec(line);
    if (m) return stripPlaceholder(m[1].trim());
  }
  return undefined;
}

/** Extract a Google Maps link from a line of text */
function extractMapUrl(text: string): string | undefined {
  const m = /https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)[^\s)"]*/i.exec(text);
  return m ? m[0] : undefined;
}

interface ParsedEh3Event {
  runNumber?: number;
  title?: string;
  date?: string;
  hares?: string;
  location?: string;
  locationUrl?: string;
  startTime?: string;
  description?: string;
  onOn?: string;
}

/**
 * Parse a single event block (text lines from one `<p>` element).
 */
export function parseEh3EventBlock(
  lines: string[],
  kennelTag: string,
  defaultStartTime: string,
): ParsedEh3Event | null {
  if (lines.length === 0) return null;

  const headerLine = lines[0];
  const patterns = HEADER_PATTERNS[kennelTag];
  if (!patterns) return null;

  let runNumber: number | undefined;
  let title: string | undefined;
  let headerDate: string | undefined;
  let matched = false;

  // Try kennel-specific header patterns
  if (kennelTag === "eh3-ab") {
    for (const pat of patterns) {
      const m = pat.exec(headerLine);
      if (m) {
        runNumber = parseInt(m[1], 10);
        // The date part is in group 2, title (if present) in group 3
        const datePart = m[2].trim();
        title = m[3]?.trim() || undefined;
        headerDate = parseDate(datePart) ?? undefined;
        matched = true;
        break;
      }
    }
  } else if (kennelTag === "efmh3") {
    // Date-first: "Friday April 3, 2026, 7pm: Full Moon Run 352"
    for (const pat of patterns) {
      const m = pat.exec(headerLine);
      if (m) {
        headerDate = parseDate(m[1].trim()) ?? undefined;
        const titlePart = m[2].trim();
        const numPart = m[3];
        if (numPart) {
          runNumber = parseInt(numPart, 10);
          title = titlePart + " " + numPart;
        } else {
          title = titlePart;
        }
        matched = true;
        break;
      }
    }
  } else if (kennelTag === "divah3-eh3") {
    // Date-first: "Friday, March 13, 2026 – Title"
    for (const pat of patterns) {
      const m = pat.exec(headerLine);
      if (m) {
        headerDate = parseDate(m[1].trim()) ?? undefined;
        title = m[2]?.trim() || undefined;
        matched = true;
        break;
      }
    }
  } else {
    // Standard: "PREFIX #NNN – Title" (date on next line)
    for (const pat of patterns) {
      const m = pat.exec(headerLine);
      if (m) {
        runNumber = parseInt(m[1], 10);
        title = m[2]?.trim() || undefined;
        matched = true;
        break;
      }
    }
  }

  if (!matched) return null;

  // Parse remaining lines for fields
  let hares: string | undefined;
  let location: string | undefined;
  let locationUrl: string | undefined;
  let startTime: string | undefined;
  let onOn: string | undefined;
  const descParts: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Try to parse date from body lines (for kennels with date on next line)
    if (!headerDate) {
      const d = parseDate(line);
      if (d) {
        headerDate = d;
        // Also try to extract time from the same line
        const t = parse12HourTime(line);
        if (t) startTime = t;
        continue;
      }
    }

    // Field extraction
    const h = extractField(line, "Hares?", "Hare");
    if (h) { hares = h; continue; }

    const loc = extractField(line, "Location", "Start");
    if (loc) {
      location = loc;
      locationUrl = extractMapUrl(line);
      continue;
    }

    const oo = extractField(line, "On on", "On On", "ON IN");
    if (oo) { onOn = oo; continue; }

    const hc = extractField(line, "Hash Cash");
    if (hc) { continue; } // noted but not stored in RawEventData

    const mapField = extractField(line, "Map");
    if (mapField) {
      locationUrl = locationUrl || extractMapUrl(line) || mapField;
      continue;
    }

    const note = extractField(line, "Notes?", "Note");
    if (note) { descParts.push(note); continue; }

    const hashHold = extractField(line, "Hash Hold");
    if (hashHold) { descParts.push(`Hash Hold: ${hashHold}`); continue; }

    // Check for "Note from hares:" or "Note from the hares:" pattern
    const noteFromHares = /^Note from (?:the )?hares?\s*:\s*(.+)/i.exec(line);
    if (noteFromHares) { descParts.push(noteFromHares[1].trim()); continue; }
  }

  // Build description
  if (onOn) descParts.unshift(`On On: ${onOn}`);
  const description = descParts.length > 0 ? descParts.join(" | ") : undefined;

  // EH3-specific: derive start time from day of week if Monday/Saturday in header
  if (kennelTag === "eh3-ab" && !startTime) {
    const dayMatch = /(?:Monday|Saturday)/i.exec(headerLine);
    if (dayMatch) {
      startTime = eh3StartTimeFromDay(dayMatch[0]);
    }
  }

  return {
    runNumber,
    title,
    date: headerDate,
    hares,
    location,
    locationUrl,
    startTime: startTime || defaultStartTime,
    description,
    onOn,
  };
}

/**
 * Parse a date string using chrono-node with forward-date preference.
 * Handles various formats across EH3 kennels.
 */
export function parseDate(text: string): string | null {
  // Clean up whitespace
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const ref = new Date();
  const results = chrono.en.parse(cleaned, { instant: ref }, { forwardDate: true });
  if (results.length === 0) return null;

  const parsed = results[0].start;
  const year = parsed.get("year");
  const month = parsed.get("month");
  const day = parsed.get("day");
  if (year == null || month == null || day == null) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Edmonton Multi-Kennel Adapter
 *
 * Fetches harelines for 7 Edmonton-area kennels from the EH3.org WordPress
 * site via the REST API. Each kennel has its own page with distinct header
 * formatting patterns.
 *
 * Pages: 423 (EH3), 425 (OSH3), 429 (EFMH3), 431 (BASH), 433 (SNASH),
 *        437 (DivaH3), 439 (RASH)
 */
export class Eh3EdmontonAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const days = options?.days ?? source.scrapeDays ?? 365;
    const { minDate, maxDate } = buildDateWindow(days);
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const parseErrors: ParseError[] = [];
    const fetchErrors: ErrorDetails["fetch"] = [];
    const diagnosticContext: Record<string, unknown> = {};

    // Determine which pages to fetch
    const pageIds = Object.keys(PAGE_KENNEL_MAP).map(Number);

    for (const pageId of pageIds) {
      const { kennelTag, defaultStartTime } = PAGE_KENNEL_MAP[pageId];
      const url = `https://www.eh3.org/wp-json/wp/v2/pages/${pageId}?_fields=content,modified`;

      try {
        const response = await safeFetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
        });

        if (!response.ok) {
          const msg = `HTTP ${response.status} for page ${pageId} (${kennelTag})`;
          errors.push(msg);
          fetchErrors.push({ url, status: response.status, message: msg });
          continue;
        }

        const json = await response.json() as {
          content: { rendered: string };
          modified: string;
        };

        const html = json.content.rendered;
        const $ = cheerio.load(html);

        // Each event is in a <p> element. Convert <br> to newlines, then split.
        const paragraphs = $("p").toArray();
        let pageEventCount = 0;

        for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
          const pEl = $(paragraphs[pIdx]);
          // Convert <br> to newlines for field parsing
          const rawHtml = pEl.html() || "";
          const decoded = decodeEntities(
            rawHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "),
          )
            .replace(/\s*\n\s*/g, "\n")
            .trim();

          if (!decoded) continue;

          const lines = decoded.split("\n").map((l) => l.trim()).filter(Boolean);
          if (lines.length === 0) continue;

          // Check if this paragraph starts with a header pattern
          const parsed = parseEh3EventBlock(lines, kennelTag, defaultStartTime);
          if (!parsed || !parsed.date) continue;

          // Date window filter
          const eventDate = new Date(parsed.date + "T12:00:00Z");
          if (eventDate < minDate || eventDate > maxDate) continue;

          const event: RawEventData = {
            date: parsed.date,
            kennelTag,
            runNumber: parsed.runNumber,
            title: parsed.title,
            hares: parsed.hares,
            location: parsed.location,
            locationUrl: parsed.locationUrl,
            startTime: parsed.startTime,
            description: parsed.description,
            sourceUrl: `https://www.eh3.org/?page_id=${pageId}`,
          };

          events.push(event);
          pageEventCount++;
        }

        diagnosticContext[`page_${pageId}_${kennelTag}`] = pageEventCount;
      } catch (err) {
        const msg = `Fetch failed for page ${pageId} (${kennelTag}): ${err}`;
        errors.push(msg);
        fetchErrors.push({ url, message: msg });
      }
    }

    const errorDetails: ErrorDetails = {};
    if (fetchErrors.length > 0) errorDetails.fetch = fetchErrors;
    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    return {
      events,
      errors,
      errorDetails: (fetchErrors.length > 0 || parseErrors.length > 0) ? errorDetails : undefined,
      diagnosticContext: {
        ...diagnosticContext,
        pagesAttempted: pageIds.length,
        totalEvents: events.length,
      },
    };
  }
}
