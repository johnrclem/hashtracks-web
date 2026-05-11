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
import {
  fetchHTMLPage,
  parse12HourTime,
  HARE_BOILERPLATE_RE,
  decodeEntities,
  stripPlaceholder,
} from "../utils";
import { extractCoordsFromMapsUrl } from "@/lib/geo";

/** Labels that appear inside `<strong>` tags on the hare-line — used to skip
 *  label-only strongs when hunting for the event title strong. Inputs are
 *  pre-trimmed by the caller, so this anchor pair doesn't need outer `\s*`
 *  (which Sonar S5852 flags as ReDoS-shaped). */
const IH3_LABEL_STRONG_RE = /^(?:hares?|where|when|cost|details):?$/i;

/**
 * Parse a date string like "March 15" into "YYYY-MM-DD" with year inference.
 * Dates without years use current year, bumped to next year if the date is in the past.
 */
export function parseIH3Date(text: string): string | null {
  const match = /(\w+)\s+(\d{1,2})/.exec(text);
  if (!match) return null;

  const monthNames: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  const monthStr = match[1].toLowerCase();
  const month = monthNames[monthStr];
  if (!month) return null;

  const day = parseInt(match[2], 10);
  if (day < 1 || day > 31) return null;

  // Year inference: use current year, bump to next if date is >30 days in the past
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month - 1, day);

  // If the date is more than 30 days in the past, assume next year
  const daysDiff = (now.getTime() - candidate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysDiff > 30) {
    year++;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a single event <p> block from the IH3 hare-line page.
 *
 * Expected HTML structure (the title strong is optional and only present when
 * the trail has a published name — #1344):
 *   <p>
 *     <strong>#1119: March 15</strong><br>
 *     <strong>RAINBOW DRESS RUN</strong><br>    (optional — title)
 *     <strong>Hares:</strong> Flesh Flaps &amp; Spike<br>
 *     <span style="font-weight: 600;">Where</span>: <a href="maps-url">Flat Rock</a><br>
 *     <span style="font-weight: 600;">When:</span> 2:00 pm<br>
 *     <span style="font-weight: 600;">Cost:</span> $5 (first timers free)<br>
 *     <span style="font-weight: 600;">Details</span>: <a href="...">touch me</a>
 *   </p>
 *
 * The site frequently embeds `<br>` inside the next decorative `<span>` rather
 * than as a separator between fields, so `$block.text()` collapses adjacent
 * fields with no whitespace (e.g. `When: 12:00 pmCost: $8`). The `.+?`
 * lazy-match + next-label alternation in the When/Cost regexes is the load-
 * bearing fix for that — don't simplify to `.*$` (#1123).
 */
export function parseIH3Block(
  $block: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  sourceUrl: string,
): RawEventData | null {
  const blockHtml = $.html($block);
  const blockText = $block.text();

  // Extract trail number and date from the first <strong>
  const strongs = $block.find("strong");
  const headerMatch = /#(\d+)\s*:\s*(.+)/i.exec(strongs.first().text());
  if (!headerMatch) return null;

  const runNumber = parseInt(headerMatch[1], 10);
  const dateText = headerMatch[2].trim();
  const date = parseIH3Date(dateText);
  if (!date) return null;

  // Extract event title — first <strong> after the header that isn't a field
  // label (Hares/Where/When/Cost/Details). When the source omits a title,
  // leave it undefined so merge.ts synthesizes "Ithaca H3 Trail #NNNN" via
  // friendlyKennelName instead of locking in a placeholder #1344.
  //
  // Known tradeoff (#1344 / codex adversarial review): if a source admin
  // removes a previously published title, the next scrape emits undefined and
  // merge.ts will overwrite the canonical Event.title with the synthesized
  // default. This is the same behavior every conditional-title adapter has
  // in the codebase (see hashnyc.ts). Acceptable because (a) source admins
  // rarely strip published titles, and (b) the synthesized fallback is
  // strictly better than the pre-PR "IH3 #N" placeholder we used to ship.
  let title: string | undefined;
  strongs.each((i, el) => {
    if (i === 0) return;
    const cleaned = decodeEntities($(el).text()).replaceAll(/\s+/g, " ").trim();
    if (!cleaned) return;
    if (IH3_LABEL_STRONG_RE.test(cleaned)) return;
    title = cleaned;
    return false; // break cheerio .each() once we have the title
  });

  // Extract hares
  let hares: string | undefined;
  const haresMatch = /Hares?\s*:\s*(.+?)(?:<br|$)/i.exec(blockHtml);
  if (haresMatch) {
    // Get text content, strip HTML tags
    const haresHtml = haresMatch[1];
    const hares$ = cheerio.load(`<div>${haresHtml}</div>`);
    const haresText = hares$("div").text().trim();
    if (haresText && !/^tbd|tba$/i.test(haresText)) {
      hares = haresText.replace(HARE_BOILERPLATE_RE, "").trim();
      if (!hares) hares = undefined;
    }
  }

  // Extract location — look for "Where" label
  let location: string | undefined;
  let locationUrl: string | undefined;
  let latitude: number | undefined;
  let longitude: number | undefined;

  const whereMatch = /Where\s*:?\s*/i.exec(blockText);
  if (whereMatch) {
    // Find the text after "Where:" up to the next label or end
    const afterWhere = blockText.slice(whereMatch.index + whereMatch[0].length);
    const locationText = afterWhere.split(/\n|When\s*:|Cost\s*:|Details\s*:|Hares?\s*:/i)[0]?.trim();
    if (locationText) {
      location = locationText;
    }
  }

  // Extract links in a single pass: Google Maps URLs and detail page URLs
  let detailUrl: string | undefined;
  $block.find("a").each((_i, a) => {
    const href = $(a).attr("href") || "";
    if (href.includes("google") && (href.includes("maps") || href.includes("map"))) {
      locationUrl = href;
      const coords = extractCoordsFromMapsUrl(href);
      if (coords) {
        latitude = coords.lat;
        longitude = coords.lng;
      }
      if (!location) {
        const linkText = $(a).text().trim();
        if (linkText) location = linkText;
      }
    } else if (href.includes("ithacah3.org")) {
      detailUrl = href;
    }
  });

  // Extract time — look for "When" label
  let startTime: string | undefined;
  const whenMatch = /When\s*:?\s*(.+?)(?:\n|Cost|Details|$)/i.exec(blockText);
  if (whenMatch) {
    startTime = parse12HourTime(whenMatch[1]);
  }

  // Extract cost — fixed "Cost: $X (...)" line on every event (#1346).
  // Uses the same slice-+-split shape the location extraction above uses:
  // anchor on the label, then split on the next label / newline. This
  // avoids the `Label\s*:?\s*(.+?)(?:alt|...|$)` lazy-quantifier shape that
  // Sonar S5852 flags as ReDoS-vulnerable (the actual input is a single
  // event block, so it's linear in practice, but reusing the established
  // pattern keeps the analyzer quiet and matches the file's house style).
  let cost: string | undefined;
  const costLabelMatch = /Cost\s*:?\s*/i.exec(blockText);
  if (costLabelMatch) {
    const afterCost = blockText.slice(costLabelMatch.index + costLabelMatch[0].length);
    const costRaw = afterCost.split(/\n|Details\s*:|Hares?\s*:|Where\s*:|When\s*:/i)[0] ?? "";
    cost = stripPlaceholder(costRaw);
  }

  return {
    date,
    kennelTags: ["ih3"],
    runNumber,
    title,
    hares,
    location,
    locationUrl,
    latitude,
    longitude,
    startTime,
    cost,
    sourceUrl: detailUrl || sourceUrl,
  };
}

/**
 * Parse the IH3 Trail Log archive page (`/hair_line-trail_log/`).
 *
 * Row shape (verified live 2026-05):
 *   <p[ class="event_W|I|L|D"]?>
 *     <strong>Hash #NNNN:</strong> [optional title]
 *     <br>YYYY-MM-DD; Location
 *   </p>
 *
 * Used by `scripts/backfill-ih3-history.ts` to backfill ~99 historical events
 * (#999–#1097, 2022-09 → 2025-07) that pre-date the kennel's WordPress hare-line
 * (which only carries upcoming runs).
 *
 * Notes:
 * - Title can be empty (`<strong>Hash #1093:</strong> <br>2025-05-25; …`).
 * - `class="event_W"` etc. are category colors — not relevant to parsing.
 * - The live page duplicates one row (`#1083` appears twice). We don't dedupe
 *   here; the merge pipeline's `(sourceId, fingerprint)` unique index catches
 *   it. Don't "fix" the duplicate emit — fingerprint dedup is the load-bearing
 *   correctness guarantee, and one row twice in the parser output is harmless.
 */
export function parseTrailLog(html: string, sourceUrl: string): RawEventData[] {
  const $ = cheerio.load(html);
  const out: RawEventData[] = [];

  $("p").each((_i, el) => {
    const $p = $(el);
    const strongText = $p.find("strong").first().text();
    const header = /Hash\s*#(\d+)\s*:/i.exec(strongText);
    if (!header) return;
    const runNumber = parseInt(header[1], 10);

    // Split inner HTML on <br>. The documented row shape has a single <br>,
    // but slice(1).join("<br>") preserves any extras inside the location half
    // (e.g. a multi-line address) instead of silently truncating them.
    const inner = $.html($p);
    const brSplit = inner.split(/<br\s*\/?>/i);
    if (brSplit.length < 2) return;
    const headerHalf = brSplit[0];
    const tailHalf = brSplit.slice(1).join("<br>");

    // Title: text content after the closing </strong> on the header half.
    const titleMatch = /<\/strong>([\s\S]*)$/i.exec(headerHalf);
    const titleRaw = titleMatch
      ? cheerio.load(`<div>${titleMatch[1]}</div>`)("div").text()
      : "";
    const titleClean = decodeEntities(titleRaw).replaceAll(/\s+/g, " ").trim();
    const title = titleClean || undefined;

    // Date + location: "YYYY-MM-DD; Location" on the tail half. The regex
    // anchors on the fixed date prefix; the location split is done with
    // string ops to keep the regex shape away from Sonar S5852's
    // `\s*[;,]?\s*` false-positive trigger.
    const datesHalfRaw = cheerio
      .load(`<div>${tailHalf}</div>`)("div")
      .text();
    const datesHalf = decodeEntities(datesHalfRaw).trim();
    const dateMatch = /^(\d{4}-\d{2}-\d{2})([\s\S]*)$/.exec(datesHalf);
    if (!dateMatch) return;
    const date = dateMatch[1];
    const locationClean = dateMatch[2]
      .replace(/^[;,\s]+/, "")
      .replaceAll(/\s+/g, " ")
      .trim();
    const location = locationClean || undefined;

    out.push({
      date,
      kennelTags: ["ih3"],
      runNumber,
      title,
      location,
      sourceUrl,
    });
  });

  return out;
}

/**
 * Ithaca Hash House Harriers (IH3) Hare-Line Scraper
 *
 * Scrapes ithacah3.org/hare-line/ — a WordPress page with events listed
 * in <p> blocks. Each block contains trail number, date, hares, location
 * (often with Google Maps links), and time.
 *
 * Uses HTTP (not HTTPS) because the site's SSL certificate is expired.
 */
export class IthacaH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "http://ithacah3.org/hare-line/";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let blockIndex = 0;

    // Find the main content area
    const contentArea = $(".entry-content, .post-content, article, .page-content").first();
    const container = contentArea.length > 0 ? contentArea : $("body");

    // Find <p> blocks that contain trail info (start with <strong>#NNN)
    container.find("p").each((_i, el) => {
      const $p = $(el);
      const text = $p.text().trim();

      // Only process blocks that look like event entries
      if (!/#\d+/.test(text)) return;

      try {
        const event = parseIH3Block($p, $, url);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing block ${blockIndex}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: blockIndex,
          error: String(err),
          rawText: text.slice(0, 2000),
        });
      }
      blockIndex++;
    });

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        blocksFound: blockIndex,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
