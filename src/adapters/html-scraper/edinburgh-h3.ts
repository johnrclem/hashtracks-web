/**
 * Edinburgh Hash House Harriers (EH3) HTML Scraper
 *
 * Scrapes edinburghh3.com/eh3-hareline.html for upcoming runs.
 * The site is Weebly-hosted with labeled text blocks for each run:
 *
 *   Run No. 2302
 *   Date 22nd March 2026
 *   Hares Rugrat & Hairspray
 *   Venue Holyrood Park, Meadowbank car park (EH8 7AT)
 *   Time 11:00
 *   Location (w3w): https://w3w.co/scam.spark.sample
 *   Directions Take a No. 4, 5, 26 or 44 Lothian bus...
 *   ON INN: The Bellfield Brewery.
 *
 * Runs are separated by "Run No." boundaries.
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, fetchHTMLPage, buildDateWindow, stripPlaceholder, decodeEntities } from "../utils";

/** Parsed fields from a single run block. */
export interface ParsedRun {
  runNumber?: number;
  date?: string; // YYYY-MM-DD
  hares?: string;
  location?: string;
  startTime?: string; // HH:MM
  onInn?: string;
  locationW3W?: string;
  directions?: string;
}

/** Match the start of any known Edinburgh field label. Order matters: longer
 *  labels (`Location (w3w)`) come before shorter prefixes (`Location`) so the
 *  alternation captures the full label. */
const LABEL_RE =
  /^(Run\s+No\.?|Date|Hares?|Venue|Time|Location\s*\(w3w\)|Directions?|ON\s+INN)\s*:?\s*(.*)$/i; // NOSONAR — anchored ^...$, alternation of literal labels, bounded \s* between literals

type LabelKey = "run" | "date" | "hares" | "venue" | "time" | "w3w" | "directions" | "onInn";

function classifyLabel(label: string): LabelKey | null {
  const l = label.toLowerCase();
  if (/^run\s+no/.test(l)) return "run";
  if (l === "date") return "date";
  if (/^hares?$/.test(l)) return "hares";
  if (l === "venue") return "venue";
  if (l === "time") return "time";
  if (/^location\s*\(w3w\)/.test(l)) return "w3w";
  if (/^directions?$/.test(l)) return "directions";
  if (/^on\s+inn$/.test(l)) return "onInn";
  return null;
}

/**
 * Parse a single run text block into structured fields.
 * Returns null if the block has no parseable date.
 *
 * Two-pass section-spanning parser (#1107): pass 1 scans line-by-line and
 * records the index + label + first-line value for every line that matches
 * a known label. Pass 2 walks consecutive label entries and folds any
 * intervening continuation lines (no-label lines like the second sentence of
 * Directions) into the previous section's value. The first hare-label match
 * wins so an "ON INN" body that incidentally starts with "Hare will provide
 * soup…" can't overwrite the real hare names (legacy #659 guard).
 *
 * Exported for unit testing.
 */
export function parseRunBlock(block: string): ParsedRun | null {
  const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // Pass 1: identify label-start lines and their first-line values.
  const segments: Array<{ idx: number; key: LabelKey; value: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LABEL_RE.exec(lines[i]);
    if (!m) continue;
    const key = classifyLabel(m[1]);
    if (!key) continue;
    segments.push({ idx: i, key, value: m[2].trim() });
  }

  // Pass 2: fold continuation lines (between consecutive label-start lines)
  // into the previous segment's value, joined with a space.
  for (let s = 0; s < segments.length; s++) {
    const start = segments[s].idx + 1;
    const end = s + 1 < segments.length ? segments[s + 1].idx : lines.length;
    if (end > start) {
      const tail = lines.slice(start, end).join(" ").trim();
      segments[s].value = (segments[s].value + " " + tail).trim();
    }
  }

  const result: ParsedRun = {};
  for (const seg of segments) {
    if (!seg.value && seg.key !== "run") continue;
    if (seg.key === "run") {
      const num = parseInt(seg.value, 10);
      if (!Number.isNaN(num)) result.runNumber = num;
    } else if (seg.key === "date") {
      const parsed = chronoParseDate(seg.value, "en-GB");
      if (parsed) result.date = parsed;
    } else if (seg.key === "hares") {
      // First hare match wins (#659): an "ON INN" body that says "Hare will
      // provide soup…" must not overwrite real hare names.
      if (!result.hares) {
        const hares = stripPlaceholder(seg.value);
        if (hares) result.hares = hares;
      }
    } else if (seg.key === "venue") {
      const venue = stripPlaceholder(seg.value);
      if (venue) result.location = venue;
    } else if (seg.key === "time") {
      const tm = /^(\d{1,2}):(\d{2})/.exec(seg.value);
      if (tm) {
        const h = Number(tm[1]); const mn = Number(tm[2]);
        if (h >= 0 && h <= 23 && mn >= 0 && mn <= 59) {
          result.startTime = `${h.toString().padStart(2, "0")}:${mn.toString().padStart(2, "0")}`;
        }
      }
    } else if (seg.key === "w3w") {
      result.locationW3W = seg.value;
    } else if (seg.key === "directions") {
      result.directions = seg.value;
    } else if (seg.key === "onInn") {
      const onInn = stripPlaceholder(seg.value);
      if (onInn) result.onInn = onInn;
    }
  }

  // Must have a date to be useful
  if (!result.date) return null;

  return result;
}

/**
 * Split full page text into run blocks and parse each one.
 * Exported for unit testing.
 */
export function parseEdinburghRuns(text: string): ParsedRun[] {
  // Split on "Run No." boundaries — each block starts with "Run No."
  const blocks = text.split(/(?=Run\s+No\.?\s*\d)/i);

  const runs: ParsedRun[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const parsed = parseRunBlock(block);
    if (parsed) runs.push(parsed);
  }

  return runs;
}

/**
 * Extract text from a Weebly h2 element's innerHTML, converting `<br>` to `\n`.
 * Collapses all whitespace first (so only `<br>` produces line breaks), inserts
 * spaces after inline closing tags, strips HTML, and cleans punctuation artifacts.
 */
export function extractWeeblyBlockText(innerHtml: string): string {
  let html = innerHtml.replaceAll(/\s+/g, " ");
  html = html.replaceAll(/<\/(span|strong|font|a|em|b|i|p|div)>/gi, "</$1> ");
  html = html.replaceAll(/<br\s*\/?>/gi, "\n");
  html = html.replaceAll(/<[^>]+>/g, "");
  return decodeEntities(html)
    .split("\n")
    .map((line) => line.replaceAll(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim())
    .join("\n");
}

export class EdinburghH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://edinburghh3.com/eh3-hareline.html";

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 90);

    try {
      // Parse each <h2 class="wsite-content-title"> as a run block.
      // Weebly renders fields inside <strong> with <br> for line breaks.
      // extractWeeblyBlockText() converts innerHTML to parseable per-line text.
      const h2s = $("h2.wsite-content-title");
      const runs: ParsedRun[] = [];
      h2s.each((_, el) => {
        const innerHtml = $(el).html() ?? "";
        const blockText = extractWeeblyBlockText(innerHtml);
        const parsed = parseRunBlock(blockText);
        if (parsed) runs.push(parsed);
      });

      for (const run of runs) {
        if (!run.date) continue;

        // Filter by date window
        const eventDate = new Date(run.date + "T12:00:00Z");
        if (eventDate < minDate || eventDate > maxDate) continue;

        // Build description from ON INN + directions
        const descParts: string[] = [];
        if (run.onInn) descParts.push(`ON INN: ${run.onInn}`);
        if (run.directions) descParts.push(`Directions: ${run.directions}`);
        const description = descParts.length > 0 ? descParts.join("\n") : undefined;

        // Build title
        const title = run.runNumber ? `Edinburgh H3 #${run.runNumber}` : "Edinburgh H3";

        events.push({
          date: run.date,
          kennelTags: ["Edinburgh H3"],
          runNumber: run.runNumber,
          title,
          hares: run.hares,
          location: run.location,
          locationUrl: run.locationW3W,
          startTime: run.startTime,
          sourceUrl,
          description,
        });
      }
    } catch (err) {
      errors.push(`Parse error: ${err}`);
      (errorDetails.parse ??= []).push({
        row: 0,
        section: "hareline",
        error: String(err),
        rawText: $("body").text().slice(0, 2000),
      });
    }

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
