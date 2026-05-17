import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { buildDateWindow, configString, fetchBrowserRenderedPage } from "../utils";

/**
 * Shared scaffolding for sporty.co.nz CMS subsites (Capital H3, Mooloo HHH,
 * etc.). Sporty pages all share the same Cloudflare Bot Fight Mode posture,
 * the same `.cms-nav-link` readiness anchor, and the same NZ timezone — and
 * the per-adapter logic is just "find the rows, parse each one". This helper
 * centralises the browser-render call, the date-window + error bookkeeping,
 * and the per-row try/catch so each kennel adapter only ships its layout
 * specifics (selector, parser, fail-closed guard).
 */

const SPORTY_TIMEZONE = "Pacific/Auckland";
const SPORTY_RENDER_TIMEOUT_MS = 25_000;
const SPORTY_BASE_READY_SELECTOR = ".cms-nav-link";

export interface SportyAdapterConfig {
  /** Default kennel tag when `source.config.kennelTag` is missing. */
  defaultKennelTag: string;
  /** Layout-specific readiness selector (joined with `.cms-nav-link`). */
  contentSelector: string;
  /** Section label for parseError entries. */
  section: string;
  /**
   * Returns the raw text rows to parse, plus an optional fail-closed message
   * if the expected container is absent (so reconciliation doesn't cancel
   * live events on a clean-but-empty scrape).
   */
  collect: ($: CheerioAPI) => { rows: string[]; missingContainer: string | null };
  /** Parse one raw row into a RawEventData, or null if it isn't a run row. */
  parse: (
    text: string,
    opts: { sourceUrl: string; kennelTag: string },
  ) => RawEventData | null;
}

/**
 * Drive a sporty.co.nz-hosted source: fetch via the stealth browser-render
 * service, collect rows via the adapter-supplied selector, run them through
 * the adapter's parser, and emit a standard ScrapeResult. Dedupes by
 * `(date, runNumber)` because sporty pages frequently mirror the same line
 * in both `<p>` and `<p><b>...</b></p>`.
 */
export async function runSportyAdapter(
  source: Source,
  options: { days?: number } | undefined,
  cfg: SportyAdapterConfig,
): Promise<ScrapeResult> {
  const sourceUrl = source.url;
  const kennelTag = configString(source.config, "kennelTag", cfg.defaultKennelTag);

  const page = await fetchBrowserRenderedPage(sourceUrl, {
    waitFor: `${SPORTY_BASE_READY_SELECTOR}, ${cfg.contentSelector}`,
    timeout: SPORTY_RENDER_TIMEOUT_MS,
    timezoneId: SPORTY_TIMEZONE,
  });
  if (!page.ok) return page.result;
  const { $, structureHash, fetchDurationMs } = page;

  const events: RawEventData[] = [];
  const errors: string[] = [];
  const errorDetails: ErrorDetails = {};
  const parseErrors: NonNullable<ErrorDetails["parse"]> = [];
  const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);

  const { rows, missingContainer } = cfg.collect($);
  if (missingContainer) errors.push(missingContainer);

  const seen = new Set<string>();
  let rowsConsidered = 0;
  let i = 0;
  for (const text of rows) {
    rowsConsidered += 1;
    try {
      const event = cfg.parse(text, { sourceUrl, kennelTag });
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
        section: cfg.section,
        error: String(err),
        rawText: text.slice(0, 500),
      });
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
