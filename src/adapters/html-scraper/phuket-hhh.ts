import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  fetchHTMLPage,
  normalizeHaresField,
} from "../utils";

/**
 * Phuket Hash House Harriers shared hareline adapter.
 *
 * phuket-hhh.com/hareline.php lists upcoming runs for ~6 Phuket kennels in a
 * single HTML table. Each `<tr>` has a CSS class indicating the kennel:
 *   - "saturday"    → PHHH (Phuket HHH, Saturday runs)
 *   - "pooying"     → Phuket Pooying H3
 *   - "tinmen"      → Phuket Tin Men H3
 *   - "ironpussy"   → Iron Pussy H3
 *   - "bike"        → Phuket Bike Hash
 *   - "kamalakoma"  → Kamala Koma H3
 *
 * Table columns: date+time | kennel name | run number | hares | location
 *
 * The source config specifies which kennel CSS classes to scrape via `kennelMap`.
 */

/** Map of CSS class → kennelCode for routing. Only includes kennels
 * that are actually seeded + linked to a source. Rows with CSS classes
 * NOT in this map are silently skipped — they'd produce unmatched
 * kennelTags and recurring health noise. Add entries when new Phuket
 * kennels are onboarded (bike, kamalakoma, etc.). */
const DEFAULT_KENNEL_MAP: Record<string, string> = {
  saturday: "phhh",
  pooying: "phuket-pooying",
  tinmen: "phuket-tinmen",
  ironpussy: "iron-pussy",
};

/** Parse a date+time cell like "12 Apr 2026 @ 15:00 PM" */
export function parsePhuketDateCell(text: string): { date: string | null; startTime: string | null } {
  const cleaned = decodeEntities(text).trim();

  // Extract time: "15:00 PM" or "16:00 PM" or "3:00 PM"
  // Phuket uses 24-hour format with spurious "PM" suffix (e.g., "15:00 PM" = 15:00)
  let startTime: string | null = null;
  const timeMatch = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(cleaned);
  if (timeMatch) {
    let h = Number.parseInt(timeMatch[1], 10);
    const m = Number.parseInt(timeMatch[2], 10);
    const ampm = timeMatch[3].toLowerCase();
    // Only apply AM/PM conversion for 12-hour values (1-12)
    // Values 13+ are already 24-hour and the AM/PM suffix is spurious
    if (h <= 12) {
      if (ampm === "pm" && h !== 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
    }
    startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // Parse the date portion (everything before "@")
  const datePart = cleaned.replace(/@.*/, "").trim();
  const date = chronoParseDate(datePart, "en-GB");

  return { date, startTime };
}

/** Split a `<br>`-segmented cell string (`\n`-delimited) into non-empty trimmed segments. */
function splitCellSegments(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Driving-directions / GPS noise we strip from the venue segment if present. */
const PHUKET_DIRECTIONS_RE =
  /(?:Coming from|From the|Heading|Head toward|Turn (?:left|right)|Go past|Continue|Follow|The run|GPS\s*:)[\s\S]*/i;

/** Placeholder-only venue values that should resolve to undefined location. */
const PHUKET_PLACEHOLDER_VENUE_RE = /^(?:location:\s*tbc|tbc|tbd)$/i;

/** Hares cell → comma-joined sorted list (stable fingerprint per project rule). */
function parsePhuketHares(cell: string | undefined): string | undefined {
  if (!cell) return undefined;
  const segments = splitCellSegments(cell);
  if (segments.length === 0) return undefined;
  return normalizeHaresField(
    [...segments].sort((a, b) => a.localeCompare(b)).join(", "),
  );
}

/** Location cell → venue (first <br>-segment, directions stripped) + description (remaining segments). */
function parsePhuketLocationCell(cell: string | undefined): {
  location?: string;
  description?: string;
} {
  if (!cell) return {};
  const segments = splitCellSegments(cell);
  if (segments.length === 0) return {};
  const venue = segments[0].replace(PHUKET_DIRECTIONS_RE, "").trim();
  const location =
    venue.length > 0 && !PHUKET_PLACEHOLDER_VENUE_RE.test(venue) ? venue : undefined;
  const rest = segments.slice(1).filter(Boolean);
  const description = rest.length > 0 ? rest.join("\n") : undefined;
  return { location, description };
}

/** Parse a single hareline table row. Cell strings are expected to encode
 *  `<br>` boundaries as `\n` (see the adapter's cell extraction). Exported
 *  for testing. */
export function parsePhuketRow(
  cells: string[],
  rowClass: string,
  kennelMap: Record<string, string>,
  sourceUrl: string,
): RawEventData | null {
  if (cells.length < 3) return null;

  const kennelTag = kennelMap[rowClass];
  if (!kennelTag) return null;

  const { date, startTime } = parsePhuketDateCell(cells[0]);
  if (!date) return null;

  const runNumberMatch = /(\d+)/.exec(cells[2] ?? "");
  const runNumber = runNumberMatch ? Number.parseInt(runNumberMatch[1], 10) : undefined;

  // Hares column (#1327): one hare per <br>-delimited line; sort + comma-join
  // for stable fingerprint per project rule.
  const hares = parsePhuketHares(cells[3]);

  // Location column (#1327): <venue><br>ON-ON: …<br>Theme: …<br>Bus: …
  // First segment → locationName, rest → description.
  const { location, description } = parsePhuketLocationCell(cells[4]);

  return {
    date,
    kennelTags: [kennelTag],
    runNumber,
    hares,
    location,
    description,
    startTime: startTime ?? undefined,
    sourceUrl,
  };
}

export class PhuketHHHAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.phuket-hhh.com/hareline.php";
    const config = (source.config ?? {}) as Record<string, unknown>;
    const kennelMap = (config.kennelMap as Record<string, string>) ?? DEFAULT_KENNEL_MAP;

    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Parse table rows — skip header row (class="head")
    const rows = $("tr").toArray();
    let rowsParsed = 0;

    for (let i = 0; i < rows.length; i++) {
      const el = rows[i];
      const $row = $(el);
      const rowClass = ($row.attr("class") ?? "").trim().toLowerCase();

      // Skip header rows
      if (rowClass === "head" || !rowClass) continue;

      // Extract cell texts, encoding `<br>` boundaries as `\n` so multi-row
      // cells (venue + OnOn + theme + bus schedule on the location column;
      // multi-hare lists on the hares column — #1327) don't collapse into
      // a single run-on string.
      const cells: string[] = [];
      $row.find("td").each((_j, cell) => {
        const $cell = $(cell).clone();
        $cell.find("br").replaceWith("\n");
        cells.push($cell.text().trim());
      });

      if (cells.length < 3) continue;

      try {
        const event = parsePhuketRow(cells, rowClass, kennelMap, baseUrl);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "hareline", error: String(err), rawText: cells.join(" | ").slice(0, 2000) },
        ];
      }
      rowsParsed++;
    }

    if (events.length === 0 && errors.length === 0) {
      errors.push("Phuket HHH: zero events parsed from hareline table");
    }

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        structureHash,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "fetchHTMLPage",
          rowsFound: rowsParsed,
          eventsParsed: events.length,
          kennelsFound: [...new Set(events.map((e) => e.kennelTags[0]))],
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
