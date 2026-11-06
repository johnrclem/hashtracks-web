/**
 * Dublin Hash House Harriers (DH3) HTML Scraper
 *
 * Scrapes dublinhhh.com/archive for all events (past + future).
 * The archive is a Jekyll-generated HTML table with columns:
 *   Day | Date | Time | Hash (series + run#) | Location | Hares | Notes
 *
 * Several kennels share the table (#2759), told apart by the Hash column:
 *   - "Dublin H3 #NNNN"  → Dublin H3 (dh3), odd-week Mondays
 *   - "I ♥ Monday #NNN"  → I ♥ Monday (i-love-monday), even-week Mondays,
 *                          its own run sequence
 *   - "Shed Hash #N"     → Shed Hash (shed-h3), annual August trail in Naas
 *   - other "Other" rows → Dublin H3 specials (Wren Boys, Nash Hash, pick-ups,
 *                          hosted guest runs), except non-trails and other
 *                          clubs' trails, which are skipped.
 * See `routeDublinRow`.
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, fetchHTMLPage, buildDateWindow } from "../utils";

/**
 * Strip a trailing 1–2 letter postal-code fragment after a comma
 * (e.g. "Dublin, D" → "Dublin"). #905: also normalize nbsp → space so a
 * trailing `, D\u00A0` (source row wrapping after "Dublin, ") is recognized
 * by the regex's `$` anchor. Multi-digit suffixes like "D02" are real
 * Eircodes and intentionally preserved.
 */
export function stripTruncatedPostalFragment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\u00A0/g, " ").trim();
  const stripped = normalized.replace(/,\s*[A-Z]{1,2}$/i, "").trim();
  return stripped || undefined;
}

/** kennelCodes the Dublin HHH hareline feeds (#2759). */
export const DUBLIN_KENNELS = {
  dublinH3: "dh3",
  iLoveMonday: "i-love-monday",
  shedHash: "shed-h3",
} as const;

// Label prefixes, compared against the label lower-cased with all whitespace
// removed ("I ♥ Monday #427" → "i♥monday#427"). Plain prefix checks keep the
// matching linear and readable (Sonar S5852 flags `\s*` beside alternations).
const I_LOVE_MONDAY_PREFIXES = ["i♥monday", "i❤️monday", "i❤monday", "ilovemonday", "iheartmonday", "i<3monday"];
const DUBLIN_H3_PREFIX = "dublinh3";
const SHED_HASH_PREFIX = "shed";
/** Volunteer duty listed on the hareline (marathon water station), not a trail. */
const NON_TRAIL_MARKERS = ["waterstop", "waterstation"];
/** Other clubs' trails listed for information, not Dublin HHH runs. */
const OTHER_CLUB_PREFIXES = ["corkh3"];

/**
 * Route a hareline row to a kennelCode by its Hash label (column 3), which is
 * the site's own `hash` / `other_hash` front-matter field: "Dublin H3",
 * "I ♥ Monday", or an "Other" hash's free-text name. Returns null for rows to
 * skip (non-trails, other clubs' trails).
 *
 * The detail-page slug (`…-dublin-h3/`, `…-i-♥-monday/`, `…-other/`) is NOT a
 * reliable signal: it is fixed when the post is created (the 2025 Wren Boys run
 * lives under an `i-♥-monday` slug; one DH3 slug reads "dubiln"). Only the
 * anchored "Dublin H3" label counts for Dublin H3, never a bare "Dublin".
 */
export function routeDublinRow(label: string): string | null {
  const compact = label.toLowerCase().replaceAll(/\s+/g, "");
  // The two numbered Monday series first: a themed run is still a run.
  if (I_LOVE_MONDAY_PREFIXES.some((p) => compact.startsWith(p))) return DUBLIN_KENNELS.iLoveMonday;
  if (compact.startsWith(DUBLIN_H3_PREFIX)) return DUBLIN_KENNELS.dublinH3;
  if (NON_TRAIL_MARKERS.some((m) => compact.includes(m))) return null;
  if (OTHER_CLUB_PREFIXES.some((p) => compact.startsWith(p))) return null;
  if (compact.startsWith(SHED_HASH_PREFIX)) return DUBLIN_KENNELS.shedHash;
  // Remaining "Other" rows are Dublin HHH specials: Wren Boys Run, Nash Hash,
  // the Paddy's Day pick-up, guest runs Dublin HHH hosts.
  return DUBLIN_KENNELS.dublinH3;
}

/**
 * Parse a single table row into a RawEventData. Returns null for malformed
 * rows and for rows `routeDublinRow` skips.
 * Exported for unit testing.
 */
export function parseHarelineRow(
  cells: string[],
  hrefs: (string | undefined)[],
  sourceUrl: string,
): RawEventData | null {
  // Expected columns: [0]=day, [1]=date, [2]=time, [3]=hash, [4]=location, [5]=hares, [6]=notes
  if (cells.length < 6) return null;

  const dateText = cells[1]?.trim() ?? "";
  if (!dateText) return null;

  // Handle date ranges like "3–5 July 2026" — take the first date
  const normalizedDate = dateText.replace(/\u2013/g, "-").replace(/&ndash;/g, "-");
  const rangeMatch = normalizedDate.match(/^(\d+)\s*-\s*\d+\s+(.+)/);
  const dateToParse = rangeMatch ? `${rangeMatch[1]} ${rangeMatch[2]}` : normalizedDate;

  const date = chronoParseDate(dateToParse, "en-GB");
  if (!date) return null;

  // Time (24h format like "19:30")
  const timeText = cells[2]?.trim();
  let startTime: string | undefined;
  if (timeText && /^\d{1,2}:\d{2}$/.test(timeText)) {
    const [h, m] = timeText.split(":").map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      startTime = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
  }

  // Hash name + run number from column 3: "Dublin H3 #1668" or "I ♥ Monday #410"
  const hashText = cells[3]?.trim() ?? "";
  const kennelCode = routeDublinRow(hashText);
  if (!kennelCode) return null;
  const runMatch = hashText.match(/#(\d+)/);
  const runNumber = runMatch ? parseInt(runMatch[1], 10) : undefined;

  // Build title from hash text, cleaning up whitespace
  const title = hashText.replace(/\s+/g, " ").trim() || undefined;

  // Location text + Google Maps URL.
  // Some archive rows leak a truncated Dublin postal-code fragment (e.g. ", D")
  // because the source cell wraps after "Dublin, " — trim trailing 1–2 letter
  // fragments that follow a comma so we don't store ", D" as part of the location.
  const location = stripTruncatedPostalFragment(cells[4]?.trim() || undefined);
  const locationUrl = hrefs[4] || undefined;

  // Hares
  const haresText = cells[5]?.trim();
  const hares = haresText && !/^tbd$/i.test(haresText) ? haresText : undefined;

  // Source URL from detail page link
  const detailHref = hrefs[3];
  const eventSourceUrl = detailHref
    ? new URL(detailHref, sourceUrl).href
    : sourceUrl;

  // Notes (on-on venue) in column 6
  const notes = cells[6]?.trim() || undefined;
  const description = notes || undefined;

  return {
    date,
    kennelTags: [kennelCode],
    title,
    hares,
    location,
    locationUrl,
    startTime,
    runNumber,
    sourceUrl: eventSourceUrl,
    description,
  };
}

export class DublinHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://dublinhhh.com/archive";

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days);

    const rows = $("table tr");
    let skippedRows = 0;

    rows.each((i, el) => {
      const $row = $(el);
      // Skip header row (has <th> elements)
      if ($row.find("th").length > 0) return;

      try {
        const cells: string[] = [];
        const hrefs: (string | undefined)[] = [];

        $row.find("td").each((_j, td) => {
          const $td = $(td);
          // Replace <br> with space for clean text
          $td.find("br").replaceWith(" ");
          cells.push($td.text().trim());
          // Extract first <a> href if present
          const href = $td.find("a").first().attr("href");
          hrefs.push(href || undefined);
        });

        // Non-trails and other clubs' trails are dropped on purpose (#2759).
        if (cells.length > 3 && routeDublinRow(cells[3]) === null) {
          skippedRows++;
          return;
        }
        const event = parseHarelineRow(cells, hrefs, sourceUrl);
        if (event) {
          // Filter by date window (archive page has all historical events)
          const eventDate = new Date(event.date + "T12:00:00Z");
          if (eventDate < minDate || eventDate > maxDate) return;
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: i,
          section: "hareline",
          error: String(err),
          rawText: $row.text().trim().slice(0, 2000),
        });
      }
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        rowsFound: rows.length,
        eventsParsed: events.length,
        skippedRows,
        fetchDurationMs,
      },
    };
  }
}
