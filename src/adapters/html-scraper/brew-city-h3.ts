import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, buildDateWindow, stripPlaceholder, fetchBrowserRenderedPage } from "../utils";

/**
 * Parse time from the Wix date heading, e.g. "Friday, April 3, 2026 AT 8 PM"
 * Returns HH:MM string or undefined.
 */
export function parseDateTime(text: string): { date: string | null; startTime: string | undefined } {
  // Match: "DayOfWeek, Month Day, Year AT Hour AM/PM"
  const match = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*(\w+\s+\d{1,2},\s*\d{4})\s+AT\s+(\d{1,2})\s*(AM|PM)/i.exec(text);
  if (!match) {
    return { date: null, startTime: undefined };
  }

  const dateStr = match[2]; // e.g., "April 3, 2026"
  const date = chronoParseDate(dateStr, "en-US");

  let hours = Number.parseInt(match[3], 10);
  const ampm = match[4].toUpperCase();
  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  // 12 AM is a Wix placeholder meaning "date only, no real time"
  const startTime = (hours === 0)
    ? undefined
    : `${hours.toString().padStart(2, "0")}:00`;

  return { date, startTime };
}

/**
 * Extract title and run number from h2 text.
 * Patterns:
 * - "BCH3 Trail #359: Moonlit Easter Egg Hunt Hash III"
 * - "BCH3 Trail #361: Beer Mile"
 * - "Easter Hash" (no trail number)
 * - "World Circus Day?"
 */
export function parseTitle(text: string): { title: string; runNumber: number | undefined } {
  const trailMatch = /BCH3\s+Trail\s+#(\d+)(?::\s*(.+))?/i.exec(text);
  if (trailMatch) {
    const runNumber = Number.parseInt(trailMatch[1], 10);
    const trailName = trailMatch[2]?.trim()
      // Strip leading emoji from trail name
      ?.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*/gu, "")
      .trim();
    const title = trailName || `BCH3 Trail #${runNumber}`;
    return { title, runNumber };
  }
  return { title: text.trim(), runNumber: undefined };
}

/**
 * Parse emoji-prefixed detail fields from the paragraph block.
 * Expected format (br-separated lines in a single <p>):
 *   Hare: Amber Alert
 *   Theme: Moonlit Easter Egg Hunt
 *   Distance: 4 or 5
 *   On-Out: 5880 S Packard Ave, Cudahy, WI 53110
 *   Hash cash: $8
 */
export function parseDetails(text: string): {
  hares?: string;
  location?: string;
  description?: string;
} {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let hares: string | undefined;
  let location: string | undefined;
  const descParts: string[] = [];

  for (const line of lines) {
    // Strip leading emoji(s) and whitespace
    const cleaned = line.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*/gu, "").trim();

    const hareMatch = /^Hare:\s*(.+)/i.exec(cleaned);
    if (hareMatch) {
      hares = hareMatch[1].trim();
      continue;
    }

    const onOutMatch = /^On-Out:\s*(.+)/i.exec(cleaned);
    if (onOutMatch) {
      location = stripPlaceholder(onOutMatch[1].trim()) || undefined;
      continue;
    }

    // Collect other detail lines for description
    const themeMatch = /^Theme:\s*(.+)/i.exec(cleaned);
    if (themeMatch) {
      descParts.push(`Theme: ${themeMatch[1].trim()}`);
      continue;
    }

    const distMatch = /^Distance:\s*(.+)/i.exec(cleaned);
    if (distMatch && stripPlaceholder(distMatch[1].trim())) {
      descParts.push(`Distance: ${distMatch[1].trim()}`);
      continue;
    }

    const cashMatch = /^Hash cash:\s*(.+)/i.exec(cleaned);
    if (cashMatch) {
      descParts.push(`Hash cash: ${cashMatch[1].trim()}`);
      continue;
    }

    // Skip TBD-only fields
    if (/^(Shiggy level|Dog friendly|Bathroom on trail|Booze plan):\s*TBD$/i.test(cleaned)) {
      continue;
    }

    // Keep non-trivial detail lines
    if (cleaned && !(/^(Shiggy level|Dog friendly|Bathroom on trail|Booze plan):/i.test(cleaned))) {
      descParts.push(cleaned);
    }
  }

  return {
    hares,
    location,
    description: descParts.length > 0 ? descParts.join("; ") : undefined,
  };
}

/**
 * Brew City Hash House Harriers (BCH3) — Milwaukee, WI
 *
 * Scrapes brewcityh3.com/calendar via the NAS headless browser rendering service.
 * The site is built on Wix with a repeater component listing upcoming events.
 * Each repeater item contains:
 * - h6 with date/time (e.g., "Friday, April 3, 2026 AT 12 AM")
 * - h2 with title (e.g., "BCH3 Trail #359: Moonlit Easter Egg Hunt Hash III")
 * - h6 with "Location:" label + separate element with location value
 * - Facebook event link
 * - p with emoji-prefixed detail fields (hare, hash cash, on-out, etc.)
 */
export class BrewCityH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const calendarUrl = source.url || "https://www.brewcityh3.com/calendar";

    const page = await fetchBrowserRenderedPage(calendarUrl, {
      waitFor: "h2",
      timeout: 20000,
    });

    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Each event is in a Wix repeater item (role="listitem")
    const listItems = $('[role="listitem"]');

    listItems.each((idx, item) => {
      try {
        const $item = $(item);

        // 1. Date/time from h6
        const dateText = $item.find("h6").first().text().trim();
        const { date, startTime } = parseDateTime(dateText);
        if (!date) {
          errors.push(`No date found in listitem ${idx}: "${dateText.slice(0, 100)}"`);
          errorDetails.parse = [
            ...(errorDetails.parse ?? []),
            { row: idx, error: "No date found", rawText: dateText.slice(0, 500) },
          ];
          return;
        }

        // 2. Title from h2 (skip header h2 elements outside repeater items)
        const titleText = $item.find("h2").first().text().trim();
        if (!titleText) return;

        const { title, runNumber } = parseTitle(titleText);

        // 3. Location from the element after the "Location:" h6
        let locationFromLabel: string | undefined;
        $item.find("h6").each((_i, h6El) => {
          const h6Text = $(h6El).text().trim();
          if (/^Location:/i.test(h6Text)) {
            // Location value is in a sibling or the text after "Location:"
            const afterColon = h6Text.replace(/^Location:\s*/i, "").replace(/\u00A0/g, " ").trim();
            if (afterColon) {
              locationFromLabel = afterColon;
            }
          }
        });

        // Check for location value in the next rich-text element after "Location:" h6
        if (!locationFromLabel) {
          const locationValueEl = $item.find("h6").filter((_i, el) =>
            /^Location:/i.test($(el).text().trim())
          ).closest("[data-testid='richTextElement']").next("[data-testid='richTextElement']");
          const locVal = locationValueEl.text().trim().replace(/\u200B/g, "").replace(/\u00A0/g, " ").trim();
          if (locVal && locVal.length > 1) { // >1 filters zero-width space artifacts from empty Wix fields
            locationFromLabel = locVal;
          }
        }

        // 4. Facebook event link
        const fbLink = $item.find('a[href*="facebook.com/events"]').attr("href");
        const externalLinks: Array<{ label: string; url: string }> = [];
        if (fbLink) {
          externalLinks.push({ label: "Facebook Event", url: fbLink });
        }

        // 5. Detail paragraph with emoji fields
        // Replace <br> with newlines before extracting text so parseDetails can split on them
        const $p = $item.find("p").first();
        $p.find("br").replaceWith("\n");
        const detailText = $p.text().trim();
        const details = detailText ? parseDetails(detailText) : {};

        // Location: prefer On-Out address from details, fall back to label
        const location = details.location || locationFromLabel || undefined;

        const event: RawEventData = {
          date,
          kennelTag: "bch3",
          title,
          runNumber,
          hares: details.hares,
          location,
          startTime,
          description: details.description,
          sourceUrl: calendarUrl,
          externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
        };

        events.push(event);
      } catch (err) {
        errors.push(`Error parsing listitem ${idx}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: idx, error: String(err), rawText: $(item).text().slice(0, 2000) },
        ];
      }
    });

    // Filter by date window
    const { minDate, maxDate } = buildDateWindow(options?.days ?? source.scrapeDays ?? 365);
    const windowFiltered = events.filter((e) => {
      const d = new Date(e.date + "T12:00:00Z");
      return d >= minDate && d <= maxDate;
    });

    // Deduplicate by run number (Wix repeater can duplicate content)
    const seen = new Set<number>();
    const dedupedEvents: RawEventData[] = [];
    for (const event of windowFiltered) {
      if (event.runNumber && seen.has(event.runNumber)) continue;
      if (event.runNumber) seen.add(event.runNumber);
      dedupedEvents.push(event);
    }

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events: dedupedEvents,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        listItemsFound: listItems.length,
        eventsParsed: dedupedEvents.length,
        fetchDurationMs,
      },
    };
  }
}
