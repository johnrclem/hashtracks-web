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
    const trailName = trailMatch[2]?.trim() || undefined;
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

    // Skip fields with TBD/placeholder values
    if (/:\s*TBD\s*$/i.test(cleaned) || /:\s*No no no\s*$/i.test(cleaned)) {
      continue;
    }

    // Keep any remaining non-empty detail lines
    if (cleaned) {
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

    // BCH3 is Wisconsin (Milwaukee) — America/Chicago. Wix renders calendar
    // dates client-side via Intl.DateTimeFormat, so the rendering browser's
    // timezone determines what string we see. Without this, Playwright's UTC
    // default produced "Friday, May 1, AT 12 AM" for what the kennel
    // authored as "Thursday, April 30, AT 8 PM CDT" — the date label was
    // rounded forward across midnight UTC and the time degenerated to the
    // 12 AM placeholder branch. See #960.
    const page = await fetchBrowserRenderedPage(calendarUrl, {
      waitFor: '[role="listitem"]',
      timeout: 20000,
      timezoneId: "America/Chicago",
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
            const afterColon = stripPlaceholder(h6Text.replace(/^Location:\s*/i, "").replace(/\u00A0/g, " ").trim());
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
          const strippedLoc = stripPlaceholder(locVal);
          if (strippedLoc && strippedLoc.length > 1) { // >1 filters zero-width space artifacts from empty Wix fields
            locationFromLabel = strippedLoc;
          }
        }

        // 4. Facebook event link
        const fbLink = $item.find('a[href*="facebook.com/events"]').attr("href");
        const externalLinks: Array<{ label: string; url: string }> = [];
        if (fbLink && /^https?:\/\//i.test(fbLink)) {
          externalLinks.push({ label: "Facebook Event", url: fbLink });
        }

        // 5. Detail paragraph with emoji fields
        // Replace <br> with newlines before extracting text so parseDetails can split on them
        const $p = $item.find("p").first();
        $p.find("br").replaceWith("\n");
        const detailText = $p.text().trim();
        const details = detailText ? parseDetails(detailText) : {};

        // Prefer the explicit "Location:" header (full venue name) over On-Out (often abbreviated).
        // When both are present and differ, keep On-Out as the street address.
        const location = locationFromLabel || details.location || undefined;
        const locationStreet =
          locationFromLabel && details.location && details.location !== locationFromLabel
            ? details.location
            : undefined;

        const event: RawEventData = {
          date,
          kennelTags: ["bch3"],
          title,
          runNumber,
          hares: details.hares,
          location,
          locationStreet,
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

    // Deduplicate by run number or title+date (Wix repeater can duplicate content)
    const seenRuns = new Set<number>();
    const seenKeys = new Set<string>();
    const dedupedEvents: RawEventData[] = [];
    for (const event of windowFiltered) {
      const runNum = event.runNumber ?? undefined;
      if (runNum !== undefined && seenRuns.has(runNum)) continue;
      const titleKey = `${event.date}|${event.title}`;
      if (runNum === undefined && seenKeys.has(titleKey)) continue;
      if (runNum !== undefined) seenRuns.add(runNum);
      seenKeys.add(titleKey);
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
