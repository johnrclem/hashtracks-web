import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { chronoParseDate, parse12HourTime } from "../utils";
import { runSportyAdapter } from "./sporty-co-nz";

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
 * Cloudflare bypass + boilerplate is delegated to {@link runSportyAdapter}.
 */

// "DD Mon YYYY RUN# NNNN <body>". Tolerant of unicode dashes and
// "RUN#NNNN" / "RUN # NNNN" spacing. Trailing period stripped post-match.
const MOOLOO_RUN_LINE_RE = /^(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+RUN\s*#?\s*(\d+)\s+(.+?)\.?\s*$/; // NOSONAR S5852

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

  fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    return runSportyAdapter(source, options, {
      defaultKennelTag: "mooloo-h3",
      contentSelector: ".panel-body-text",
      section: "newsletter",
      collect: ($) => {
        // Every `<p>` is a candidate; parseMoolooRunLine() filters newsletter
        // prose by requiring the "DD Mon YYYY RUN# NNNN ..." prefix.
        const rows = $(".panel-body-text p")
          .toArray()
          .map((el) => $(el).text())
          .filter((text) => text && /RUN/i.test(text));
        return { rows, missingContainer: null };
      },
      parse: parseMoolooRunLine,
    });
  }
}
