import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  fetchHTMLPage,
  normalizeHaresField,
  stripHtmlTags,
} from "../utils";

/**
 * Pattaya Hash House Harriers (PH3) adapter.
 *
 * pattayah3.com/PH3/php/HareLine/HareLine.php is a PHP-generated hareline page.
 * It uses a two-column table where each row has:
 *   - Left cell: "DD Mon YYYY - Run NNNN" (date + run number)
 *   - Right cell: labeled fields "Hares:", "Theme:", "On On Bar:", "A-Site:"
 *
 * The table also has month heading rows spanning both columns.
 * Rows needing hares show "Hares Required" in red.
 *
 * Weekly Monday runs at 15:00, departing from Buffalo Bar on 3rd Road.
 */

const KENNEL_TAG = "pattaya-h3";
const DEFAULT_START_TIME = "15:00"; // buses depart at 15:00, circle at 16:00

/**
 * Parse a hareline row from the Pattaya H3 page.
 * Left cell contains the date+run, right cell has the labeled details.
 *
 * Exported for unit testing.
 */
export function parsePattayaRow(
  leftText: string,
  rightText: string,
  sourceUrl: string,
): RawEventData | null {
  const left = decodeEntities(leftText).trim();
  const right = decodeEntities(rightText).trim();

  // Parse "DD Mon YYYY - Run NNNN" from left cell
  const runMatch = /Run\s+(\d+)/i.exec(left);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  // Parse date from left cell — everything before "- Run"
  const datePart = left.replace(/-?\s*Run\s+\d+.*/i, "").trim();
  const date = chronoParseDate(datePart, "en-GB");
  if (!date) return null;

  // Parse labeled fields from right cell
  const grab = (label: string): string | undefined => {
    const re = new RegExp(`${label}:\\s*(.+?)(?=\\n|Hares?:|Theme:|On On Bar:|A-Site:|Sunset|$)`, "is");
    const m = re.exec(right);
    if (!m) return undefined;
    const val = m[1].trim();
    return val || undefined;
  };

  const haresRaw = grab("Hares?");
  const hares = haresRaw && !/Hares?\s*Required/i.test(haresRaw)
    ? normalizeHaresField(haresRaw)
    : undefined;

  const theme = grab("Theme");
  const onOnBar = grab("On On Bar");
  const aSiteRaw = grab("A-Site");

  let location: string | undefined;
  let locationUrl: string | undefined;
  if (aSiteRaw) {
    // A-Site may contain GPS coordinates link
    const gpsMatch = /\(([0-9.-]+),\s*([0-9.-]+)/.exec(aSiteRaw);
    if (gpsMatch) {
      const lat = gpsMatch[1];
      const lng = gpsMatch[2];
      locationUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }
    // Clean up: strip "A-Site Location Needed" placeholder
    const cleaned = aSiteRaw
      .replace(/A-Site Location Needed/i, "")
      .replace(/\([\d.]+,\s*[\d.]+.*?\)/g, "")
      .trim();
    if (cleaned && !/^A-Site Location Needed$/i.test(cleaned)) {
      location = cleaned;
    }
  }

  const title = theme ? `PH3 Run #${runNumber}: ${theme}` : undefined;

  return {
    date,
    kennelTag: KENNEL_TAG,
    runNumber,
    title,
    hares,
    location,
    locationUrl,
    startTime: DEFAULT_START_TIME,
    sourceUrl,
  };
}

export class PattayaH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.pattayah3.com/PH3/php/HareLine/HareLine.php";

    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Parse the hareline table
    const rows = $("table.hareline_run_info tr").toArray();
    let rowsParsed = 0;

    for (let i = 0; i < rows.length; i++) {
      const $row = $(rows[i]);

      // Skip month heading rows (class="hareline_month_heading" or td[colspan])
      if ($row.hasClass("hareline_month_heading") || $row.find("td[colspan]").length > 0) {
        continue;
      }

      const cells = $row.find("td");
      if (cells.length < 2) continue;

      const leftHtml = cells.eq(0).html() ?? "";
      const rightHtml = cells.eq(1).html() ?? "";
      const leftText = stripHtmlTags(leftHtml, "\n");
      const rightText = stripHtmlTags(rightHtml, "\n");

      try {
        const event = parsePattayaRow(leftText, rightText, baseUrl);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing row ${i}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: "hareline", error: String(err), rawText: `${leftText} | ${rightText}`.slice(0, 2000) },
        ];
      }
      rowsParsed++;
    }

    if (events.length === 0 && errors.length === 0) {
      errors.push("PattayaH3: zero events parsed from hareline table");
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
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
