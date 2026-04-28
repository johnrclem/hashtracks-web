import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, chronoParseDate, parse12HourTime } from "../utils";

/**
 * Halve Mein uses playful month names in their hareline.
 * Map them to standard month names so chrono-node can parse them.
 */
export const HMHHH_MONTH_MAP: Record<string, string> = {
  sextembeer: "September",
  hashtobeer: "October",
  novembeer: "November",
  decembeer: "December",
};

// Regex generated from map keys to stay in sync automatically
const HMHHH_MONTH_RE = new RegExp(
  `\\b(${Object.keys(HMHHH_MONTH_MAP).join("|")})\\b`, "gi",
);

/**
 * Replace custom Halve Mein month names with standard ones.
 * Case-insensitive replacement, preserves surrounding text.
 */
export function normalizeHalveMeinMonths(text: string): string {
  return text.replace(
    HMHHH_MONTH_RE,
    (match) => HMHHH_MONTH_MAP[match.toLowerCase()] ?? match,
  );
}

/**
 * Parse Halve Mein compact time format: "6PM", "1PM", "11AM", "12PM".
 * No colon, no minutes, no space before AM/PM.
 * Falls back to parse12HourTime() for standard "6:00 PM" format.
 */
export function parseHalveMeinTime(text: string): string | undefined {
  // Try standard format first (e.g., "6:00 PM")
  const standard = parse12HourTime(text);
  if (standard) return standard;

  // Try compact format: "6PM", "11AM", "12PM"
  const match = /(\d{1,2})\s*(am|pm)/i.exec(text);
  if (!match) return undefined;

  let hours = parseInt(match[1], 10);
  const ampm = match[2].toLowerCase();

  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:00`;
}

/**
 * Parse a single row from the Halve Mein upcoming events table.
 *
 * Expected columns in `.cellbox` table:
 *   0: Run # + optional event name (e.g., "821<br>St Paddy's Dayish Hash")
 *   1: Day (day of week)
 *   2: Date & Time (e.g., "March 18, 6PM" or "Sextembeer 5, 1PM")
 *   3: Place / Location
 *   4: Hare name(s)
 *   5: Directions (link)
 *
 * @param cell0Html - Raw HTML of cell[0] to preserve <br>-separated run number + event name
 */
export function parseHalveMeinRow(
  cells: string[],
  sourceUrl: string,
  cell0Html?: string,
): RawEventData | null {
  if (cells.length < 4) return null;

  // Column 0: Run number and optional event name
  let runNumber: number | undefined;
  let eventName: string | undefined;

  if (cell0Html) {
    // Split on <br> to separate run number from event name
    const parts = cell0Html
      .replace(/<\/?font[^>]*>/gi, "") // strip <font> wrappers
      .split(/<br\s*\/?>/i)
      .map((p) => p.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);

    if (parts.length > 0) {
      const num = parseInt(parts[0], 10);
      if (!isNaN(num)) {
        runNumber = num;
        eventName = parts.slice(1).join(" ").trim() || undefined;
      } else {
        eventName = parts.join(" ").trim() || undefined;
      }
    }
  } else {
    // Fallback: text-only parsing (for backward compat with tests)
    const runText = cells[0]?.trim() ?? "";
    const runMatch = /^(\d+)\s*(.*)$/.exec(runText);
    if (runMatch) {
      runNumber = parseInt(runMatch[1], 10);
      const remainder = runMatch[2].trim();
      if (remainder) eventName = remainder;
    } else if (runText) {
      eventName = runText;
    }
  }

  // Column 2: Date & Time — normalize custom months before parsing
  const dateTimeText = cells[2]?.trim();
  if (!dateTimeText) return null;

  const normalizedDateText = normalizeHalveMeinMonths(dateTimeText);
  const date = chronoParseDate(normalizedDateText, "en-US", undefined, { forwardDate: true });
  if (!date) return null;

  const startTime = parseHalveMeinTime(normalizedDateText);

  // Column 3: Location
  const location = cells[3]?.trim() || undefined;

  // Column 4: Hares
  let hares: string | undefined;
  if (cells[4]) {
    const cleaned = cells[4].trim();
    if (cleaned && !/^(?:tbd|tba|tbc|n\/a|sign[\s\u00A0]*up!?|volunteer|needed|required)$/i.test(cleaned)) {
      hares = cleaned;
    }
  }

  // Build title: include event name unless it's just "Hash" (generic/uninformative)
  let title: string;
  if (runNumber) {
    title = eventName && eventName !== "Hash"
      ? `HMHHH #${runNumber}: ${eventName}`
      : `HMHHH #${runNumber}`;
  } else {
    title = eventName ? `HMHHH: ${eventName}` : "HMHHH Trail";
  }

  return {
    date,
    kennelTags: ["halvemein"],
    runNumber,
    title,
    hares,
    location: location || undefined,
    startTime,
    sourceUrl,
  };
}

/**
 * Halve Mein Hash House Harriers (HMHHH) Adapter
 *
 * Scrapes www.hmhhh.com/index.php?log=upcoming.con — a PHP-generated HTML page
 * with a table using `.cellbox` CSS class. Columns include run number, date/time,
 * location, and hare names.
 */
export class HalveMeinAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "https://www.hmhhh.com/index.php?log=upcoming.con";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let rowIndex = 0;

    // Find table rows — look for .cellbox cells or standard table rows
    const rows = $("table tr").toArray();

    // Skip header row(s) — detect by checking if first cell contains "Run" or "#"
    let headerSkipped = false;

    for (const row of rows) {
      const $row = $(row);
      const tds = $row.find("td").toArray();
      const cells = tds.map((td) => $(td).text().trim());

      // Skip empty rows
      if (cells.length === 0) continue;

      rowIndex++;

      // Skip header row
      if (!headerSkipped) {
        const firstCell = cells[0]?.toLowerCase() || "";
        if (firstCell.includes("run") || firstCell.includes("#") || firstCell.includes("no")) {
          headerSkipped = true;
          continue;
        }
      }

      // Extract direction URL if present
      let locationUrl: string | undefined;
      $row.find("a").each((_i, a) => {
        const href = $(a).attr("href") || "";
        if (href.includes("google") && href.includes("map")) {
          locationUrl = href;
        }
      });

      // Extract raw HTML of cell[0] to preserve <br>-separated run number + event name
      const cell0Html = tds[0] ? $(tds[0]).html() ?? undefined : undefined;

      try {
        const event = parseHalveMeinRow(cells, url, cell0Html);
        if (event) {
          if (locationUrl) {
            event.locationUrl = locationUrl;
          }
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing row ${rowIndex}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: rowIndex,
          error: String(err),
          rawText: cells.join(" | ").slice(0, 2000),
        });
      }
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rowIndex,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
