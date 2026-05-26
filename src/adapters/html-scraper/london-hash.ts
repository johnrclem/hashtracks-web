import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, isPlaceholder, parse12HourTime, fetchHTMLPage } from "../utils";

/** Max detail pages to fetch per scrape (only first N events). */
const MAX_DETAIL_FETCHES = 3;

/** Boilerplate text that concatenates with hare names in .text() output. */
const LH3_HARE_BOILERPLATE_RE = /\s*(?:Unlike hashes|open in Google Maps|There is no need).*$/i;

/** London center coords used as placeholder on TBA pages. */
const LONDON_CENTER_LAT = 51.508;
const LONDON_CENTER_LNG = -0.128;
const COORD_THRESHOLD = 0.01; // ~1km

/** TBA / placeholder titles that should fall back to the synthesized default. */
const TITLE_PLACEHOLDER_RE = /^(?:to be announced|tba|tbc|tbd|details to be announced)$/i;

/** `nextrun.php?run=NNN` → captures NNN. */
const RUN_ID_RE = /run=(\d+)/;

/** Google Maps `?q=LAT,LNG` href coords. */
const MAPS_QUERY_COORDS_RE = /\?q=(-?[\d.]+),(-?[\d.]+)/;

/** Inline JS coord object: `{ lat: 51.5, lng: -0.1 }`. */
const JS_COORDS_RE = /\{\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)\s*\}/g;

/** "London hash number NNN" run-number extractor. */
const RUN_NUM_RE = /(?:London\s+hash\s+number|hash\s+number)?\s*(\d+)/i;
const RUN_NUM_FALLBACK_RE = /(?:London\s+hash\s+number|hash\s+number)\s+(\d+)/i;

/** "85 metres from <station>" distance line. */
const DISTANCE_RE = /(\d+\s*(?:meters?|metres?)\s+from\s+.+?)(?:\n|$)/i;

/** On-Inn body line (stops at quote so JS marker title doesn't leak). */
const ON_INN_RE = /On\s+Inn\s+to\s+([^\n"]+)/i;
const ON_INN_MARKER_RE = /title:\s*"On\s+Inn\s+to\s+(.+?)"/i;
const ON_INN_TRAILING_RE = /[,;]\s*$/;

/**
 * Represents a parsed run block from the London Hash run list page.
 *
 * Each field maps to a specific `.runlistRow` child in the source HTML, so
 * downstream parsers operate on isolated text instead of the concatenated
 * block content. This prevents cross-section bleed (e.g. the hare name
 * running into the next "What Else" / travel-info row — issue #1606).
 */
export interface RunBlock {
  runNumber: number;
  runId: string;
  titleText: string;
  dateText: string;
  locText: string;
  hareText: string;
  noteTexts: string[];
}

/** Inline-pad a cheerio block: replace `<br>` with newlines and append a space
 * after inline elements so adjacent text nodes don't fuse in `.text()`. */
function padBlock($block: cheerio.Cheerio<AnyNode>): void {
  $block.find("br").replaceWith("\n");
  $block.find("span, a, strong, em, b, i").after(" ");
}

/** Read text content of the first matching child, trimmed and whitespace-collapsed. */
function readField(
  $: cheerio.CheerioAPI,
  $block: cheerio.Cheerio<AnyNode>,
  selector: string,
): string {
  const node = $block.find(selector).first();
  if (!node.length) return "";
  return $(node).text().trim().replace(/[ \t]{2,}/g, " ");
}

/**
 * Split the London Hash run list page into individual run blocks.
 * Each block is anchored by a <a href="nextrun.php?run=XXXX"> link.
 *
 * Field extraction is keyed on the per-row CSS classes the site emits
 * (`.titleRow`, `.runlistDate`, `.runlistLoc`, `.runlistHare`,
 * `.runlistNote`) so each `RunBlock` field is the text of its own div —
 * never the entire concatenated block. Closes #1606.
 */
export function parseRunBlocks(html: string): RunBlock[] {
  const $ = cheerio.load(html);
  const blocks: RunBlock[] = [];

  // Strategy 1: Structured `.runListDetails` containers (live site)
  const containers = $(".runListDetails");
  if (containers.length > 0) {
    containers.each((_i, el) => {
      const $block = $(el);
      const $link = $block.find('a[href*="nextrun.php"]').first();
      if (!$link.length) return;

      const runId = (RUN_ID_RE.exec($link.attr("href") ?? "") ?? ["", ""])[1];
      const runNumber = Number.parseInt($link.text().trim(), 10);
      if (!runId || Number.isNaN(runNumber)) return;

      padBlock($block);

      const noteNodes = $block.find(".runlistNote");
      const noteTexts: string[] = [];
      noteNodes.each((_j, noteEl) => {
        const t = $(noteEl).text().trim().replace(/[ \t]{2,}/g, " ");
        if (t) noteTexts.push(t);
      });

      blocks.push({
        runNumber,
        runId,
        titleText: readField($, $block, ".runlistRow.titleRow"),
        dateText: readField($, $block, ".runlistDate"),
        locText: readField($, $block, ".runlistLoc"),
        hareText: readField($, $block, ".runlistHare"),
        noteTexts,
      });
    });
    return blocks;
  }

  // Strategy 2: Flat fallback — degraded but functional. No `.titleRow`
  // means title falls through to the synthesized default; the other
  // parsers run against the surrounding flat text.
  const runLinks = $('a[href*="nextrun.php"]');
  runLinks.each((i, el) => {
    const $link = $(el);
    const runId = (RUN_ID_RE.exec($link.attr("href") ?? "") ?? ["", ""])[1];
    const linkText = $link.text().trim();
    const runNumber = Number.parseInt(linkText, 10);
    if (!runId || Number.isNaN(runNumber)) return;

    let text = "";
    const $parent = $link.closest("p, li, section, body");
    if ($parent.length) {
      const fullText = $parent.text();
      const linkPos = fullText.indexOf(linkText);
      if (linkPos >= 0) {
        const nextLink = runLinks.eq(i + 1);
        if (nextLink.length) {
          const nextText = nextLink.text().trim();
          const nextPos = fullText.indexOf(nextText, linkPos + linkText.length);
          text = nextPos > linkPos
            ? fullText.substring(linkPos, nextPos).trim()
            : fullText.substring(linkPos).trim();
        } else {
          text = fullText.substring(linkPos).trim();
        }
      }
    }
    if (!text) text = $link.parent().text().trim();

    blocks.push({
      runNumber,
      runId,
      titleText: "",
      dateText: text,
      locText: text,
      hareText: text,
      noteTexts: [],
    });
  });

  return blocks;
}

/**
 * Parse a date from a London Hash run block using chrono-node.
 * Handles: "Saturday 21st of February 2026", "21/02/2026", "Monday 22nd June", etc.
 *
 * Live runlist rows omit the year ("Saturday 6th of June" + "(12 days time)").
 * Without `forwardDate`, chrono interprets ambiguous "6th of June" with refDate
 * Jan 1, 2026 as 2025-06-06 (closest match) instead of the intended 2026-06-06.
 * Pass `forwardDate: true` since runlist is an upcoming-only page — every
 * date is at or after the reference.
 */
export function parseDateFromBlock(text: string, referenceYear?: number): string | null {
  const refDate = referenceYear
    ? new Date(Date.UTC(referenceYear, 0, 1)) // Jan 1 of reference year
    : undefined;
  return chronoParseDate(text, "en-GB", refDate, { forwardDate: true });
}

/**
 * Parse hares from a London Hash run block.
 * Formats:
 *   "Hared by Tuna Melt and Opee"
 *   "Hare: John Smith"
 *   "Hare required"
 */
export function parseHaresFromBlock(text: string): string | null {
  // "Hared by Name and Name" or "Hared by Name"
  const haredByMatch = text.match(/Hared?\s+by\s+(.+?)(?:\n|$|\*)/i);
  if (haredByMatch) {
    let hares = haredByMatch[1].trim();
    // Skip placeholder text
    if (/required|volunteer|tba|tbd|tbc/i.test(hares)) return null;
    // Truncate at known boilerplate text that concatenates with hare names in .text() output
    hares = hares.replace(LH3_HARE_BOILERPLATE_RE, "").trim();
    // Normalize multiple consecutive spaces (from inline element spacing) to single space
    hares = hares.replace(/\s{2,}/g, " ");
    return hares || null;
  }

  // "Hare: Name"
  const hareColonMatch = text.match(/Hare:\s*(.+?)(?:\n|$|\*)/i);
  if (hareColonMatch) {
    let hares = hareColonMatch[1].trim();
    if (/required|volunteer|tba|tbd|tbc/i.test(hares)) return null;
    hares = hares.replace(LH3_HARE_BOILERPLATE_RE, "").trim();
    hares = hares.replace(/\s{2,}/g, " ");
    return hares || null;
  }

  return null;
}

/**
 * Parse location/starting point from a London Hash run block.
 * Formats:
 *   "Follow the P trail from Sydenham station to The Dolphin"
 *   "Start: Victoria Park" (if present)
 */
export function parseLocationFromBlock(text: string): { location?: string; station?: string } {
  // "Follow the P trail from STATION to PUB"
  const pTrailMatch = text.match(
    /(?:Follow|P\s*trail)\s+(?:the\s+P\s+trail\s+)?from\s+(.+?)\s+(?:station\s+)?to\s+(.+?)(?:\n|$|\*)/i,
  );
  if (pTrailMatch) {
    const station = pTrailMatch[1].trim();
    let loc = pTrailMatch[2].trim();
    // Filter placeholder or announcement text (e.g., "to be announced")
    if (isPlaceholder(loc) || /\bannounce/i.test(loc)) {
      return { station };
    }
    // Strip trailing description text that bleeds into location
    loc = loc.replace(/\s+(?:followed by|then on to|and then|details|more info|see)\b.*/i, "").trim();
    return { station, location: loc };
  }

  // "Start: LOCATION" pattern
  const startMatch = text.match(/Start:\s*(.+?)(?:\n|$|\*)/i);
  if (startMatch) {
    const loc = startMatch[1].trim();
    if (isPlaceholder(loc)) return {};
    return { location: loc };
  }

  // Fallback: "P trail from STATION" (no destination — common when pub TBA).
  // Only fires when no destination phrase was matched above.
  const stationOnlyMatch = text.match(/from\s+([^\n*]+?)\s+station\b/i);
  if (stationOnlyMatch) {
    return { station: stationOnlyMatch[1].trim() };
  }

  return {};
}

/**
 * Parse time from a London Hash run block.
 * "12 Noon for 12:30" → "12:00"
 * "7pm for 7:15" → "19:00"
 * "7:00 PM" → "19:00"
 */
export function parseTimeFromBlock(text: string): string | null {
  // "12 Noon" or "Noon"
  if (/\b(?:12\s+)?noon\b/i.test(text)) {
    return "12:00";
  }

  // "Xpm for X:XX" or "X:XX PM" — handle optional minutes (e.g., "7pm")
  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    // If minutes are present, delegate to shared parser
    if (timeMatch[2]) {
      return parse12HourTime(text) ?? null;
    }
    // Handle bare "7pm" (no minutes) — not handled by parse12HourTime
    let hours = parseInt(timeMatch[1], 10);
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, "0")}:00`;
  }

  return null;
}

/**
 * Sanitize the `.titleRow` content into an event title.
 *
 * - Strips `**` markdown wrappers from themed runs (`"**Sweetheart's 4th of July Hash**"`).
 * - Strips stray leading `**` on placeholder rows (real source quirk: `"**To Be Announced"`).
 * - Returns the synthesized default `"London Hash Run #N"` for TBA / blank titles.
 *
 * Exported for unit testing.
 */
export function parseTitleFromBlock(titleText: string, runNumber: number): string {
  // Strip ** markdown markers anywhere in the string (source uses them for
  // typographic emphasis on themed runs — meaningful for the website but
  // noise in a list of event titles). Collapse the resulting double spaces.
  const cleaned = titleText.replaceAll("**", " ").replace(/\s{2,}/g, " ").trim();
  if (!cleaned || TITLE_PLACEHOLDER_RE.test(cleaned)) {
    return `London Hash Run #${runNumber}`;
  }
  return cleaned;
}

/** Data extracted from a London Hash detail page (nextrun.php?run=XXXX). */
export interface LH3DetailPageData {
  runNumber?: number;
  title?: string;
  latitude?: number;
  longitude?: number;
  location?: string;
  station?: string;
  hares?: string;
  distance?: string;
  onOn?: string;
  locationUrl?: string;
  sourceUrl: string;
}

/**
 * Check if coordinates are the default London center placeholder.
 * Placeholder pages use ~(51.508, -0.128) which is the London center.
 */
function isDefaultLondonCoords(lat: number, lng: number): boolean {
  return (
    Math.abs(lat - LONDON_CENTER_LAT) < COORD_THRESHOLD &&
    Math.abs(lng - LONDON_CENTER_LNG) < COORD_THRESHOLD
  );
}

/** Build a label → value map from the structured `.nextRunlistRow` rows.
 *
 * The site renders each field as
 *   `<div class="nextRunlistRow"><div class="runlistCat">Label</div><div class="runlistDetail">Value</div></div>`
 * with sibling divs and no whitespace separators in the source HTML. Iterating
 * by `.runlistDetail` (instead of running regex against `body.text()`) keeps
 * each value isolated to its own div, preventing the "K4What Else" bleed
 * documented in #1606.
 *
 * One row on the live site uses `class="runlistRow"` (typo missing the
 * `next` prefix) — match both for resilience.
 */
function buildDetailLabelMap($: cheerio.CheerioAPI): Map<string, string> {
  const map = new Map<string, string>();
  $(".nextRunlistRow, #nextRunDetailsHolder .runlistRow").each((_i, el) => {
    const $row = $(el);
    $row.find("br").replaceWith("\n");
    $row.find("span, a, strong, em, b, i").after(" ");
    const label = $row.find(".runlistCat").first().text().trim();
    const value = $row.find(".runlistDetail").first().text().trim().replace(/[ \t]{2,}/g, " ");
    if (label && value) map.set(label, value);
  });
  return map;
}

/**
 * Parse a London Hash detail page (nextrun.php) into structured data.
 * Accepts a cheerio instance (from fetchHTMLPage) plus raw HTML for JS regex extraction.
 * Returns null for placeholder/TBA pages.
 */
export function parseLH3DetailPage(
  $: cheerio.CheerioAPI,
  html: string,
  detailUrl: string,
): LH3DetailPageData | null {
  const fullText = $("body").text();

  // Detect placeholder pages: "next run to be announced" heading and no P-trail content
  if (/next run to be announced/i.test(fullText) && !/follow the p trail/i.test(fullText)) {
    return null;
  }

  const result: LH3DetailPageData = { sourceUrl: detailUrl };

  // Title: `<h2 id="title">Location<br />Date</h2>` — take the first line.
  const $title = $("#title").first();
  if ($title.length) {
    $title.find("br").replaceWith("\n");
    const firstLine = $title.text().split("\n").map((s) => s.trim()).find((s) => s.length > 0);
    if (firstLine && !TITLE_PLACEHOLDER_RE.test(firstLine)) {
      const stripped = firstLine.replaceAll("**", " ").replace(/\s{2,}/g, " ").trim();
      if (stripped) result.title = stripped;
    }
  }

  applyDetailCoords(result, $, html);

  const labels = buildDetailLabelMap($);
  applyDetailRunNumber(result, labels, fullText);
  applyDetailLocation(result, labels, fullText);
  applyDetailHares(result, labels, fullText);
  applyDetailDistance(result, labels, fullText);
  applyDetailOnOn(result, fullText, html);

  return result;
}

/** Try Google Maps href first; fall back to inline JS `{lat,lng}`. */
function applyDetailCoords(result: LH3DetailPageData, $: cheerio.CheerioAPI, html: string): void {
  const mapsLink = $('a[href*="maps.google.com/?q="]').attr("href");
  if (mapsLink) {
    const qMatch = MAPS_QUERY_COORDS_RE.exec(mapsLink);
    if (qMatch) {
      const lat = Number.parseFloat(qMatch[1]);
      const lng = Number.parseFloat(qMatch[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && !isDefaultLondonCoords(lat, lng)) {
        result.locationUrl = mapsLink;
        result.latitude = lat;
        result.longitude = lng;
        return;
      }
    }
  }
  // No usable Maps link — scan JS for the first non-placeholder coord pair.
  for (const m of html.matchAll(JS_COORDS_RE)) {
    const lat = Number.parseFloat(m[1]);
    const lng = Number.parseFloat(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && !isDefaultLondonCoords(lat, lng)) {
      result.latitude = lat;
      result.longitude = lng;
      return;
    }
  }
}

function applyDetailRunNumber(result: LH3DetailPageData, labels: Map<string, string>, fullText: string): void {
  const whatValue = labels.get("What");
  const fromLabel = whatValue ? RUN_NUM_RE.exec(whatValue) : null;
  if (fromLabel) {
    result.runNumber = Number.parseInt(fromLabel[1], 10);
    return;
  }
  const fromBody = RUN_NUM_FALLBACK_RE.exec(fullText);
  if (fromBody) result.runNumber = Number.parseInt(fromBody[1], 10);
}

function applyDetailLocation(result: LH3DetailPageData, labels: Map<string, string>, fullText: string): void {
  const whereValue = labels.get("Where") ?? fullText;
  const { location, station } = parseLocationFromBlock(whereValue);
  if (location) result.location = location;
  if (station) result.station = station;
}

function applyDetailHares(result: LH3DetailPageData, labels: Map<string, string>, fullText: string): void {
  const whoValue = labels.get("Who") ?? fullText;
  const hares = parseHaresFromBlock(whoValue);
  if (hares) result.hares = hares;
}

function applyDetailDistance(result: LH3DetailPageData, labels: Map<string, string>, fullText: string): void {
  const howFarValue = labels.get("How Far") ?? fullText;
  const distMatch = DISTANCE_RE.exec(howFarValue);
  if (distMatch) result.distance = distMatch[1].trim();
}

function applyDetailOnOn(result: LH3DetailPageData, fullText: string, html: string): void {
  const onOnMatch = ON_INN_RE.exec(fullText);
  if (onOnMatch) {
    result.onOn = onOnMatch[1].trim().replace(ON_INN_TRAILING_RE, "");
    return;
  }
  const markerOnOn = ON_INN_MARKER_RE.exec(html);
  if (markerOnOn) result.onOn = markerOnOn[1].trim();
}

/**
 * Merge detail-page data into a run-list event.
 * Detail fields override run-list fields where present.
 */
export function mergeLH3DetailIntoEvent(event: RawEventData, detail: LH3DetailPageData): RawEventData {
  const merged: RawEventData = { ...event };

  if (detail.latitude != null && detail.longitude != null) {
    merged.latitude = detail.latitude;
    merged.longitude = detail.longitude;
  }
  if (detail.locationUrl) {
    merged.locationUrl = detail.locationUrl;
  }
  if (detail.location) {
    merged.location = detail.location;
  }
  if (detail.hares) {
    merged.hares = detail.hares;
  }
  // Title from detail page wins over the run-list `.titleRow` only when the
  // run-list synthesized the default (i.e. the .titleRow was TBA/blank).
  if (detail.title && /^London Hash Run #\d+$/.test(event.title ?? "")) {
    merged.title = detail.title;
  }

  // Enrich description with detail page info, preserving base station if detail lacks one
  const descParts: string[] = [];
  const station = detail.station ?? event.description?.match(/Nearest station: (.+?)(?:\.|$)/)?.[1];
  if (station) descParts.push(`Nearest station: ${station}`);
  if (detail.onOn) descParts.push(`On-On: ${detail.onOn}`);
  if (detail.distance) descParts.push(`Distance: ${detail.distance}`);
  if (descParts.length > 0) {
    merged.description = descParts.join(". ");
  }

  merged.sourceUrl = detail.sourceUrl;

  return merged;
}

/**
 * London Hash House Harriers (LH3) HTML Scraper
 *
 * Scrapes londonhash.org/runlist.php for upcoming runs, then enriches
 * the first few events with detail page data (coordinates, On-On, distance).
 * Follows the OCH3 two-phase pattern: run list + detail page enrichment.
 */
export class LondonHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.londonhash.org/runlist.php";

    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const blocks = parseRunBlocks(html);
    const baseUrlObj = new URL(baseUrl);
    const detailBase = `${baseUrlObj.protocol}//${baseUrlObj.host}`;

    const events = parseRunListEvents(blocks, detailBase, errorDetails, errors);
    const { detailPagesFetched, detailPagesEnriched } = await enrichWithDetailPages(
      blocks,
      events,
      detailBase,
      errors,
    );

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        blocksFound: blocks.length,
        eventsParsed: events.length,
        fetchDurationMs,
        detailPagesFetched,
        detailPagesEnriched,
      },
    };
  }
}

/** Phase 1: walk parsed `RunBlock[]` and synthesize `RawEventData[]`. Push
 * parse failures into `errorDetails.parse` / `errors`. */
function parseRunListEvents(
  blocks: RunBlock[],
  detailBase: string,
  errorDetails: ErrorDetails,
  errors: string[],
): RawEventData[] {
  const events: RawEventData[] = [];
  const currentYear = new Date().getFullYear();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    try {
      const event = buildEventFromBlock(block, currentYear, detailBase);
      if (event) {
        events.push(event);
      } else {
        (errorDetails.parse ??= []).push({
          row: i,
          section: "runlist",
          field: "date",
          error: `No date in block for run #${block.runNumber}`,
          rawText: block.dateText.slice(0, 2000),
        });
      }
    } catch (err) {
      errors.push(`Error parsing run #${block.runNumber}: ${err}`);
      (errorDetails.parse ??= []).push({
        row: i,
        section: "runlist",
        error: String(err),
        rawText: block.titleText.slice(0, 2000),
      });
    }
  }
  return events;
}

/** Build a single RawEventData from a RunBlock, or null if the date can't
 * be parsed. Other field misses are non-fatal (left undefined). */
function buildEventFromBlock(
  block: RunBlock,
  currentYear: number,
  detailBase: string,
): RawEventData | null {
  const date = parseDateFromBlock(block.dateText, currentYear);
  if (!date) return null;
  const hares = parseHaresFromBlock(block.hareText);
  const { location, station } = parseLocationFromBlock(block.locText);
  const startTime = parseTimeFromBlock(block.dateText) ?? "12:00";
  const title = parseTitleFromBlock(block.titleText, block.runNumber);
  const description = station ? `Nearest station: ${station}` : undefined;
  return {
    date,
    kennelTags: ["lh3"],
    runNumber: block.runNumber,
    title,
    hares: hares ?? undefined,
    location: location ?? undefined,
    startTime,
    sourceUrl: `${detailBase}/nextrun.php?run=${block.runId}`,
    description,
  };
}

/** Phase 2: fetch detail pages for the first `MAX_DETAIL_FETCHES` blocks
 * and merge into the matching events. Returns diagnostic counters. */
async function enrichWithDetailPages(
  blocks: RunBlock[],
  events: RawEventData[],
  detailBase: string,
  errors: string[],
): Promise<{ detailPagesFetched: number; detailPagesEnriched: number }> {
  const detailBlocks = blocks.slice(0, MAX_DETAIL_FETCHES);
  if (detailBlocks.length === 0) {
    return { detailPagesFetched: 0, detailPagesEnriched: 0 };
  }
  const detailResults = await Promise.allSettled(
    detailBlocks.map(async (block) => {
      const detailUrl = `${detailBase}/nextrun.php?run=${block.runId}`;
      const resp = await fetchHTMLPage(detailUrl);
      return { block, resp, detailUrl };
    }),
  );
  let detailPagesFetched = 0;
  let detailPagesEnriched = 0;
  for (const settled of detailResults) {
    if (settled.status !== "fulfilled") continue;
    detailPagesFetched++;
    if (applyDetailToEvents(settled.value, events, errors)) {
      detailPagesEnriched++;
    }
  }
  return { detailPagesFetched, detailPagesEnriched };
}

/** Merge one detail-page result into the matching event in-place. Returns
 * true if a merge occurred. Records soft errors via `errors`. */
function applyDetailToEvents(
  result: { block: RunBlock; resp: Awaited<ReturnType<typeof fetchHTMLPage>>; detailUrl: string },
  events: RawEventData[],
  errors: string[],
): boolean {
  const { block, resp, detailUrl } = result;
  if (!resp.ok) {
    errors.push(`Detail page fetch failed for run #${block.runNumber}`);
    return false;
  }
  const detail = parseLH3DetailPage(resp.$, resp.html, detailUrl);
  if (!detail) return false;
  if (detail.runNumber != null && detail.runNumber !== block.runNumber) {
    errors.push(
      `Detail page run number mismatch for run #${block.runNumber}: got ${detail.runNumber}`,
    );
    return false;
  }
  const matchIdx = events.findIndex((e) => e.runNumber === block.runNumber);
  if (matchIdx < 0) return false;
  events[matchIdx] = mergeLH3DetailIntoEvent(events[matchIdx], detail);
  return true;
}
