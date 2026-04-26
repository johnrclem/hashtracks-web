import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  chronoParseDate,
  parse12HourTime,
  fetchBrowserRenderedPage,
  isPlaceholder,
} from "../utils";

/**
 * Parse a single Makesweat `.ms_event` element into RawEventData.
 */
/** Extract Makesweat event ID from element class attribute. */
export function extractMakesweatId(
  $event: import("cheerio").Cheerio<import("domhandler").AnyNode>,
): string | undefined {
  const classAttr = $event.attr("class") || "";
  const match = classAttr.match(/makesweatevent-(\d+)/);
  return match ? match[1] : undefined;
}

export function parseMakesweatEvent(
  $: import("cheerio").CheerioAPI,
  $event: import("cheerio").Cheerio<import("domhandler").AnyNode>,
  sourceUrl: string,
  makesweatId?: string,
): RawEventData | null {
  // Title: "City Hash R*n #1912 International Women's Day @ The Old Star"
  const rawTitle = $event.find(".ms_eventtitle").first().text().trim();
  if (!rawTitle) return null;

  // Run number from #NNNN
  const runNumMatch = rawTitle.match(/#(\d+)/);
  const runNumber = runNumMatch ? parseInt(runNumMatch[1], 10) : undefined;

  // Date from .ms_event_startdate — "Tue 10th Mar 26"
  const dateText = $event.find(".ms_event_startdate").first().text().trim();
  const date = dateText ? chronoParseDate(dateText, "en-GB") : null;
  if (!date) return null;

  // Start time from .ms_eventstart — "7:00pm"
  const timeText = $event.find(".ms_eventstart").first().text().trim();
  const startTime = timeText ? parse12HourTime(timeText) : "19:00";

  // Hares from .ms_eventdescription — match "Hare(s) - Name". CTA-shaped values
  // ("We need a Hare, Contact Full Load!", "Hare needed", etc.) flow through to
  // the merge pipeline's sanitizeHares which uses CTA_EMBEDDED_PATTERNS to
  // recognize them and write `haresText: null`. This is the only path that
  // CLEARS a stale haresText on an existing canonical event — returning
  // `undefined` here would leave the merge UPDATE branch as a no-op for the
  // hares field, so a value like "69 Virgins to Paradise" (#949) would persist
  // forever even after the source switched to a placeholder. See #963.
  let hares: string | undefined;
  const descText = $event.find(".ms_eventdescription").first().text().trim();
  if (descText) {
    const hareMatch = descText.match(/Hares?\s*[-–—]\s*(.+?)(?:\n|$)/i);
    if (hareMatch) {
      hares = hareMatch[1].trim() || undefined;
    }
  }

  // Venue fields
  const venueName = $event.find(".ms_venue_name").first().text().trim();
  const venueAddress = $event.find(".ms_venue_address").first().text().trim();
  const venuePostcode = $event.find(".ms_venue_postcode").first().text().trim();
  const venueStation = $event.find(".ms_venue_ptransport").first().text().trim();
  const venueNotes = $event.find(".ms_venue_notes").first().text().trim();

  // Build composite location: "Pub Name, Street Address, Postcode"
  // Normalize UK postcodes jammed against venue name without separator
  // (e.g., "Pub NameSW98AG" → "Pub Name, SW9 8AG") but leave properly
  // separated names like "Old Star, London E8 2HG" unchanged.
  let location: string | undefined;
  if (venueName && !isPlaceholder(venueName)) {
    let normalizedName = venueName;
    // Only match postcode directly abutting a letter (no comma/space separator).
    // Use [a-z] not \w to avoid false-positives on venue names ending in digits.
    const jammedPostcode = normalizedName.match(/([a-z])([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i);
    if (jammedPostcode) {
      const pc = jammedPostcode[2].replace(/^([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})$/i, "$1 $2");
      normalizedName = normalizedName.slice(0, (jammedPostcode.index ?? 0) + 1).trim();
      const parts = [normalizedName, venueAddress].filter(Boolean);
      parts.push(pc);
      location = parts.join(", ");
    } else {
      const parts = [normalizedName, venueAddress].filter(Boolean);
      if (venuePostcode && !parts.some((p) => p.includes(venuePostcode))) {
        parts.push(venuePostcode);
      }
      location = parts.join(", ");
    }
  }

  // Build description with station + venue notes
  const descParts: string[] = [];
  if (venueStation) {
    descParts.push(`Nearest station: ${venueStation}`);
  }
  if (venueNotes) {
    descParts.push(venueNotes);
  }
  const description = descParts.length > 0 ? descParts.join(". ") : undefined;

  // Build clean title: strip prefix, strip "@ Venue" suffix, strip date
  const theme = rawTitle
    .replace(/City Hash R\*?n\s*#\d+\s*/i, "") // strip "City Hash R*n #NNNN"
    .replace(/@\s*.+$/, "")                     // strip "@ Venue Name"
    .replace(/[-–—]\s*\d{1,2}(?:st|nd|rd|th)\s+\w+\s+\d{2,4}/i, "") // strip date
    .trim()
    .replace(/^[-–—]\s*/, "")  // strip leading dash
    .trim();

  const title = theme
    ? `City Hash Run #${runNumber} - ${theme}`
    : `City Hash Run #${runNumber}`;

  // External links
  const externalLinks = makesweatId
    ? [{ url: `https://makesweat.com/event.html?id=${makesweatId}`, label: "Makesweat" }]
    : undefined;

  return {
    date,
    kennelTag: "cityh3",
    runNumber,
    title,
    hares,
    location,
    startTime,
    sourceUrl,
    description,
    externalLinks,
  };
}

/**
 * City Hash (London) Makesweat Scraper
 *
 * Scrapes makesweat.com/cityhash for upcoming runs via the NAS headless browser
 * rendering service. Makesweat is a JS-rendered SPA with structured venue data
 * (name, address, postcode, transport) in clean CSS-class-based elements.
 */
export class CityHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://makesweat.com/cityhash#hashes";

    const page = await fetchBrowserRenderedPage(baseUrl, {
      waitFor: ".ms_event",
      timeout: 20000,
    });
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Track seen Makesweat IDs to dedup (each event appears twice in DOM)
    const seenIds = new Set<string>();

    const cards = $(".ms_event");
    cards.each((i, el) => {
      try {
        // Dedup by Makesweat event ID
        const makesweatId = extractMakesweatId($(el));
        if (makesweatId) {
          if (seenIds.has(makesweatId)) return;
          seenIds.add(makesweatId);
        }

        const event = parseMakesweatEvent($, $(el), baseUrl, makesweatId);
        if (event) {
          events.push(event);
        } else {
          const titleText = $(el).find(".ms_eventtitle").text().trim();
          errors.push(`Could not parse event ${i}: ${titleText}`);
          (errorDetails.parse ??= []).push(
            { row: i, section: "ms_event", field: "date", error: `Could not parse: ${titleText}`, rawText: $(el).text().trim().slice(0, 2000) },
          );
        }
      } catch (err) {
        errors.push(`Error parsing event ${i}: ${err}`);
        (errorDetails.parse ??= []).push(
          { row: i, section: "ms_event", error: String(err), rawText: $(el).text().trim().slice(0, 2000) },
        );
      }
    });

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        cardsFound: cards.length,
        eventsDeduped: seenIds.size,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
