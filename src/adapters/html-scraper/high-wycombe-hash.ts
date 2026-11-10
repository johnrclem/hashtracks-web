/**
 * High Wycombe H3 (HWH3, Chilterns, England) HTML Scraper
 *
 * hwh3.co.uk is a server-rendered ProcessWire site. Its home page "Runs list"
 * (`.runs_list > .rl_entry`) carries ~7 weeks of upcoming Tuesday runs with
 * date + time, an optional theme title, venue + town, postcode + Maps pin
 * (`?q=lat,lng`), hares, and an optional note. Run numbers aren't on the list;
 * they come from the kennel's own `hash-cal.ics`, whose UIDs read
 * `HASHID<run>`, joined to the list by date.
 *
 * The ICS is enrichment only: if it fails, the runs still ship without a run
 * number and the failure lands in `diagnosticContext`, not `errors[]`.
 */

import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { safeFetch } from "../safe-fetch";
import { buildDateWindow, configString, fetchHTMLPage, MONTHS, normalizeHaresField, stripPlaceholder } from "../utils";
import { extractCoordsFromMapsUrl } from "@/lib/geo";

const DEFAULT_URL = "https://www.hwh3.co.uk/";
const DEFAULT_ICS_URL = "https://www.hwh3.co.uk/hash-cal.ics";
const KENNEL_TAG = "hwh3";

/** "10 Nov 2026" → "2026-11-10" (UTC-noon convention: a plain calendar date). */
export function parseHwh3Date(text: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/.exec(text);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number.parseInt(m[1], 10);
  const year = Number.parseInt(m[3], 10);
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  if (d.getUTCDate() !== day || d.getUTCMonth() !== month - 1) return null;
  return d.toISOString().slice(0, 10);
}

/** "SL71QU" / "hp14 4sh" → "SL7 1QU" / "HP14 4SH" (UK postcodes end in a 3-char inward code). */
export function normalizeUkPostcode(text: string): string | undefined {
  const compact = text.replaceAll(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact)) return undefined;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/**
 * Map each ICS VEVENT's local start date to its run number (`UID:HASHID1879`).
 * A line scan, not a full iCal parse: the feed is a hand-rolled template with
 * mixed CRLF/LF line endings and no folded lines.
 */
export function parseHwh3RunNumbers(ics: string): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const block of ics.split("BEGIN:VEVENT").slice(1)) {
    const uid = /^UID:HASHID(\d+)/m.exec(block);
    const start = /^DTSTART[^:\n]*:(\d{4})(\d{2})(\d{2})/m.exec(block);
    if (!uid || !start) continue;
    byDate.set(`${start[1]}-${start[2]}-${start[3]}`, Number.parseInt(uid[1], 10));
  }
  return byDate;
}

/** Collapse runs of whitespace and trim. */
function squash(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/** Own text of an element, excluding its child elements' text (e.g. the town span). */
function ownText($: CheerioAPI, el: AnyNode): string {
  return squash($(el).contents().filter((_i, node) => node.type === "text").text());
}

/** Venue, postcode, Maps link and pin for one entry. A "Venue TBA" row clears all of them. */
function parseVenue($: CheerioAPI, $entry: Cheerio<AnyNode>): Partial<RawEventData> {
  const $venueLink = $entry.find(".rl_venue a").first();
  if ($venueLink.length === 0) {
    // "Venue TBA": explicit clears so a venue that reverts to TBA drops its old pin.
    return { location: null, locationStreet: null, dropCachedCoords: true };
  }
  const venue = ownText($, $venueLink[0]);
  const town = squash($venueLink.find(".text-muted").text());
  const $mapLink = $entry.find(".rl_loc a").first();
  const locationUrl = $mapLink.attr("href") || undefined;
  const coords = locationUrl ? extractCoordsFromMapsUrl(locationUrl) : null;
  return {
    location: [venue, town].filter(Boolean).join(", ") || null,
    locationStreet: normalizeUkPostcode($mapLink.text()) ?? null,
    locationUrl,
    latitude: coords?.lat,
    longitude: coords?.lng,
  };
}

/** Hares from the `.rl_hares` links, sorted for a stable fingerprint. */
function parseHares($: CheerioAPI, $entry: Cheerio<AnyNode>): string | null {
  const $hares = $entry.find(".rl_hares");
  const names = $hares
    .find("a")
    .map((_i, a) => squash($(a).text()))
    .get()
    .filter(Boolean);
  // null (not undefined) so a hare who drops out clears on the event.
  if (names.length === 0) return stripPlaceholder(squash($hares.text())) ?? null;
  return normalizeHaresField(names.join(", ")) ?? null;
}

/** Parse one `.rl_entry`. Returns null when the date can't be read. */
export function parseHwh3Entry(
  $: CheerioAPI,
  el: AnyNode,
  runNumbers: Map<string, number> = new Map(),
): RawEventData | null {
  const $entry = $(el);
  const $date = $entry.find(".rl_date").first();
  const date = parseHwh3Date(ownText($, $date[0] ?? el));
  if (!date) return null;

  const time = /^(\d{1,2}):(\d{2})$/.exec($date.find(".text-muted").text().trim());
  const title = squash($entry.find(".rl_title").text());
  const extra = $entry
    .find(".rl_extra p")
    .map((_i, p) => squash($(p).text()))
    .get()
    .filter(Boolean)
    .join(" ");
  const runNumber = runNumbers.get(date);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    // No theme → leave undefined so merge synthesizes "High Wycombe H3 Trail #N".
    title: title || undefined,
    startTime: time ? `${time[1].padStart(2, "0")}:${time[2]}` : undefined,
    ...parseVenue($, $entry),
    hares: parseHares($, $entry),
    // null (not undefined) so a note removed from the page clears on the event.
    description: extra || null,
    // Upcoming runs live under temporary "untitled-<timestamp>" slugs that the home page
    // doesn't link, and /hashes/<run>/ only resolves once a run is past — so link the list.
    sourceUrl: DEFAULT_URL,
  };
}

/** Fetch the ICS and build the date → run-number map. Never throws. */
async function fetchRunNumbers(icsUrl: string): Promise<{ map: Map<string, number>; error?: string }> {
  try {
    const res = await safeFetch(icsUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" } });
    if (!res.ok) return { map: new Map(), error: `ICS HTTP ${res.status}` };
    return { map: parseHwh3RunNumbers(await res.text()) };
  } catch (err) {
    return { map: new Map(), error: `ICS fetch failed: ${err}` };
  }
}

export class HighWycombeHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const icsUrl = configString(source.config, "icsUrl", DEFAULT_ICS_URL);
    const [page, ics] = await Promise.all([fetchHTMLPage(url), fetchRunNumbers(icsUrl)]);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const errors: string[] = [];
    const events: RawEventData[] = [];
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 365);
    const entries = $(".runs_list .rl_entry");
    let parsed = 0;

    entries.each((_i, el) => {
      const event = parseHwh3Entry($, el, ics.map);
      if (!event) return;
      parsed++;
      const d = new Date(`${event.date}T12:00:00Z`);
      if (d >= minDate && d <= maxDate) events.push(event);
    });

    // Single-page source: a markup change must fail loud, not "succeed" with 0 events.
    if (parsed === 0) {
      errors.push(`HWH3 runs list: 0 runs parsed from ${entries.length} .rl_entry nodes — markup drift`);
    }

    return {
      events,
      errors,
      structureHash,
      diagnosticContext: {
        entriesFound: entries.length,
        entriesParsed: parsed,
        eventsInWindow: events.length,
        icsRunNumbers: ics.map.size,
        runNumbersMatched: events.filter((e) => e.runNumber !== undefined).length,
        ...(ics.error ? { icsError: ics.error } : {}),
        fetchDurationMs,
      },
    };
  }
}
