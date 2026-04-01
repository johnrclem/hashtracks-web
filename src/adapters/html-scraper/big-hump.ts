/**
 * Big Hump Hash House Harriers (BH4) Hareline Scraper — St. Louis, MO
 *
 * Scrapes big-hump.com/hareline.php — a PHP site using W3.CSS framework.
 *
 * Each event is a w3-card with:
 *   - Header: `<header class="w3-container w3-green"><h3>Wednesday 04/01/2026
 *     <span class="w3-text-amber">#1991</span></h3></header>`
 *   - Body h4: "Locknut Monster's April Fools' Trail @ Lemay"
 *   - Body span.w3-small: description text with circle-up time, address, hare info
 *
 * Date is MM/DD/YYYY in the header h3.
 * Run number is #NNNN in span.w3-text-amber or span.w3-text-red.
 * Title h4 text is split on last " @ " for hare(s)/location.
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage } from "../utils";

/**
 * Parse date and run number from a header h3 text.
 *
 * Input: "Wednesday 04/01/2026 #1991" or just the h3 inner text.
 * Returns date as "YYYY-MM-DD" and optional run number.
 */
export function parseEventHeader(headerText: string): {
  date: string | null;
  runNumber?: number;
} {
  // Date: MM/DD/YYYY
  const dateMatch = /(\d{2})\/(\d{2})\/(\d{4})/.exec(headerText);
  const date = dateMatch
    ? `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`
    : null;

  // Run number: #NNNN
  const runMatch = /#(\d+)/.exec(headerText);
  const runNumber = runMatch
    ? Number.parseInt(runMatch[1], 10)
    : undefined;

  return { date, runNumber };
}

/**
 * Parse h4 title text into hare(s) and location.
 *
 * Format: "Hare Name @ Location" — split on last " @ ".
 * If no " @ " separator, the whole string is the title (hares extracted from description).
 *
 * Returns title, hares, and location.
 */
export function parseEventTitle(h4Text: string): {
  title: string;
  hares?: string;
  location?: string;
} {
  const atIdx = h4Text.lastIndexOf(" @ ");
  if (atIdx === -1) {
    return { title: h4Text.trim() };
  }

  const harePart = h4Text.slice(0, atIdx).trim();
  const locationPart = h4Text.slice(atIdx + 3).trim();

  // The hare part is typically "HareName's Trail Name" or just "HareName"
  // Use it as the title; the hare is the portion before "'s" if present
  const possessiveMatch = /^(.+?)(?:'s?\s+.+)$/i.exec(harePart);
  const hares = possessiveMatch ? possessiveMatch[1].trim() : harePart;

  // Location: "???" means TBD
  const location =
    locationPart && locationPart !== "???" ? locationPart : undefined;

  return { title: h4Text.trim(), hares, location };
}

/**
 * Parse a start time from the description text.
 * Looks for "Circle up: 6:45 p.m." or "Meet to hash: 3pm" patterns.
 * Returns "HH:MM" or undefined.
 */
function parseTimeFromDescription(text: string): string | undefined {
  const match =
    /(?:Circle\s*up|Meet\s*(?:to\s*hash)?|Hash\s*(?:at)?)\s*:?\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?\s*m\.?)/i.exec(
      text,
    );
  if (!match) return undefined;

  let hours = Number.parseInt(match[1], 10);
  const minutes = match[2] || "00";
  const ampm = match[3].replace(/[\s.]/g, "").toLowerCase();

  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

/**
 * Parse a location/address from description text.
 * Looks for street address patterns (e.g., "3661 Reavis Barracks Rd, St Louis, MO 63125").
 */
function parseLocationFromDescription(text: string): string | undefined {
  const match = /\d+\s+[\w\s]+(?:St|Ave|Rd|Dr|Blvd|Ln|Way|Ct|Pl|Pkwy|Ter|Terr),?\s*[\w\s]+,?\s*(?:MO|IL)\s*\d{5}/i.exec(text);
  return match ? match[0].trim() : undefined;
}

/**
 * Parse hare name(s) from description text.
 * Looks for "Hare(s): Name" or "Hare(s) away:" patterns.
 */
function parseHaresFromDescription(text: string): string | undefined {
  const match = /Hares?\s*(?:\([^)]*\))?\s*:?\s*(.+?)(?=\n|$)/i.exec(text);
  if (!match) return undefined;
  const name = match[1].trim();
  // Filter out "away:" which is departure time, not hare name
  if (/^away/i.test(name)) return undefined;
  return name || undefined;
}

/**
 * Big Hump H3 Hareline Scraper
 *
 * Scrapes big-hump.com/hareline.php for upcoming events. Each event is a
 * w3-card with date, run number, hare @ location title, and description.
 */
export class BigHumpAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const harelineUrl =
      source.url || "http://www.big-hump.com/hareline.php";

    const page = await fetchHTMLPage(harelineUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Each event is a w3-card div containing header + body
    const cards = $("div.w3-card");

    cards.each((i, el) => {
      try {
        const $card = $(el);
        const header = $card.find("header h3");
        if (!header.length) return;

        // Parse date + run number from header
        const headerText = header.text().trim();
        const { date, runNumber } = parseEventHeader(headerText);
        if (!date) return;

        // Parse title (h4 inside the card body)
        const h4 = $card.find("h4").first();
        const h4Text = h4.text().trim();
        if (!h4Text) return;

        const { title, hares: titleHares, location: titleLocation } =
          parseEventTitle(h4Text);

        // Parse description from span.w3-small
        const descSpan = $card.find("span.w3-small");
        const descText = descSpan.text().trim();

        // Extract time, location, and hares from description (overrides title-based values)
        const descTime = parseTimeFromDescription(descText);
        const descLocation = parseLocationFromDescription(descText);
        const descHares = parseHaresFromDescription(descText);

        const event: RawEventData = {
          date,
          kennelTag: "bh4",
          runNumber,
          title,
          hares: descHares || titleHares,
          location: descLocation || titleLocation,
          startTime: descTime,
          sourceUrl: harelineUrl,
          description: descText || undefined,
        };

        events.push(event);
      } catch (err) {
        errors.push(`Error parsing card ${i}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: i,
          error: String(err),
        });
      }
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        cardsFound: cards.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
