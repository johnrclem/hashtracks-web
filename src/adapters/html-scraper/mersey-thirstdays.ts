/**
 * Mersey Thirstdays Hash House Harriers (MTH3) HTML Scraper
 *
 * Scrapes merseythirstdayshash.com for upcoming and historical runs.
 * The site is IONOS MyWebsite (Jimdo) — static HTML, no proxy or
 * browser rendering needed.
 *
 * Two pages:
 *  1. /next-run-s/ — 7-8 upcoming runs with rich detail (venue, postcode,
 *     nearest station). Runs separated by dashed lines.
 *  2. /past-runs/ — ~597 historical runs (2006–2026). Year sections marked
 *     by ▲ YYYY ▲. Three distinct format eras.
 *
 * Biweekly Thursday at 7pm, Liverpool/Merseyside area.
 */
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import * as cheerio from "cheerio";
import {
  chronoParseDate,
  decodeEntities,
  extractUkPostcode,
  googleMapsSearchUrl,
  parse12HourTime,
  stripPlaceholder,
  buildDateWindow,
  fetchHTMLPage,
} from "../utils";

const KENNEL_TAG = "MTH3";
const DEFAULT_START_TIME = "19:00";

/** Parsed fields from a single MTH3 run. */
export interface ParsedMerseyRun {
  runNumber?: number;
  runNumberRaw?: string; // "395a", "116b" — preserves letter suffixes
  date?: string; // YYYY-MM-DD
  startTime?: string;
  hares?: string;
  location?: string;
  locationUrl?: string;
  nearestStation?: string;
  description?: string;
  trashUrl?: string;
  flashUrl?: string;
}

// ---------------------------------------------------------------------------
// Next Runs page parsing (/next-run-s/)
// ---------------------------------------------------------------------------

/**
 * Convert IONOS/Jimdo HTML to clean text.
 * Handles deeply nested `<div style="font-size:15.4px;">` elements.
 */
function htmlToMerseyText(html: string): string {
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(?:p|div)>/gi, "\n");
  text = text.replace(/<\/(strong|em|b|i|a|span)>/gi, "</$1> ");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  return text
    .split("\n")
    .map((l) => l.replace(/\s{2,}/g, " ").replace(/\u00A0/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Parse a single "next run" block (text between dash separators).
 * Exported for unit testing.
 */
export function parseMerseyNextRunBlock(block: string): ParsedMerseyRun | null {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const result: ParsedMerseyRun = {};

  // Find date — first line that looks like a UK date
  for (const line of lines) {
    const date = chronoParseDate(line, "en-GB");
    if (date) {
      result.date = date;
      break;
    }
  }
  if (!result.date) return null;

  // Run number: "Run NNN" or "Run NNN" (sometimes in bold)
  for (const line of lines) {
    const runMatch = /\bRun\s+(\d+)\b/i.exec(line);
    if (runMatch) {
      result.runNumber = parseInt(runMatch[1], 10);
      break;
    }
  }

  const fullText = lines.join("\n");

  // Hare(s)
  const haresMatch = /Hares?\s*:\s*(.+)/i.exec(fullText);
  if (haresMatch) {
    result.hares = stripPlaceholder(haresMatch[1].split("\n")[0].trim());
  }

  // On Inn / venue — multi-line after "On Inn:" label
  const onInnMatch = fullText.match(
    /On Inn:\s*([\s\S]*?)(?=\n\s*(?:Nearest station|Meet|Get your|Starting from|Hare|$))/i,
  );
  if (onInnMatch) {
    const venueText = onInnMatch[1]
      .replace(/\n/g, ", ")
      .replace(/,\s*,/g, ",")
      .replace(/,\s*$/, "")
      .replace(/^\s*,\s*/, "")
      .trim();
    const venue = stripPlaceholder(venueText);
    if (venue) {
      result.location = venue;
      const postcode = extractUkPostcode(venue);
      if (postcode) result.locationUrl = googleMapsSearchUrl(postcode);
    }
  }

  // Starting from (A-to-B runs)
  if (!result.location) {
    const startMatch = fullText.match(/Starting from:\s*(.+)/i);
    if (startMatch) {
      const loc = startMatch[1].split("\n")[0].trim();
      const venue = stripPlaceholder(loc);
      if (venue) {
        result.location = venue;
        const postcode = extractUkPostcode(venue);
        if (postcode) result.locationUrl = googleMapsSearchUrl(postcode);
      }
    }
  }

  // Fallback: look for a line with a UK postcode that isn't a labeled field
  if (!result.location) {
    for (const line of lines) {
      if (/^(Hare|Run |On Inn|Nearest|Starting|Get |-)/i.test(line)) continue;
      const postcode = extractUkPostcode(line);
      if (postcode) {
        result.location = line;
        result.locationUrl = googleMapsSearchUrl(postcode);
        break;
      }
    }
  }

  // Nearest station
  const stationMatch = /Nearest station:\s*(.+)/i.exec(fullText);
  if (stationMatch) {
    result.nearestStation = stationMatch[1].split("\n")[0].trim();
  }

  // Start time — look for explicit time mentions
  const timeMatch = /Meet\s+(\d{1,2}(?::\d{2})?\s*(?:pm|am))/i.exec(fullText);
  if (timeMatch) {
    const raw = timeMatch[1]
      .replace(/(\d{1,2})(pm|am)/i, "$1:00 $2")
      .replace(/(\d{1,2}:\d{2})(pm|am)/i, "$1 $2");
    const parsed = parse12HourTime(raw);
    result.startTime = parsed ?? DEFAULT_START_TIME;
  } else {
    result.startTime = DEFAULT_START_TIME;
  }

  // Build description from notable lines
  const descParts: string[] = [];
  if (result.nearestStation) descParts.push(`Nearest station: ${result.nearestStation}`);
  // Capture special event details
  for (const line of lines) {
    if (/celebration|cruise|island run|a to b run/i.test(line) && !descParts.includes(line)) {
      descParts.push(line);
    }
  }
  if (descParts.length > 0) result.description = descParts.join(". ");

  // Require at least one event-identifying field beyond a bare date.
  // Blocks with only an implied date (e.g., from "7pm" in instruction text)
  // are not real events.
  if (!result.runNumber && !result.hares && !result.location) return null;

  return result;
}

const RUN_HEADER_RE = /\bRun\s+\d+\b/i;

// Month prefixes for the strict date-heading detector below. Kept as a Set
// lookup rather than a 12-branch regex alternation (cheaper + dodges Sonar's
// regex-complexity rule — see memory feedback_sonar_s5843).
const MONTH_PREFIXES = new Set([
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
]);

/**
 * Strict "is this line a run-date heading?" check for segment-boundary
 * detection. Deliberately NOT `chronoParseDate`: chrono extracts a date from
 * any string that merely *contains* a date-ish token ("Meet 7pm" → today,
 * "see you at 8" → today), which would make detail lines false segment
 * boundaries. The source's date headings always lead with a day ordinal + a
 * month name ("28th May", "18th June ** Note 6pm start! **"), so we require
 * exactly that shape at the start of the line.
 */
function isRunDateHeading(line: string): boolean {
  const m = /^\d{1,2}(?:st|nd|rd|th)?\s+([a-z]{3})/i.exec(line);
  return !!m && MONTH_PREFIXES.has(m[1].toLowerCase());
}

/**
 * Sub-split a dashed block that contains more than one `Run NNN` header.
 *
 * The dash separators are the primary delimiter, but if the source ever drops
 * or shortens one (HTML edit, copy-paste slip) two runs land in a single block.
 * `parseMerseyNextRunBlock` then reads the FIRST date / run / hare it finds and
 * silently discards the second run — the mechanism behind the #1709 duplicate
 * run-602 row and the backward hare bleed (a `Hare: TBC` run inheriting the
 * next block's hare). Splitting on run-header boundaries makes parsing robust
 * to a missing dash: each run anchors its own segment, and the date heading
 * that sits just above the `Run NNN` header (this source always lists the date
 * first) is pulled into that run's segment.
 *
 * Boundary rule: this source puts the date heading on the line DIRECTLY above
 * each `Run NNN` header (verified live: "18th June …" / "Run 603"). So the
 * split point for run k>0 is `runIdx-1` iff that line is a date heading. This
 * is what distinguishes the date-above layout from a date-below one: in a
 * date-below block the line directly above a header is detail (e.g. a hare),
 * not a date, so the check fails and we don't split.
 *
 * Fail-safe: if any non-leading run header lacks a date heading directly above
 * it, we DON'T split — splitting blind would corrupt dates/hares (the very
 * failure this guards against). Returning the block whole preserves the prior
 * single-run behavior, and we `console.warn` so the anomaly surfaces in scrape
 * logs rather than silently mangling data (fail loud over silent corruption).
 *
 * Returns the block unchanged when it has 0–1 run headers.
 */
function subSplitRunBlock(block: string): string[] {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const runIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (RUN_HEADER_RE.test(lines[i])) runIdxs.push(i);
  }
  if (runIdxs.length <= 1) return [block];

  // Boundary for run k>0 is the date heading directly above its header. The
  // first segment starts at line 0 to keep any leading detail; boundaries are
  // exclusive so a run's trailing detail stays with it until the next date.
  const starts: number[] = [0];
  for (let k = 1; k < runIdxs.length; k++) {
    const runIdx = runIdxs[k];
    const dateIdx = runIdx - 1;
    if (dateIdx <= starts[starts.length - 1] || !isRunDateHeading(lines[dateIdx])) {
      // Date-directly-above assumption violated — refuse to split rather than
      // corrupt dates/hares across the merged runs.
      console.warn(
        `[mersey-thirstdays] merged block with no date heading directly above ` +
          `run header ${JSON.stringify(lines[runIdx])}; leaving block un-split.`,
      );
      return [block];
    }
    starts.push(dateIdx);
  }

  const segments: string[] = [];
  for (let k = 0; k < starts.length; k++) {
    const to = k + 1 < starts.length ? starts[k + 1] : lines.length;
    segments.push(lines.slice(starts[k], to).join("\n"));
  }
  return segments;
}

/** Count populated detail fields — used to keep the richer of two run records. */
function countRunFields(run: ParsedMerseyRun): number {
  let n = 0;
  if (run.hares) n++;
  if (run.location) n++;
  if (run.nearestStation) n++;
  if (run.description) n++;
  return n;
}

/**
 * Drop duplicate run-number records, keeping the most detailed.
 * A clean sub-split shouldn't produce duplicates, but this guards against the
 * #1709 "duplicate run 602" symptom if the source ever repeats a run header.
 */
function dedupByRunNumber(runs: ParsedMerseyRun[]): ParsedMerseyRun[] {
  const indexByRun = new Map<number, number>();
  const out: ParsedMerseyRun[] = [];
  for (const run of runs) {
    if (run.runNumber == null) {
      out.push(run);
      continue;
    }
    const existingIdx = indexByRun.get(run.runNumber);
    if (existingIdx === undefined) {
      indexByRun.set(run.runNumber, out.length);
      out.push(run);
    } else if (countRunFields(run) > countRunFields(out[existingIdx])) {
      out[existingIdx] = run;
    }
  }
  return out;
}

/**
 * Parse the full next-runs page text into runs.
 * Exported for unit testing.
 */
export function parseMerseyNextRuns(text: string): ParsedMerseyRun[] {
  // Split on dashed lines (10+ hyphens), then defensively sub-split any block
  // that merged two runs (missing/short separator) on run-header boundaries.
  const blocks = text.split(/-{10,}/);
  const runs: ParsedMerseyRun[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;
    for (const segment of subSplitRunBlock(block)) {
      const parsed = parseMerseyNextRunBlock(segment);
      if (parsed) runs.push(parsed);
    }
  }

  return dedupByRunNumber(runs);
}

// ---------------------------------------------------------------------------
// Past Runs page parsing (/past-runs/)
// ---------------------------------------------------------------------------

/**
 * Split past runs text into year sections by ▲ YYYY ▲ markers.
 * Returns a Map of year → array of run-line strings.
 * Exported for unit testing.
 */
export function splitByYearMarkers(text: string): Map<number, string[]> {
  const sections = new Map<number, string[]>();

  // Split on year markers: ▲  YYYY  ▲ (with variable whitespace)
  const parts = text.split(/▲\s*(\d{4})\s*▲/);
  // parts: [before_first_marker, year1, section1_text, year2, section2_text, ...]

  // Year markers are footer-style: ▲ YYYY ▲ marks the END of year YYYY.
  // Content before ▲ YYYY ▲ belongs to year YYYY.
  // Content after ▲ YYYY ▲ belongs to year YYYY - 1.
  let currentYear: number | null = null;
  if (parts.length >= 2) {
    currentYear = parseInt(parts[1], 10);
    if (parts[0].trim()) {
      sections.set(currentYear, splitIntoRunLines(parts[0]));
    }
  }

  // Process paired year/text sections
  for (let i = 1; i < parts.length - 1; i += 2) {
    const year = parseInt(parts[i], 10);
    const sectionText = parts[i + 1] || "";
    if (!isNaN(year) && sectionText.trim()) {
      sections.set(year - 1, splitIntoRunLines(sectionText));
    }
  }

  return sections;
}

/** Split a year section into individual run lines. */
function splitIntoRunLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && /^\d{1,3}[a-z]?\s/.test(l));
}

/**
 * Parse a single past run line into structured data.
 * Handles three format eras:
 *   Modern (2023+):  "597 19th March Hare 10 Seconds. Ring O' Bells, West Kirby"
 *   Mid (2022-2023): "488 6 Jan Hare: ET, The Railway, Liverpool"
 *   Old (2006-2021): "139 17 Dec Yuet Ben, Liverpool Hare: go On go On"
 *
 * Exported for unit testing.
 */
export function parseMerseyPastRunLine(
  text: string,
  year: number,
): ParsedMerseyRun | null {
  if (!text.trim()) return null;

  // Extract run number (possibly with letter suffix)
  const runNumMatch = /^(\d{1,3}[a-z]*)\s+/i.exec(text);
  if (!runNumMatch) return null;

  const runNumberRaw = runNumMatch[1];
  const numericPart = parseInt(runNumberRaw, 10);
  const afterRunNum = text.slice(runNumMatch[0].length).trim();

  // Extract date: first part matching day+month pattern
  const dateMatch = /^(\d{1,2}(?:st|nd|rd|th)?\s+\w+)\s*/i.exec(afterRunNum);
  if (!dateMatch) return null;

  const dateStr = `${dateMatch[1]} ${year}`;
  const date = chronoParseDate(dateStr, "en-GB");
  if (!date) return null;

  const afterDate = afterRunNum.slice(dateMatch[0].length).trim();

  const result: ParsedMerseyRun = {
    runNumber: numericPart,
    runNumberRaw,
    date,
    startTime: DEFAULT_START_TIME,
  };

  // Strip Trash/Flash/Trail link text from the end
  const cleanedText = afterDate
    .replace(/\s*(?:Trash|Flash|Trail)\s*/gi, " ")
    .trim();

  // Determine format era and extract hare + location
  // Check for "Hare:" or "Hares:" with colon (mid + old era)
  const hareColonMatch = /\bHares?:\s*/i.exec(cleanedText);
  // Check for "Hare " or "Hares " without colon (modern era)
  const hareNoColonMatch = /\bHares?\s+(?!:)/i.exec(cleanedText);

  if (hareColonMatch) {
    const harePos = hareColonMatch.index;
    const beforeHare = cleanedText.slice(0, harePos).trim();
    const afterHare = cleanedText.slice(harePos + hareColonMatch[0].length).trim();

    if (beforeHare.length > 0) {
      // Old format: location BEFORE hare (e.g., "Yuet Ben, Liverpool Hare: Name")
      result.location = beforeHare.replace(/,\s*$/, "").trim();
      result.hares = afterHare.replace(/[.,]\s*$/, "").trim() || undefined;
    } else {
      // Mid format: "Hare: name, location"
      const parts = afterHare.split(/,\s*/);
      if (parts.length >= 2) {
        result.hares = parts[0].trim() || undefined;
        result.location = parts.slice(1).join(", ").replace(/[.,]\s*$/, "").trim();
      } else {
        result.hares = afterHare.replace(/[.,]\s*$/, "").trim() || undefined;
      }
    }
  } else if (hareNoColonMatch) {
    // Modern format: "Hare Name. Location"
    const harePos = hareNoColonMatch.index;
    const afterHareKeyword = cleanedText.slice(harePos + hareNoColonMatch[0].length).trim();

    // Split on period — hare name ends at ".", location follows
    const periodIdx = afterHareKeyword.indexOf(".");
    if (periodIdx > 0) {
      result.hares = afterHareKeyword.slice(0, periodIdx).trim() || undefined;
      result.location = afterHareKeyword.slice(periodIdx + 1).replace(/,\s*$/, "").trim();
    } else {
      // No period — try comma split
      const commaParts = afterHareKeyword.split(/,\s*/);
      if (commaParts.length >= 2) {
        result.hares = commaParts[0].trim() || undefined;
        result.location = commaParts.slice(1).join(", ").replace(/[.,]\s*$/, "").trim();
      } else {
        result.hares = afterHareKeyword.replace(/[.,]\s*$/, "").trim() || undefined;
      }
    }
  } else {
    // No hare marker — might be a special event
    if (cleanedText) {
      result.location = cleanedText.replace(/[.,]\s*$/, "").trim();
    }
  }

  // Clean up hares
  if (result.hares) {
    result.hares = stripPlaceholder(result.hares);
  }

  // Extract postcode from location
  if (result.location) {
    const postcode = extractUkPostcode(result.location);
    if (postcode) result.locationUrl = googleMapsSearchUrl(postcode);
  }

  return result;
}

/**
 * Extract Trash/Flash URLs from HTML for a specific run number.
 */
function extractTrashFlashUrls(
  $: cheerio.CheerioAPI,
  runNumber: number | undefined,
): { trashUrl?: string; flashUrl?: string } {
  if (!runNumber) return {};
  const result: { trashUrl?: string; flashUrl?: string } = {};
  // Anchor on non-digit after run number to avoid Run1 matching Run10/Run100
  const pattern = new RegExp(`Run\\s*${runNumber}(?!\\d)`);

  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim().toLowerCase();
    if (text === "trash" && pattern.test(href)) {
      result.trashUrl = href;
    }
    if (text === "flash" && pattern.test(href)) {
      result.flashUrl = href;
    }
  });

  return result;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class MerseyThirstdaysAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const nextRunsUrl = source.url || "https://www.merseythirstdayshash.com/next-run-s/";
    const config = (source.config as Record<string, unknown>) ?? {};
    const pastRunsUrl = (config.pastRunsUrl as string) || null;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 7300);

    let fetchDurationMs = 0;
    let structureHash: string | undefined;
    let nextRunsCount = 0;
    let pastRunsCount = 0;

    // --- Fetch and parse next-runs page ---
    const nextPage = await fetchHTMLPage(nextRunsUrl);
    if (nextPage.ok) {
      fetchDurationMs += nextPage.fetchDurationMs;
      structureHash = nextPage.structureHash;
      const { $ } = nextPage;

      try {
        const container = $(".module-type-text.diyfeLiveArea").first();
        const html = container.html() ?? $("body").html() ?? "";
        const text = htmlToMerseyText(html);
        const runs = parseMerseyNextRuns(text);

        for (const run of runs) {
          if (!run.date) continue;
          const eventDate = new Date(run.date + "T12:00:00Z");
          if (eventDate < minDate || eventDate > maxDate) continue;

          const title = run.runNumber
            ? `${KENNEL_TAG} #${run.runNumber}`
            : KENNEL_TAG;

          events.push({
            date: run.date,
            kennelTags: [KENNEL_TAG],
            runNumber: run.runNumber,
            title,
            hares: run.hares,
            location: run.location,
            locationUrl: run.locationUrl,
            startTime: run.startTime ?? DEFAULT_START_TIME,
            sourceUrl: nextRunsUrl,
            description: run.description,
          });
          nextRunsCount++;
        }
      } catch (err) {
        errors.push(`Next runs parse error: ${err}`);
        (errorDetails.parse ??= []).push({
          row: 0,
          section: "next-runs",
          error: String(err),
        });
      }
    } else {
      errors.push(...nextPage.result.errors);
    }

    // --- Fetch and parse past-runs page ---
    if (pastRunsUrl) {
      const pastPage = await fetchHTMLPage(pastRunsUrl);
      if (pastPage.ok) {
        fetchDurationMs += pastPage.fetchDurationMs;
        const { $ } = pastPage;

        try {
          const container = $(".module-type-text.diyfeLiveArea").first();
          const html = container.html() ?? $("body").html() ?? "";
          const text = htmlToMerseyText(html);
          const yearSections = splitByYearMarkers(text);

          // Track run numbers already seen from next-runs page
          const seenRunNumbers = new Set(
            events.filter((e) => e.runNumber).map((e) => e.runNumber),
          );

          for (const [year, lines] of yearSections) {
            for (const line of lines) {
              try {
                const run = parseMerseyPastRunLine(line, year);
                if (!run || !run.date) continue;

                // Skip if already have this run from next-runs page (richer data)
                if (run.runNumber && seenRunNumbers.has(run.runNumber)) continue;

                const eventDate = new Date(run.date + "T12:00:00Z");
                if (eventDate < minDate || eventDate > maxDate) continue;

                // Extract Trash/Flash URLs
                const links = extractTrashFlashUrls($, run.runNumber);

                const descParts: string[] = [];
                if (links.trashUrl) descParts.push(`Trash: ${links.trashUrl}`);
                if (links.flashUrl) descParts.push(`Flash: ${links.flashUrl}`);

                const title = run.runNumber
                  ? `${KENNEL_TAG} #${run.runNumber}`
                  : KENNEL_TAG;

                events.push({
                  date: run.date,
                  kennelTags: [KENNEL_TAG],
                  runNumber: run.runNumber,
                  title,
                  hares: run.hares,
                  location: run.location,
                  locationUrl: run.locationUrl,
                  startTime: DEFAULT_START_TIME,
                  sourceUrl: pastRunsUrl,
                  description: descParts.length > 0 ? descParts.join("\n") : undefined,
                });
                pastRunsCount++;
              } catch (lineErr) {
                (errorDetails.parse ??= []).push({
                  row: 0,
                  section: `past-runs-${year}`,
                  error: String(lineErr),
                  rawText: line.slice(0, 200),
                });
              }
            }
          }
        } catch (err) {
          errors.push(`Past runs parse error: ${err}`);
          (errorDetails.parse ??= []).push({
            row: 0,
            section: "past-runs",
            error: String(err),
          });
        }
      } else {
        errors.push(...pastPage.result.errors);
      }
    }

    const hasErrors = hasAnyErrors(errorDetails);
    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        nextRunsParsed: nextRunsCount,
        pastRunsParsed: pastRunsCount,
        totalEvents: events.length,
        fetchDurationMs,
      },
    };
  }
}
