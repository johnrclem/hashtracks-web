/**
 * Quorn H3 (East Midlands, England) run-log scraper
 *
 * quornh3.org.uk's run list (runlog.html) is a JS shell that fetches a per-year
 * XML file and renders it client-side, so this adapter reads the XML directly:
 *   http://www.quornh3.org.uk/runlog<YYYY>.xml
 * One <run> element per run with child tags number, hares, pubname, place,
 * date, month, year, time, postcod, info. Month/day are not reliably
 * zero-padded across years. Placeholder values are "tba" (any case) and
 * "***CANCELLED***"; run number "0000"/blank marks a non-run placeholder.
 *
 * The adapter fetches the current year's file plus next year's (a 404 there is
 * the normal state until the club publishes it) and dedups by run number, as a
 * file can forward-list next January's run.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, buildDateWindow } from "../utils";

const KENNEL_TAG = "quorn-h3";
const DEFAULT_URL = "http://www.quornh3.org.uk/runlog.html"; // NOSONAR — site is HTTP-only (no TLS)
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
/** Site-wide strapline the club pastes into <info> when a run has no notes yet. */
const BOILERPLATE_INFO_PREFIX = "running/walking for fun in the";

function value(text: string | undefined): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t || t === "_" || t === "-") return undefined;
  const lower = t.toLowerCase();
  if (lower === "tba" || lower === "tbc" || lower.includes("cancelled")) return undefined;
  return t;
}

/** The per-year XML URL on the source's origin. */
export function runlogUrl(sourceUrl: string, year: number): string {
  return new URL(`/runlog${year}.xml`, sourceUrl).toString();
}

/** Parse a runlog XML document into RawEventData (placeholder/invalid runs skipped). */
export function parseQuornRunlog(xml: string, sourceUrl: string): RawEventData[] {
  const $ = cheerio.load(xml, { xml: true });
  const events: RawEventData[] = [];
  $("run").each((_i, el) => {
    const field = (tag: string) => $(el).children(tag).first().text();
    const runNumber = Number.parseInt(field("number").trim(), 10);
    if (!Number.isFinite(runNumber) || runNumber <= 0) return;

    const year = Number.parseInt(field("year"), 10);
    const month = Number.parseInt(field("month"), 10);
    const day = Number.parseInt(field("date"), 10);
    const d = new Date(Date.UTC(year, month - 1, day, 12));
    if (!Number.isFinite(d.getTime()) || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return;
    const date = d.toISOString().slice(0, 10);

    const time = TIME_RE.exec(field("time").trim());
    const pub = value(field("pubname"));
    const place = value(field("place"));
    const postcode = value(field("postcod"));
    const street = [place, postcode].filter(Boolean).join(", ");
    const info = value(field("info"));

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      startTime: time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined,
      hares: value(field("hares")),
      location: pub ?? (street || undefined),
      locationStreet: pub && street ? street : undefined,
      description: info && !info.toLowerCase().startsWith(BOILERPLATE_INFO_PREFIX) ? info : undefined,
      sourceUrl,
    });
  });
  return events;
}

export class QuornH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const base = source.url || DEFAULT_URL;
    let year = new Date().getUTCFullYear();
    let currentUrl = runlogUrl(base, year);
    let current = await fetchHTMLPage(currentUrl);
    // Early January, before the club publishes the new year's file: fall back
    // to last year's (its trailing runs are still in the scrape window).
    if (!current.ok && current.result.errorDetails?.fetch?.[0]?.status === 404) {
      year -= 1;
      currentUrl = runlogUrl(base, year);
      current = await fetchHTMLPage(currentUrl);
    }
    if (!current.ok) return current.result;
    const { structureHash, fetchDurationMs } = current;

    const byRun = new Map<number, RawEventData>();
    for (const e of parseQuornRunlog(current.html, currentUrl)) byRun.set(e.runNumber!, e);

    // Next year's file 404s until published — expected, not an error.
    const nextUrl = runlogUrl(base, year + 1);
    const next = await fetchHTMLPage(nextUrl);
    let nextYearRuns = 0;
    if (next.ok) {
      for (const e of parseQuornRunlog(next.html, nextUrl)) {
        nextYearRuns++;
        if (!byRun.has(e.runNumber!)) byRun.set(e.runNumber!, e);
      }
    }

    const parsed = [...byRun.values()];
    if (parsed.length === 0) {
      return {
        events: [],
        errors: [`Quorn H3: 0 runs parsed from ${currentUrl} — schema drift`],
        structureHash,
        diagnosticContext: { fetchDurationMs },
      };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);
    const events = parsed.filter((e) => {
      const d = new Date(`${e.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });

    return {
      events,
      errors: [],
      structureHash,
      diagnosticContext: {
        runsParsed: parsed.length,
        nextYearFile: next.ok ? `found (${nextYearRuns} runs)` : "not published",
        eventsInWindow: events.length,
        fetchDurationMs,
      },
    };
  }
}
