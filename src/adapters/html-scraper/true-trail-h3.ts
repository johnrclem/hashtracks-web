import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ParseError } from "../types";
import { fetchHTMLPage, decodeEntities, chronoParseDate, buildDateWindow, stripPlaceholder } from "../utils";

const KENNEL_TAG = "tth3-ab";
const DEFAULT_START_TIME = "18:30";

/**
 * Parse a True Trail event heading for run number and title.
 * Handles split `<strong>` tags like `<strong>#1</strong>70` → "#170".
 * Format: "#NNN – Title" or "#NNN - Title"
 */
export function parseTrueTrailHeading(text: string): { runNumber?: number; title?: string } | null {
  const m = /^#(\d+)\s*[–—-]\s*(.+)$/i.exec(text.trim());
  if (!m) return null;
  return {
    runNumber: parseInt(m[1], 10),
    title: m[2].trim(),
  };
}

/**
 * Extract hares from a paragraph line.
 * Format: "Hares: Name1, Name2"
 */
export function extractHares(text: string): string | undefined {
  const m = /^Hares?\s*:\s*(.+)/i.exec(text.trim());
  if (!m) return undefined;
  const hares = m[1].trim();
  // Skip placeholder hare names
  if (/^(?:sexy )?hares? needed$/i.test(hares)) return undefined;
  return stripPlaceholder(hares);
}

/**
 * Check if text is the fixed footer block (Pack Gathers, Hare Off, etc.)
 */
function isFooterBlock(text: string): boolean {
  return /Pack Gathers/i.test(text);
}

/**
 * Check if text is a filler/boilerplate line (e.g., "More Detrails to Cum!")
 */
function isBoilerplate(text: string): boolean {
  return /More Detrails to Cum/i.test(text);
}

/**
 * True Trail H3 Adapter — Edmonton biweekly Thursday hash
 *
 * Scrapes truetrailh3.com, a Gutenverse-powered WordPress site. Events are
 * in wp-block-group divs separated by gutenverse-divider elements.
 * The page has a "Hare Line" summary at the top (compact list) followed by
 * detailed event blocks — we only parse the detailed blocks.
 *
 * Structure per event:
 *   <h2>#NNN – Title</h2>
 *   <p>Date</p>
 *   <p>Venue name</p>  (optional)
 *   <p>Street address</p>  (optional)
 *   <p>Hares: Name1, Name2</p>
 *   <p>Description</p>  (optional)
 *   <p>Pack Gathers: 6:30 ...</p>  (fixed footer)
 */
export class TrueTrailH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "https://truetrailh3.com/";
    const days = options?.days ?? source.scrapeDays ?? 365;
    const { minDate, maxDate } = buildDateWindow(days);

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $ } = page;
    const events: RawEventData[] = [];
    const parseErrors: ParseError[] = [];

    // Find all h2 headings that match event pattern (#NNN – Title)
    const headings = $("h2.wp-block-heading").toArray();

    for (let hIdx = 0; hIdx < headings.length; hIdx++) {
      const h2El = $(headings[hIdx]);

      // Reconstruct text by combining inner text (handles split <strong> tags)
      const headingText = decodeEntities(h2El.text()).trim();
      const heading = parseTrueTrailHeading(headingText);
      if (!heading) continue;

      // Collect sibling <p> elements until next divider or h2
      const siblings: string[] = [];

      // Walk siblings of h2 within the same group container
      let sibling = h2El.next();
      while (sibling.length) {
        const tag = sibling.prop("tagName")?.toLowerCase();

        // Stop at next heading or divider
        if (tag === "h2") break;
        if (sibling.hasClass("wp-block-gutenverse-divider") || sibling.find(".guten-divider").length) break;

        if (tag === "p") {
          const text = decodeEntities(sibling.text()).trim();
          if (text) siblings.push(text);
        }

        sibling = sibling.next();
      }

      // Parse fields from sibling paragraphs
      let date: string | undefined;
      let venueName: string | undefined;
      let streetAddress: string | undefined;
      let hares: string | undefined;
      const descParts: string[] = [];

      for (const text of siblings) {
        // Skip footer blocks and boilerplate
        if (isFooterBlock(text)) continue;
        if (isBoilerplate(text)) continue;

        // Try date first
        if (!date) {
          const d = chronoParseDate(text, "en-US", undefined, { forwardDate: true });
          if (d) {
            date = d;
            continue;
          }
        }

        // Hares
        const h = extractHares(text);
        if (h) { hares = h; continue; }

        // If we have a date but no venue yet, this is likely the venue name
        if (date && !venueName && !streetAddress) {
          // Check if it looks like a street address (has numbers)
          if (/^\d+\s/.test(text)) {
            streetAddress = text;
          } else {
            venueName = text;
          }
          continue;
        }

        // If we have a venue but no address, check for street address
        if (date && venueName && !streetAddress && /^\d+\s/.test(text)) {
          streetAddress = text;
          continue;
        }

        // Check for labeled fields (Shiggy, Trail, Bring)
        if (/^(?:Shiggy|Trail|Bring)\s*:/i.test(text)) {
          descParts.push(text);
          continue;
        }

        // Remaining text is description
        descParts.push(text);
      }

      if (!date) {
        parseErrors.push({
          row: hIdx,
          field: "date",
          error: `No date found for event #${heading.runNumber}`,
          partialData: { kennelTag: KENNEL_TAG, runNumber: heading.runNumber, title: heading.title },
        });
        continue;
      }

      // Date window filter
      const eventDate = new Date(date + "T12:00:00Z");
      if (eventDate < minDate || eventDate > maxDate) continue;

      // Build location
      const locationParts: string[] = [];
      if (venueName) locationParts.push(venueName);
      if (streetAddress) locationParts.push(streetAddress);
      const location = locationParts.length > 0 ? locationParts.join(", ") : undefined;

      events.push({
        date,
        kennelTag: KENNEL_TAG,
        runNumber: heading.runNumber,
        title: heading.title,
        hares,
        location,
        locationStreet: streetAddress,
        startTime: DEFAULT_START_TIME,
        description: descParts.length > 0 ? descParts.join(" | ") : undefined,
        sourceUrl: url,
      });
    }

    return {
      events,
      errors: [],
      structureHash: page.structureHash,
      errorDetails: parseErrors.length > 0 ? { parse: parseErrors } : undefined,
      diagnosticContext: {
        headingsFound: headings.length,
        eventsParsed: events.length,
        fetchDurationMs: page.fetchDurationMs,
      },
    };
  }
}
