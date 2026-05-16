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
  parse12HourTime,
} from "../utils";

/**
 * Mooloo Hash House Harriers (Hamilton, NZ) — sporty.co.nz newsletter parser.
 *
 * Source: https://www.sporty.co.nz/mooloohhh/UpCumming-Runs
 * The page is more newsletter than structured hareline: long prose
 * paragraphs mixed with one or two explicit run lines like:
 *
 *   "25 May 2026 RUN# 1886 Tittannic's Trail from ReefUnder and Shunter's 8 Joffre St. 6PM."
 *
 * We extract every `<p>` line that matches that prefix pattern (date +
 * "RUN# NNNN" + free-form body). Run number and date drive Event identity;
 * a 12-hour time mention drives `startTime`. The remainder of the line
 * becomes the `description` so users can see venue/hare verbatim — we
 * deliberately don't try to split hares from address (the trailing prose
 * is too messy to parse reliably; the paired STATIC_SCHEDULE source
 * supplies the biweekly recurrence anyway).
 *
 * sporty.co.nz is behind Cloudflare Bot Fight Mode → route through the
 * stealth NAS browser-render service.
 */

const SPORTY_READY_SELECTOR = ".cms-nav-link, .panel-body-text";

// "DD Mon YYYY RUN# NNNN <body>". Tolerant of unicode dashes and
// "RUN#NNNN" / "RUN # NNNN" spacing. Trailing period stripped post-match.
const MOOLOO_RUN_LINE_RE = /^(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+RUN\s*#?\s*(\d+)\s+(.+?)\.?\s*$/;

/** Pull a 12-hour time out of free-form text, normalizing bare-hour forms
 *  like "6PM" / "6 pm" (which parse12HourTime requires minutes for) into
 *  "6:00 PM" first. */
function extractStartTime(text: string): string | undefined {
  const match = /(?<!\w)(\d{1,2}(?::\d{2})?\s*[ap]m)/i.exec(text);
  if (!match) return undefined;
  const raw = match[1].trim();
  const normalized = raw.includes(":") ? raw : raw.replace(/(\d{1,2})\s*([ap]m)/i, "$1:00 $2");
  return parse12HourTime(normalized);
}

/** Parse one Mooloo run-line `<p>` text into a RawEventData, or null. Exported for unit tests. */
export function parseMoolooRunLine(
  text: string,
  opts: { sourceUrl: string; kennelTag: string },
): RawEventData | null {
  const normalised = text.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!normalised) return null;

  const m = MOOLOO_RUN_LINE_RE.exec(normalised);
  if (!m) return null;
  const [, dateStr, runStr, body] = m;

  const date = chronoParseDate(dateStr, "en-GB");
  if (!date) return null;
  const runNumber = Number.parseInt(runStr, 10);

  return {
    date,
    kennelTags: [opts.kennelTag],
    runNumber: Number.isFinite(runNumber) ? runNumber : undefined,
    startTime: extractStartTime(body),
    description: body,
    sourceUrl: opts.sourceUrl,
  };
}

export class MoolooHhhAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url;
    const kennelTag = configString(source.config, "kennelTag", "mooloo-h3");

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

    // Sporty pages nest the same run line in both `<p>` and `<p><b>...</b></p>`,
    // so dedupe by `(date, runNumber)` before emitting.
    const paragraphs = $(".panel-body-text p").toArray();
    const seen = new Set<string>();
    let rowsConsidered = 0;
    let i = 0;
    for (const el of paragraphs) {
      const text = $(el).text();
      if (text && /RUN/i.test(text)) {
        rowsConsidered += 1;
        try {
          const event = parseMoolooRunLine(text, { sourceUrl, kennelTag });
          if (event) {
            const eventDate = new Date(`${event.date}T12:00:00Z`);
            const dedupKey = `${event.date}|${event.runNumber ?? ""}`;
            if (eventDate >= minDate && eventDate <= maxDate && !seen.has(dedupKey)) {
              seen.add(dedupKey);
              events.push(event);
            }
          }
        } catch (err) {
          errors.push(`Row ${i}: ${err}`);
          parseErrors.push({
            row: i,
            section: "newsletter",
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
