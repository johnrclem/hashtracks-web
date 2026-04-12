import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  fetchBrowserRenderedPage,
  normalizeHaresField,
} from "../utils";

/**
 * Bangkok Hash House Harriers (BKK H3) adapter.
 *
 * bangkokhhh.org is a Wix-hosted site. Weekly Saturday runs, men only.
 * Requires browser rendering to extract event data from the Wix SPA.
 *
 * NOTE: This source is gated with `enabled: false` in seed data because
 * Wix sites require the NAS browser-render service. Enable when ready.
 */

const KENNEL_TAG = "bkk-h3";
const DEFAULT_START_TIME = "17:00";

export class BangkokH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.bangkokhhh.org";

    const page = await fetchBrowserRenderedPage(baseUrl, {
      waitFor: "body",
      timeout: 25000,
    });
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Wix sites render content dynamically. Look for common event patterns.
    // The actual selectors will need to be verified via Chrome once enabled.
    const text = decodeEntities($("body").text());

    // Try to find labeled run details
    const dateMatch = /(?:Date|Next\s*Run)\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(text);
    const date = dateMatch ? chronoParseDate(dateMatch[1], "en-GB") : null;

    if (date) {
      const hareMatch = /(?:Hare|Hares?)\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(text);
      const locationMatch = /(?:Location|Where|Start)\s*[:\-]\s*(.+?)(?:\n|$)/i.exec(text);
      const runMatch = /Run\s*#?\s*(\d+)/i.exec(text);

      events.push({
        date,
        kennelTag: KENNEL_TAG,
        runNumber: runMatch ? Number.parseInt(runMatch[1], 10) : undefined,
        hares: normalizeHaresField(hareMatch?.[1]?.trim()),
        location: locationMatch?.[1]?.trim() || undefined,
        startTime: DEFAULT_START_TIME,
        sourceUrl: baseUrl,
      });
    } else {
      errors.push("BangkokH3: could not parse date from Wix page — verify selectors via Chrome");
    }

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        structureHash,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "browser-render",
          eventsParsed: events.length,
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
