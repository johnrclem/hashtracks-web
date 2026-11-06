import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { applyDateWindow, decodeEntities, fetchHTMLPage, MONTHS, stripHtmlTags } from "../utils";

const KENNEL_TAG = "h5-gb";
const DEFAULT_URL = "https://www.h5hashers.org.uk/hareline.php";
const SUNDAY_START = "11:00";
const BANK_HOLIDAY_MONDAY_START = "16:00";

/** `Sun 08 Nov 26` */
const DATE_RE = /^[A-Za-z]{3} (\d{1,2}) ([A-Za-z]{3}) (\d{2})$/;
/** streetmap.co.uk query (`?x=496362&y=224091`) — OS grid easting/northing, not lat/lng. */
const MAPLINK_RE = /^\?x=\d+&y=\d+$/i;

export interface H5Run {
  runno: string;
  date: string;
  hares: string;
  town: string;
  pub: string;
  postcode: string;
  maplink: string;
}

function isH5Run(value: unknown): value is H5Run {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return ["runno", "date", "hares", "town", "pub", "postcode", "maplink"].every((k) => typeof row[k] === "string");
}

/**
 * Pull the inline `runData = [...]` array out of hareline.php. The page builds
 * its table client-side from this JSON island; the server HTML has no rows.
 * Returns null when the island is missing or not an array of run objects.
 */
export function extractRunData(html: string): H5Run[] | null {
  const marker = "runData = ";
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const open = start + marker.length;
  const end = html.indexOf("];", open);
  if (html[open] !== "[" || end === -1) return null;
  try {
    const parsed: unknown = JSON.parse(html.slice(open, end + 1));
    if (!Array.isArray(parsed) || !parsed.every(isH5Run)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseH5Date(text: string): string | null {
  const m = DATE_RE.exec(text.trim());
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number.parseInt(m[1], 10);
  const d = new Date(Date.UTC(2000 + Number.parseInt(m[3], 10), month - 1, day, 12, 0, 0));
  if (d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

function cleanField(raw: string): string | undefined {
  const text = stripHtmlTags(decodeEntities(raw)).trim();
  if (!text || /^hares? (?:needed|required|wanted)$/i.test(text) || /^(?:tbc|tba|tbd)$/i.test(text)) return undefined;
  return text;
}

/** One `runData` row → event. Sundays start 11:00; Bank Holiday Mondays 16:00. */
export function toEvent(run: H5Run, sourceUrl: string): RawEventData | null {
  const date = parseH5Date(run.date);
  const runNumber = Number.parseInt(run.runno, 10);
  if (!date || !Number.isFinite(runNumber)) return null;
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  let startTime: string | undefined;
  if (dow === 0) startTime = SUNDAY_START;
  else if (dow === 1) startTime = BANK_HOLIDAY_MONDAY_START;

  const pub = cleanField(run.pub);
  const town = cleanField(run.town);
  const postcode = cleanField(run.postcode);
  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    startTime,
    hares: cleanField(run.hares),
    location: pub ?? town,
    locationStreet: [pub ? town : undefined, postcode].filter(Boolean).join(", ") || undefined,
    locationUrl: MAPLINK_RE.test(run.maplink) ? `https://streetmap.co.uk/map.srf${run.maplink}` : undefined,
    sourceUrl,
  };
}

/**
 * H5 Hare & Hounds H3 (Bedford / North Herts) — weekly Sunday 11:00, Bank
 * Holiday Mondays 16:00. hareline.php renders its forward hareline from an
 * inline `runData` JSON array (run #, date, hares, town, pub, postcode,
 * streetmap OS-grid link), so a plain fetch suffices — no browser render.
 * Forward-only → the source needs `upcomingOnly`.
 */
export class H5HareHoundsAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    const runs = extractRunData(html);
    const errors: string[] = [];
    const events: RawEventData[] = [];
    if (runs === null) {
      errors.push("H5 Hare & Hounds: inline runData array not found or malformed — page format may have changed");
    } else {
      for (const run of runs) {
        const event = toEvent(run, url);
        if (event) events.push(event);
      }
      if (events.length === 0 && runs.length > 0) {
        errors.push(`H5 Hare & Hounds: ${runs.length} runData rows but 0 parsed — date format may have changed`);
      }
    }

    const result: ScrapeResult = {
      events,
      errors,
      structureHash,
      diagnosticContext: { fetchDurationMs, runDataRows: runs?.length ?? 0, eventsParsed: events.length },
    };
    return applyDateWindow(result, options?.days ?? source.scrapeDays ?? 120);
  }
}
