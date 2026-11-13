import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, chronoParseDate, parse12HourTime } from "../utils";
import { cleanAndFilterHares } from "../hare-extraction";

// Heading: "Hash #1993 - Memorial Day Hash!" — dash+title is optional (site omits it between updates).
const HEADING_RE = /Hash\s*[#＃]\s*(\d+)(?:\s*[-–]\s*(.+))?/i;
// Two simple patterns instead of one combined regex (avoids ReDoS-shape flagging).
const DATE_RE = /(\d{1,2}\/\d{1,2}\/\d{2,4})/;
const TIME_RE = /(\d{1,2}:\d{2}) ?(AM|PM)/i;
const HARES_RE = /^Hares?:\s*(\S.*)$/i;
// Lines that aren't location candidates: section labels, bullet items, hash-cash
// boilerplate, and the "On after we will be in the garage" note.
const SKIP_LINE_RE = /^(?:Trail:|Bring:|[●•]|\$\d+\s*Hash\s*Cash|On[- ]?after\b)/iu;
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Strip Wix's U+200B padding (which `\s` and trim() keep) and collapse whitespace. */
function cleanLine(text: string): string {
  return text.replace(ZERO_WIDTH_RE, "").replace(/\s+/g, " ").trim();
}

/** A heading's `<br>`-separated lines, cleaned, empties dropped. */
function headingLines($heading: Cheerio<AnyNode>): string[] {
  const $copy = $heading.clone();
  $copy.find("br").replaceWith("\n");
  return $copy.text().split("\n").map(cleanLine).filter(Boolean);
}
// The site sometimes puts the hare in the heading: "Hash #2018-Westys players club  Hare: X" (#2821).
const INLINE_HARE_RE = /(?:^|\s)Hares?:/i;

function parseDateTimeLine(line: string): { dateStr: string; timeStr: string } | null {
  const dm = DATE_RE.exec(line);
  if (!dm) return null;
  const tm = TIME_RE.exec(line.slice(dm.index + dm[0].length));
  if (!tm) return null;
  return { dateStr: dm[1], timeStr: `${tm[1]} ${tm[2]}` };
}

/** Split a heading's title from a trailing "Hare: X" segment. */
function splitInlineHare(heading: string | undefined): { title?: string; hares?: string } {
  const text = heading?.trim();
  if (!text) return {};
  const idx = text.search(INLINE_HARE_RE);
  if (idx === -1) return { title: text };
  const colon = text.indexOf(":", idx);
  return {
    title: text.slice(0, idx).trim() || undefined,
    hares: cleanAndFilterHares(text.slice(colon + 1)) ?? undefined,
  };
}

/**
 * The heading's "Hash #…" line, and the lines after it. Since 2026-11 the
 * heading can carry the venue as <br> lines ("Hash #2019-a real Rakeish event /
 * casa de Silver Fairy / 1920 18th St Boise 83702 / On after … / bring: …"),
 * which are read like the blocks below it. Venue lines come first: after the
 * first note only date and hare lines are kept, so free prose can't merge into
 * the location.
 */
function splitHeading($heading: Cheerio<AnyNode>): { headText: string; extraLines: string[] } {
  const all = headingLines($heading);
  const headIdx = all.findIndex((l) => HEADING_RE.test(l));
  // Fallback keeps the raw newlines so HEADING_RE's `.+` stops at the first line.
  if (headIdx < 0) return { headText: $heading.text().trim(), extraLines: [] };
  const after = all.slice(headIdx + 1);
  const firstNote = after.findIndex((l) => SKIP_LINE_RE.test(l));
  return {
    headText: all[headIdx],
    extraLines: after.filter(
      (l, i) => firstNote < 0 || i < firstNote || parseDateTimeLine(l) !== null || HARES_RE.test(l),
    ),
  };
}

function mergeLocation(existing: string | undefined, line: string): string {
  if (!existing) return line;
  return existing.includes(line) ? existing : `${existing}, ${line}`;
}

/**
 * Parse the upcoming-hash block from BoiseH3 home-page HTML.
 *
 * Wix renders each content block inside a `[data-testid="richTextElement"]`
 * container, so the parser climbs to that container before walking siblings
 * (with a fallback to direct heading siblings for simple fixtures). The
 * "We need Hares!" heading acts as the stop sentinel.
 */
export function parseBoiseH3Page(
  html: string,
  sourceUrl: string,
): { event: RawEventData | null; error?: string } {
  const $ = cheerio.load(html);

  const $heading = $("h1, h2, h3, h4, h5, h6")
    .filter((_i, el) => HEADING_RE.test($(el).text()))
    .first();

  if ($heading.length === 0) {
    return { event: null, error: "no upcoming-hash heading found on page" };
  }

  // `lines` starts with the heading's own venue lines; the blocks below follow.
  const { headText, extraLines: lines } = splitHeading($heading);
  const headMatch = HEADING_RE.exec(headText);
  if (!headMatch) {
    return { event: null, error: `could not parse heading: ${headText.slice(0, 80)}` };
  }
  const runNumber = Number.parseInt(headMatch[1], 10);
  const { title, hares: inlineHares } = splitInlineHare(headMatch[2]);

  const $richContainer = $heading.closest('[data-testid="richTextElement"]');
  const $walkFrom = $richContainer.length ? $richContainer : $heading;

  $walkFrom.nextAll().each((_i, el) => {
    if ($(el).is("h1, h2, h3, h4, h5, h6")) return false;
    // Wix pads empty blocks with U+200B ("wixGuard"), so a "​"-only line
    // became the location (Nov 2026); cleanLine strips it.
    const text = cleanLine($(el).text());
    if (text) lines.push(text);
    return true;
  });

  let date: string | null = null;
  let startTime: string | undefined;
  let location: string | undefined;
  let hares: string | undefined;

  for (const line of lines) {
    if (/we need hares/i.test(line)) break;

    const dt = !date ? parseDateTimeLine(line) : null;
    if (dt) {
      date = chronoParseDate(dt.dateStr, "en-US");
      startTime = parse12HourTime(dt.timeStr);
      continue;
    }

    const hareMatch = HARES_RE.exec(line);
    if (hareMatch) {
      hares = hareMatch[1].trim();
      continue;
    }

    if (SKIP_LINE_RE.test(line)) continue;
    location = mergeLocation(location, line);
  }

  if (!date) {
    return { event: null, error: `could not extract date for Hash #${runNumber}` };
  }

  return {
    event: {
      date,
      kennelTags: ["boiseh3"],
      runNumber,
      title,
      // The body "Hare:" line is the better-spelled one; the heading is only a fallback.
      hares: hares ?? inlineHares,
      location,
      startTime,
      sourceUrl,
    },
  };
}

/**
 * Boise Hash House Harriers (BoiseH3) HTML Scraper.
 *
 * Fetches https://www.boiseh3.org/ (home page) which renders the upcoming
 * Monday hash inline as static HTML. Daily scrape catches every weekly trail;
 * fingerprint dedup handles repeat scrapes between updates.
 */
export class BoiseH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || "https://www.boiseh3.org";
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { event, error } = parseBoiseH3Page(html, url);

    if (!event) {
      return {
        events: [],
        errors: [error ?? "no event found on page"],
        structureHash,
        diagnosticContext: { fetchDurationMs },
      };
    }

    return {
      events: [event],
      errors: [],
      structureHash,
      diagnosticContext: { eventsParsed: 1, fetchDurationMs },
    };
  }
}
