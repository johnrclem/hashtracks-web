import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { filterEventsByWindow, parse12HourTime } from "../utils";
import { safeFetch } from "../safe-fetch";

/**
 * North County Hash (NCH3) official microsite scraper — nch3.com (#1765).
 *
 * The site is a PHP/MySQL "current run" page: it always renders exactly ONE
 * event (the latest row, `ORDER BY id DESC LIMIT 1`) inside a single
 * `<p class="notes">` block of `<strong>Label:</strong> value<br>` pairs:
 *
 *   <strong>Run Number:</strong> 1920<br>
 *   <strong>Saturday,</strong> 5/23/26 10:00am<br>     ← weekday label, date value
 *   <strong>Name: </strong> Memorial Day Beach and Cliffs Run<br>
 *   <strong>Hare(s):</strong> TNT, Comes and Goes, ...<br>
 *   <strong>Location: </strong> Eucalyptus Grove ... <a href="https://maps...">Google Map</a><br>
 *   <strong>Run Fee: $</strong> $8 cash only<br>
 *   <strong>Trail type: </strong>A to A<br>
 *   <strong>Dog friendly: </strong>On In Only<br>
 *   <strong>Notes: </strong>Happy Memorial Day weekend! ...
 *
 * This is a SUPPLEMENTAL source: NCH3 is primarily tracked via the SDH3
 * hareline (which carries richer enumeration). The microsite adds fields the
 * hareline lacks (hares, location, cost, trail type) for the current run. The
 * seed marks it `config.upcomingOnly: true` so reconcile never cancels the
 * many SDH3-sourced NCH3 events this single-event page can't enumerate.
 *
 * Field labels are walked procedurally (not via `^Label:` regex) per
 * `feedback_sonar_s5852_procedural_over_regex` — anchored label captures trip
 * Sonar S5852's backtracking-shape check.
 */

const DEFAULT_URL = "https://nch3.com/";
const KENNEL_TAG = "nch3-sd";

/** Read the value after a `Label:` prefix from the flattened notes lines. */
function readLine(lines: readonly string[], label: string): string | undefined {
  const needle = `${label.toLowerCase()}:`;
  for (const raw of lines) {
    const line = raw.trimStart();
    if (line.toLowerCase().startsWith(needle)) {
      return line.slice(needle.length).trim();
    }
  }
  return undefined;
}

/** Parse a US `M/D/YY` (or `M/D/YYYY`) date to a UTC-noon `YYYY-MM-DD` string. */
function parseUsDate(text: string): string | undefined {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(text);
  if (!m) return undefined;
  const month = Number.parseInt(m[1], 10);
  const day = Number.parseInt(m[2], 10);
  let year = Number.parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // Reject overflow dates (e.g. 2/30 → Mar 2) — Date.UTC silently rolls over.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return d.toISOString().slice(0, 10);
}

/** Conservative boolean: only commit on an unambiguous yes/no prefix. The
 *  microsite's "On In Only" / "On Out Only" phrasings don't map to a boolean,
 *  so they leave the field `undefined` (preserve-existing) rather than guess. */
function parseDogFriendly(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (/^\s*yes\b/i.test(value)) return true;
  if (/^\s*no\b/i.test(value)) return false;
  return undefined;
}

/**
 * Parse the single nch3.com event. Pure function (no I/O) so the unit test can
 * exercise it against a captured fixture. Returns null when no date is found.
 */
export function parseNCH3Page(html: string, sourceUrl = DEFAULT_URL): RawEventData | null {
  const $ = cheerio.load(html);
  const $notes = $("p.notes").first();
  const scope = $notes.length > 0 ? $notes : $("#mission");
  if (scope.length === 0) return null;

  // The Location row carries the only real <a> (the B / On-After maps are HTML
  // comments, invisible to cheerio). Grab it before flattening to text.
  const locationUrl = scope.find("a[href]").first().attr("href") || undefined;

  // Flatten on <br> boundaries only. Replace <br> with a sentinel (not "\n")
  // so the page's own source-native line breaks — e.g. between the Location
  // text and its "Google Map" anchor — collapse to spaces within a field
  // rather than splitting it into two lines.
  const ROW_SEP = "\u0001";
  scope.find("br").replaceWith(ROW_SEP);
  const lines = scope
    .text()
    .split(ROW_SEP)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  const fullText = lines.join("\n");
  const date = parseUsDate(fullText);
  if (!date) return null;

  const timeMatch = fullText.match(/\d{1,2}:\d{2}\s*[ap]\.?m/i);
  const startTime = timeMatch ? parse12HourTime(timeMatch[0]) ?? undefined : undefined;

  const runNumRaw = readLine(lines, "Run Number");
  const runNumber = runNumRaw ? Number.parseInt(/\d+/.exec(runNumRaw)?.[0] ?? "", 10) : Number.NaN;

  const title = readLine(lines, "Name") || undefined;
  const hares = readLine(lines, "Hare(s)") || undefined;

  // Location value ends with the anchor text "Google Map" — strip it. Done
  // procedurally (not a `\s*…\s*$` regex) to avoid Sonar S5852.
  let location = readLine(lines, "Location") || undefined;
  if (location) {
    const idx = location.toLowerCase().lastIndexOf("google map");
    if (idx >= 0 && location.slice(idx + "google map".length).trim() === "") {
      location = location.slice(0, idx).trim();
    }
    location = location || undefined;
  }

  // "Run Fee: $" → value is "$ $8 cash only"; drop the leading bare "$".
  const feeRaw = readLine(lines, "Run Fee");
  const cost = feeRaw ? feeRaw.replace(/^\$\s*/, "").trim() || undefined : undefined;

  const trailType = readLine(lines, "Trail type") || undefined;
  const dogFriendly = parseDogFriendly(readLine(lines, "Dog friendly"));
  const description = readLine(lines, "Notes") || undefined;

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: Number.isFinite(runNumber) && runNumber > 0 ? runNumber : undefined,
    title,
    hares,
    location,
    locationUrl,
    startTime,
    cost,
    trailType,
    dogFriendly,
    description,
    sourceUrl,
  };
}

export class NCH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const errorDetails: ErrorDetails = {};

    let html: string;
    const fetchStart = Date.now();
    try {
      const response = await safeFetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [{ url, status: response.status, message }];
        return { events: [], errors: [message], errorDetails };
      }
      html = await response.text();
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [{ url, message }];
      return { events: [], errors: [message], errorDetails };
    }
    const fetchDurationMs = Date.now() - fetchStart;

    const structureHash = generateStructureHash(html);
    const errors: string[] = [];
    const events: RawEventData[] = [];

    const event = parseNCH3Page(html, url);
    if (event) {
      // Honor the scrape window so a stale current-run far outside the lookback
      // doesn't resurface (defaults to 90d; seed uses 30d).
      events.push(...filterEventsByWindow([event], options?.days ?? 90));
    } else {
      errors.push("Could not parse the current run from nch3.com (no date found).");
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: { eventsParsed: events.length, fetchDurationMs },
    };
  }
}
