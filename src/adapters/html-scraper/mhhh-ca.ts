/**
 * Montreal Hash House Harriers (MH3) — mhhh.ca HTML scraper.
 *
 * mhhh.ca is hand-edited static HTML (FrontPage-era markup, ISO-8859). The
 * upcoming hareline at `/index.htm` carries per-event fields under stable
 * HTML-comment anchors:
 *
 *     <!--RunNumber --><b> RUN #1684</b>
 *     <!--RunTitle-->                       (optional theme)
 *     <!--DateTimeCost -->May 3, 2026&nbsp;13h00 $13
 *     <!--HaresList -->Broken Thong
 *     <!--Location -->Sainte-Marie <a href="https://www.meetup.com/...">…</a>
 *
 * Issue #1660: Meetup returns "Location not specified yet" for many upcoming
 * mh3-ca events because the organizers fill mhhh.ca first. This adapter pulls
 * the neighborhood + hares directly and ships at trustLevel 9 (above the
 * Meetup source's 7) so it wins on conflicting fields. Cross-source dedup
 * happens via (kennelTag, date, runNumber) fingerprint in the merge pipeline.
 *
 * Hareline detail pages (`/trash/YYYY/trashNNN.htm`) and the year-indexed
 * archive (`/trash/YYYY/index.html`) are NOT touched here — historical backfill
 * is `scripts/backfill-mh3-ca-history.ts` instead, so the cron stays cheap.
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, fetchHTMLPage, buildDateWindow } from "../utils";

const KENNEL_TAG = "mh3-ca";

/**
 * Parse "May 3, 2026 13h00 $13" (with optional time and cost) into structured
 * fields. The 24-hour `13h00` notation is Québec convention; time and cost are
 * both optional — the hareline occasionally lists date-only "TBD" rows.
 *
 * Returns null when no date can be extracted (the event is unusable downstream).
 */
export function parseDateTimeCost(raw: string): {
  date: string;
  startTime?: string;
  cost?: string;
} | null {
  const cleaned = raw.replace(/&nbsp;/gi, " ").replace(/ /g, " ").trim();
  if (!cleaned) return null;

  // Extract & strip the time ("13h00") so chrono doesn't choke on the `h`.
  let timeRest = cleaned;
  let startTime: string | undefined;
  const timeMatch = cleaned.match(/\b(\d{1,2})\s*h\s*(\d{2})\b/i);
  if (timeMatch) {
    const h = parseInt(timeMatch[1], 10);
    const m = parseInt(timeMatch[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      startTime = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
    timeRest = cleaned.replace(timeMatch[0], " ").trim();
  }

  // Extract & strip the cost ($13 / $13.50 / $13 cash).
  let dateRest = timeRest;
  let cost: string | undefined;
  const costMatch = timeRest.match(/\$\d+(?:\.\d{2})?(?:\s*(?:cash|cad|usd)\b)?/i);
  if (costMatch) {
    cost = costMatch[0].trim();
    dateRest = timeRest.replace(costMatch[0], " ").trim();
  }

  const date = chronoParseDate(dateRest);
  if (!date) return null;

  return { date, startTime, cost };
}

/**
 * Split a "Hare1; Hare2; Just Raia" cell into a sorted comma-joined string.
 * Sorting before join is required for stable fingerprints across scrapes —
 * see `feedback_fingerprint_stability.md` (Seletar duplicated 74 RawEvents
 * because hare order was nondeterministic).
 *
 * Recognized placeholders ("TBD", "Hare needed", etc.) collapse to undefined
 * so canonical Event.haresText doesn't end up storing the prompt as a name.
 */
export function parseHaresField(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/&nbsp;/gi, " ").trim();
  if (!cleaned) return undefined;
  if (/^(?:tbd|tba|tbc|hare(?:s)?\s+needed|hare(?:s)?\s+required)\??$/i.test(cleaned)) {
    return undefined;
  }
  const parts = cleaned
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return undefined;
  parts.sort((a, b) => a.localeCompare(b, "en"));
  return parts.join(", ");
}

/**
 * Strip the `Click for directions` link text from a Location cell so we keep
 * just the neighborhood ("Sainte-Marie", "Plateau Mont-Royal"). Apply the
 * standard TBD-omit guard so placeholders don't surface on the UI.
 */
export function parseLocationField(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/&nbsp;/gi, " ")
    .replace(/click\s+for\s+directions/i, "")
    .trim();
  if (!cleaned) return undefined;
  if (/^(?:tbd|tba|tbc)\.?$/i.test(cleaned)) return undefined;
  return cleaned;
}

/**
 * Split the hareline HTML into per-event chunks on the <!--RunNumber-->
 * boundary and parse each. Exported for unit tests.
 *
 * Per-event `sourceUrl` prefers the Meetup event URL from the location cell
 * when present (helps the merge pipeline correlate against the MEETUP source),
 * otherwise falls back to the mhhh.ca page itself.
 */
export function parseMhhhHareline(html: string, sourceUrl: string): RawEventData[] {
  const events: RawEventData[] = [];
  // The first segment before the first <!--RunNumber--> marker is page chrome.
  const chunks = html.split(/<!--\s*RunNumber\s*-->/i).slice(1);

  for (const chunk of chunks) {
    const runMatch = chunk.match(/RUN\s*#\s*(\d+)/i);
    if (!runMatch) continue;
    const runNumber = parseInt(runMatch[1], 10);
    if (!Number.isFinite(runNumber) || runNumber <= 0) continue;

    const dtcMatch = chunk.match(/<!--\s*DateTimeCost\s*-->([^<]*)/i);
    if (!dtcMatch) continue;
    const dtc = parseDateTimeCost(dtcMatch[1]);
    if (!dtc) continue;

    const haresMatch = chunk.match(/<!--\s*HaresList\s*-->([^<]*)/i);
    const hares = parseHaresField(haresMatch?.[1]);

    const locMatch = chunk.match(/<!--\s*Location\s*-->([\s\S]*?)<\/td>/i);
    // Strip the `Click for directions` <a> from the Location cell before parsing.
    const locText = locMatch
      ? locMatch[1].replace(/<a\b[\s\S]*?<\/a>/gi, "").trim()
      : undefined;
    const location = parseLocationField(locText);

    // Prefer the Meetup event URL embedded in the directions link; other hrefs
    // (e.g. Google Maps) are ignored so we always fall back to mhhh.ca itself.
    const meetupHrefMatch = locMatch?.[1].match(
      /href="(https?:\/\/(?:www\.)?meetup\.com\/[^"]+)"/i,
    );
    const eventSourceUrl = meetupHrefMatch?.[1] ?? sourceUrl;

    events.push({
      date: dtc.date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      startTime: dtc.startTime,
      cost: dtc.cost,
      hares,
      location,
      sourceUrl: eventSourceUrl,
    });
  }

  return events;
}

export class MhhhCaAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || "https://mhhh.ca/";

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    const errorDetails: ErrorDetails = {};
    const errors: string[] = [];
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 60);

    let parsed: RawEventData[] = [];
    try {
      parsed = parseMhhhHareline(html, sourceUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`mhhh.ca hareline parse failed: ${message}`);
      (errorDetails.parse ??= []).push({
        row: 0,
        section: "hareline",
        error: message,
      });
    }

    // Drop anything outside the lookback window — adapter is current/future
    // only; the historical archive is handled by the one-shot backfill script.
    const events = parsed.filter((ev) => {
      const t = new Date(`${ev.date}T12:00:00Z`).getTime();
      return t >= minDate.getTime() && t <= maxDate.getTime();
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        chunksParsed: parsed.length,
        eventsAfterWindow: events.length,
        fetchDurationMs,
      },
    };
  }
}
