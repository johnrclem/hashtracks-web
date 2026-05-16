import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  buildDateWindow,
  chronoParseDate,
  configString,
  fetchBrowserRenderedPage,
  normalizeHaresField,
  stripPlaceholder,
} from "../utils";

/**
 * Capital Hash House Harriers (Wellington, NZ) — sporty.co.nz CMS scraper.
 *
 * Source: https://www.sporty.co.nz/capitalh3 — homepage embeds the
 * "Receding Hareline" inside a CMS `notices` panel
 * (`<div id="notices-prevContent-<moduleId>">`). Each upcoming run is a
 * `<p>` element whose text content takes the form:
 *
 *   "{RUN#} – {DD MMM YYYY} – {LOCATION} – {HARE}"
 *
 * Some rows omit the LOCATION ("Hare required!") and some omit the HARE.
 * Trailing dashes on incomplete rows are tolerated.
 *
 * sporty.co.nz is behind Cloudflare Bot Fight Mode, so we route through
 * the stealth NAS browser-render service rather than plain fetch. The
 * `waitFor` selector targets sporty's own CMS nav class, which doesn't
 * appear on the CF challenge page.
 */

// Sporty.co.nz subsite shell class — absent on the Cloudflare challenge
// page, so it's the signal that the real HTML has loaded.
const SPORTY_READY_SELECTOR = ".cms-nav-link, .panel-body-text";
const CAPITAL_RUN_LINE_RE = /^(\d+)\s*-\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*(?:-\s*(.*))?$/;

/** Parse one notices-panel `<p>` line into a RawEventData, or null if the
 *  line doesn't look like a run row. Exported for unit testing. */
export function parseCapitalRunLine(
  line: string,
  opts: { sourceUrl: string; kennelTag: string },
): RawEventData | null {
  const normalised = line.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!normalised) return null;

  const m = CAPITAL_RUN_LINE_RE.exec(normalised);
  if (!m) return null;
  const [, runStr, dateStr, restRaw] = m;

  const date = chronoParseDate(dateStr, "en-GB");
  if (!date) return null;
  const runNumber = Number.parseInt(runStr, 10);

  // Trailing dashes on placeholder rows leave empty trailing tokens; filter.
  const parts = (restRaw ?? "")
    .split(" - ")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // "Hare required!" / "TBA" / "?" → undefined so the merge pipeline's
  // atomic-bundle semantics preserve any earlier real value.
  return {
    date,
    kennelTags: [opts.kennelTag],
    runNumber: Number.isFinite(runNumber) ? runNumber : undefined,
    location: stripPlaceholder(parts[0]),
    hares: normalizeHaresField(stripPlaceholder(parts[1])),
    sourceUrl: opts.sourceUrl,
  };
}

export class CapitalH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url;
    const kennelTag = configString(source.config, "kennelTag", "capital-h3-nz");

    const page = await fetchBrowserRenderedPage(sourceUrl, {
      waitFor: SPORTY_READY_SELECTOR,
      timeout: 25_000,
      timezoneId: "Pacific/Auckland",
    });
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const parseErrors: NonNullable<ErrorDetails["parse"]> = [];
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);

    // Sporty's CMS notices module uses an opaque numeric id per kennel; match
    // on the prefix so we don't have to encode the id in config.
    const noticesPanel = $('[id^="notices-prevContent-"]');
    const noticeRows = noticesPanel.find("p").toArray();

    // Fail closed: if the panel itself is absent (CF challenge HTML slipped
    // past readiness, sporty reorganised the CMS, or render returned a
    // degraded page), surface as an error so reconciliation doesn't treat
    // the empty result as authoritative and cancel live events.
    if (noticesPanel.length === 0) {
      errors.push("Capital H3: notices-prevContent-* panel not found on page");
    }

    let rowsConsidered = 0;
    let i = 0;
    for (const el of noticeRows) {
      const text = $(el).text();
      if (text && /\d/.test(text)) {
        rowsConsidered += 1;
        try {
          const event = parseCapitalRunLine(text, { sourceUrl, kennelTag });
          if (event) {
            const eventDate = new Date(`${event.date}T12:00:00Z`);
            if (eventDate >= minDate && eventDate <= maxDate) events.push(event);
          }
        } catch (err) {
          errors.push(`Row ${i}: ${err}`);
          parseErrors.push({
            row: i,
            section: "hareline",
            error: String(err),
            rawText: text.slice(0, 500),
          });
        }
      }
      i += 1;
    }

    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rowsConsidered,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
