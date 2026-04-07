import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, buildDateWindow } from "../utils";

const DEFAULT_URL = "https://bfh3.com/";
const KENNEL_TAG = "bfh3";

/**
 * Blooming Fools H3 (Bloomington, IN) adapter.
 *
 * bfh3.com hosts a tiny static page with a year's worth of trail dates
 * embedded inside a `<bfh3-upcoming-events>` web component:
 *
 *   <bfh3-upcoming-events hour-cutoff="6" max-count="3" timezone="-04:00">
 *     <script type="text/plain">
 * 2026-01-03T19
 * 2026-01-10T15
 * 2026-01-24T15
 *     </script>
 *   </bfh3-upcoming-events>
 *
 * Each line is `YYYY-MM-DDTHH` (24-hour local time in the site's `timezone`
 * attribute). Blank lines separate months but carry no meaning for us.
 *
 * The component renders only a few events client-side, but the script block
 * contains the full list — which is perfect for us.
 */
export function parseBfh3DateList(scriptContent: string): Array<{
  date: string;
  startTime: string;
}> {
  const results: Array<{ date: string; startTime: string }> = [];
  const lines = scriptContent.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2})$/.exec(line);
    if (!match) continue;
    const [, year, month, day, hour] = match;
    results.push({
      date: `${year}-${month}-${day}`,
      startTime: `${hour.padStart(2, "0")}:00`,
    });
  }

  return results;
}

export class Bfh3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash } = page;
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Grab the <script type="text/plain"> inside <bfh3-upcoming-events>
    const scriptEl = $("bfh3-upcoming-events script[type='text/plain']").first();
    const scriptText = scriptEl.text();

    if (!scriptText.trim()) {
      errors.push("No date script found inside <bfh3-upcoming-events>");
      errorDetails.parse = [
        { row: 0, error: "Empty <script type=\"text/plain\"> inside bfh3-upcoming-events" },
      ];
      return { events: [], errors, structureHash, errorDetails };
    }

    const parsed = parseBfh3DateList(scriptText);
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);

    const events: RawEventData[] = [];
    for (const { date, startTime } of parsed) {
      // Filter by window; keep recent-past events so the merge pipeline can
      // mark them missing if they disappear later.
      const asDate = new Date(`${date}T12:00:00Z`);
      if (asDate < minDate || asDate > maxDate) continue;

      events.push({
        date,
        startTime,
        kennelTag: KENNEL_TAG,
        sourceUrl: url,
      });
    }

    const hasErrors = hasAnyErrors(errorDetails);
    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        scriptLinesFound: parsed.length,
        eventsParsed: events.length,
      },
    };
  }
}
