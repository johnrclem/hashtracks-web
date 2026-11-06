/**
 * Cambridge H3 (Cambridge, England) scraper
 *
 * www.ch3.co.uk is a Blazor (.NET) app: plain fetches return an empty shell
 * and the data streams over SignalR, so the homepage is rendered through the
 * NAS headless browser (`browserRender`, waiting on `.RunList`).
 *
 * The rendered `.RunList` alternates `<h3>Month YYYY</h3>` headers with one
 * `<div>` per run (the next run has class `nextRun`):
 *   <span link>Run 2500 Nov 22nd</span> - <a>Hoops</a> , Barton,
 *   <a href="https://www.google.com/maps/dir/?api=1&destination=52.18,0.05">CB23 7BD</a> - Tel: …
 *   <br>Hare: <span>Jetstream and Unmentionable</span><br><span notes>…</span>
 * The year comes from the preceding month header. Undecided venues render as
 * "TBD , Anywhere, CB1 2JW" (a generic Cambridge postcode) and are dropped.
 * Venue phone numbers are never emitted.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { buildDateWindow, MONTHS } from "../utils";
import { browserRender } from "@/lib/browser-render";
import { generateStructureHash } from "@/pipeline/structure-hash";

const KENNEL_TAG = "cambridge-h3";
const DEFAULT_URL = "https://www.ch3.co.uk/";
const START_TIME = "11:00";
/** Postcode the site prints for every undecided ("TBD, Anywhere") venue. */
const PLACEHOLDER_POSTCODE = "CB1 2JW";

const RUN_HEAD_RE = /Run\s+(\d{3,5})\s+([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?/;
const MONTH_HEADER_RE = /^([A-Za-z]{3,9})\s+(\d{4})$/;
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

function clean(text: string): string {
  return text.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.toLowerCase();
  return v === "tbd" || v === "tba" || v === "tbc" || v === "anywhere";
}

/** Coordinates from a Google Maps directions link (`destination=lat,lng`). */
export function coordsFromDestination(href: string | undefined): { latitude: number; longitude: number } | undefined {
  if (!href) return undefined;
  try {
    const dest = new URL(href).searchParams.get("destination") ?? "";
    const [lat, lng] = dest.split(",").map((s) => Number.parseFloat(s));
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { latitude: lat, longitude: lng };
    }
  } catch {
    // not a URL — fall through
  }
  return undefined;
}

/**
 * Split "Hoops , Barton, CB23 7BD - Tel: 01223 344 995" into venue + street.
 * The phone suffix is dropped; the TBD/Anywhere/CB1 2JW placeholder yields nothing.
 */
export function splitVenue(text: string): { location?: string; locationStreet?: string } {
  const withoutTel = clean(text.split(/\s-\s*Tel:/i)[0]).replace(/^-\s*/, "");
  const parts = withoutTel.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return {};
  const [venue, ...rest] = parts;
  const street = rest.filter((p) => !isPlaceholder(p) && p.toUpperCase() !== PLACEHOLDER_POSTCODE);
  if (isPlaceholder(venue)) return {};
  return { location: venue, locationStreet: street.length > 0 ? street.join(", ") : undefined };
}

/** Parse the rendered homepage `.RunList` into RawEventData. */
export function parseCambridgeRunList(html: string, sourceUrl = DEFAULT_URL): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  let headerYear: number | undefined;
  let headerMonth: number | undefined;

  $(".RunList").first().children().each((_i, el) => {
    const $el = $(el);
    if (el.tagName === "h3") {
      const m = MONTH_HEADER_RE.exec(clean($el.text()));
      headerMonth = m ? MONTHS[m[1].toLowerCase()] : undefined;
      headerYear = m ? Number.parseInt(m[2], 10) : undefined;
      return;
    }
    if (el.tagName !== "div" || headerYear === undefined) return;

    const head = RUN_HEAD_RE.exec(clean($el.find("span[link]").first().text()));
    if (!head) return;
    const month = MONTHS[head[2].toLowerCase()];
    if (!month) return;
    // A run listed under the previous month's header can't happen, but a
    // December run under a "January YYYY" header would mean the prior year.
    const year = headerMonth === 1 && month === 12 ? headerYear - 1 : headerYear;
    const day = Number.parseInt(head[3], 10);
    const dt = new Date(Date.UTC(year, month - 1, day, 12));
    if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return;

    const notes = clean($el.find("span[notes]").first().text());
    const $body = $el.clone();
    $body.find("span[link], span[notes]").remove();
    const bodyText = clean($body.text());
    const hareIdx = bodyText.search(/Hares?:/i);
    const venueText = hareIdx === -1 ? bodyText : bodyText.slice(0, hareIdx);
    const hares = hareIdx === -1 ? "" : clean(bodyText.slice(hareIdx).replace(/^Hares?:/i, ""));

    const mapHref = $el.find('a[href*="google.com/maps"]').first().attr("href");
    const { location, locationStreet } = splitVenue(venueText);
    const coords = location ? coordsFromDestination(mapHref) : undefined;

    events.push({
      date: dt.toISOString().slice(0, 10),
      kennelTags: [KENNEL_TAG],
      runNumber: Number.parseInt(head[1], 10),
      startTime: START_TIME,
      location,
      locationStreet,
      locationUrl: location ? mapHref : undefined,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      hares: hares && !isPlaceholder(hares) ? hares : undefined,
      description: notes || undefined,
      sourceUrl,
    });
  });

  return events;
}

export class CambridgeHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const fetchStart = Date.now();
    let html: string;
    try {
      html = await browserRender({ url, waitFor: ".RunList", timezoneId: "Europe/London", timeout: 30000 });
    } catch (err) {
      const message = `Browser render failed: ${err}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } };
    }
    const fetchDurationMs = Date.now() - fetchStart;
    const structureHash = generateStructureHash(html);

    const parsed = parseCambridgeRunList(html, url);
    if (parsed.length === 0) {
      return {
        events: [],
        errors: ["Cambridge H3: 0 runs parsed from the rendered .RunList — Blazor render or markup drift"],
        structureHash,
        diagnosticContext: { htmlBytes: html.length, fetchDurationMs },
      };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 90);
    const events = parsed.filter((e) => {
      const d = new Date(`${e.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });

    return {
      events,
      errors: [],
      structureHash,
      diagnosticContext: { runsParsed: parsed.length, eventsInWindow: events.length, fetchDurationMs },
    };
  }
}
