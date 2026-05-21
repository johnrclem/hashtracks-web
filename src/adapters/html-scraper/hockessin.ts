import { isText, type Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, parse12HourTime, chronoParseDate } from "../utils";

// All candidates are length-3 (space + 1 dash code unit + space) so the
// slice offset is uniform regardless of which separator matched. String
// search (not regex) avoids Sonar S5852's flag on `\s+[–—]\s+`.
const HOCKESSIN_DASH_CANDIDATES = [" - ", " – ", " — "];
const HOCKESSIN_DASH_LEN = 3;

/**
 * Split a Hash-header post-colon segment into hares + optional title. Handles
 * three shapes (#797, #1326, #1493) — see {@link parseHockessinEvent} JSDoc.
 * Extracted to keep `parseHockessinEvent` under the project's Sonar cognitive-
 * complexity threshold (S3776).
 */
function splitHaresAndTitle(postColon: string | undefined): {
  hares: string | undefined;
  title: string | undefined;
} {
  if (!postColon) return { hares: undefined, title: undefined };

  let dashIdx = -1;
  for (const sep of HOCKESSIN_DASH_CANDIDATES) {
    const idx = postColon.indexOf(sep);
    if (idx >= 0 && (dashIdx === -1 || idx < dashIdx)) dashIdx = idx;
  }
  if (dashIdx === -1) return { hares: postColon, title: undefined };

  return {
    hares: postColon.slice(0, dashIdx).trim() || undefined,
    title: postColon.slice(dashIdx + HOCKESSIN_DASH_LEN).trim() || undefined,
  };
}

/**
 * Parse a single event block from the Hockessin Hash homepage.
 *
 * The site uses 90s-era HTML with `<font>` and `<b>` tags, no CSS classes.
 * Each event has:
 *   <font color="..."><b>Hash #1661: Asshopper</b></font> <br>
 *   SATURDAY, April 18, 2026, 3:00pm, 715 Art Lane, Newark, DE <br>
 *
 * Three post-colon shapes are supported:
 *   1. `Hash #1661: Asshopper` — single segment is the hare(s) (#797)
 *   2. `Hash #1700:` — empty segment, both hares and title left undefined (#1326)
 *   3. `Hash #1665: Circle Jerk ... - Is It Summer Already??` — split on first
 *      space-dash-space: left is hares, right is the theme/title (#1493)
 *
 * @param headerText - The text from the <b> tag (e.g., "Hash #1661: Asshopper")
 * @param detailText - The raw text node after the header (date, time, location info)
 * @param sourceUrl  - Source URL for fallback
 */
export function parseHockessinEvent(
  headerText: string,
  detailText: string,
  sourceUrl: string,
): RawEventData | null {
  // Optional post-colon group so "Hash #1700:" (no trailing whitespace) still parses.
  const headerMatch = /Hash\s*#(\d+)(?:\s*:\s*(.*))?/i.exec(headerText);
  if (!headerMatch) return null;

  const runNumber = Number.parseInt(headerMatch[1], 10);
  const { hares, title } = splitHaresAndTitle(headerMatch[2]?.trim());

  const cleaned = detailText.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const date = chronoParseDate(cleaned, "en-US", undefined, { forwardDate: true });
  if (!date) return null;

  const startTime = parse12HourTime(cleaned);

  // Strip parenthetical notes like "(Prelube at 2:30PM, pack off 3:15)" before
  // locating the post-time address segment.
  const withoutParens = cleaned.replace(/\([^)]*\)/g, "");
  const timeMatch = /\d{1,2}:\d{2}\s*(?:am|pm)/i.exec(withoutParens);

  let location: string | undefined;
  if (timeMatch) {
    const after = withoutParens.substring(timeMatch.index + timeMatch[0].length).replace(/^,?\s*/, "").trim();
    // Reject placeholders like "TBA" / "TBD" so the kennel centroid fallback wins.
    if (after && !/^(?:tba|tbd|tbc)\.?$/i.test(after)) {
      location = after;
    }
  }

  return {
    date,
    kennelTags: ["hockessin"],
    runNumber: !Number.isNaN(runNumber) ? runNumber : undefined,
    // Title is populated only when the source has a distinct theme separated
    // from the hares by " - " (#1493); the bare `Hash #N: <hares>` shape leaves
    // it undefined so the UI/merge pipeline synthesizes from kennel + run #
    // (#1326).
    title,
    hares,
    location,
    startTime,
    sourceUrl,
  };
}

/**
 * Hockessin Hash House Harriers (H4) Website Scraper
 *
 * Scrapes hockessinhash.org — a 90s-era HTML page with events listed using
 * `<font>` and `<b>` tags. Each event block has a "Hash #NNN: Title" header
 * followed by date/time/location text.
 */
export class HockessinAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "https://www.hockessinhash.org/";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let blockIndex = 0;

    // Find <b> tags that contain "Hash #NNN" pattern
    $("b").each((_i, el) => {
      const $b = $(el);
      const headerText = $b.text().trim();

      if (!/Hash\s*#\d+/i.test(headerText)) return;

      blockIndex++;

      try {
        // Get the text content after this event header
        // Walk up to the parent <font> tag, then get the next text sibling
        const $parent = $b.parent();
        let detailText = "";

        // Get everything after the header's parent element until the next <br> or block
        // The detail text is typically the next text node sibling after the </font> tag
        const parentNode = $parent.length > 0 ? $parent[0] : $b[0];
        let sibling = parentNode.nextSibling;
        while (sibling) {
          if (isText(sibling)) {
            detailText += sibling.data;
          } else if (sibling.type === "tag") {
            const tagName = (sibling as Element).tagName?.toLowerCase();
            if (tagName === "br") {
              // Hit a <br> — check if we already have detail text
              if (detailText.trim()) break;
            } else if (tagName === "font" || tagName === "b") {
              // Hit the next event header — stop
              const innerText = $(sibling).text();
              if (/Hash\s*#\d+/i.test(innerText)) break;
            }
          }
          sibling = sibling.nextSibling;
        }

        const event = parseHockessinEvent(headerText, detailText, url);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing block ${blockIndex}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: blockIndex,
          error: String(err),
          rawText: headerText.slice(0, 2000),
        });
      }
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
