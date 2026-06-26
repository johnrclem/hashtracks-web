/**
 * Tidewater Hash House Harriers (TWH3) — tidewaterh3.org `/calendar`
 *
 * The calendar page is static SSR HTML that inlines a FullCalendar feed as a
 * JavaScript array literal:
 *
 *   const trailCalendarEvents = [ {...}, {...} ];
 *
 * Each entry carries an ISO `start`/`end` and a structured `extendedProps`
 * object (title, kennel, hares, gather/start times, location, cost,
 * description). FullCalendar reads the static array, so there is no separate
 * JSON endpoint to hit — we parse the island directly.
 *
 * The feed mixes three kinds of entry:
 *   - `type: "trail"`  — real scheduled trails (run number, hares, location)
 *   - `type: "event"`  — real special events (Dining-In, ShiggyFest, …)
 *   - `type: "schedule"` (className `calendar-scheduled-placeholder`) — generic
 *     forward stubs projecting the weekly kennels' schedules out ~12 months.
 *
 * We ingest all real events plus placeholders within a bounded forward window
 * (replacing the retired STATIC_SCHEDULE source), and drop past entries (they
 * are placeholders only — the site keeps no real archive).
 *
 * The feed serves several sibling kennels off one page; each entry's pill
 * `title` (TH3 / T3H3 / HOBOH3 / VBFMH3 / MoSH3 / TKDH3) and `extendedProps.kennel`
 * route it to its own kennel.
 *
 * Trail length + Shiggy/difficulty are not in the calendar JSON — they live on
 * the per-event detail pages (`/trail/<slug>`, `/event/<slug>`), which carry an
 * `.event-grid` of labeled fields. We enrich the (few) real in-window trails
 * from their detail pages, best-effort.
 *
 * We also fetch `/upcoming-events` (like BFM's `/bfm-special-events/`), a
 * dedicated page of `article.special-event-card` blocks for multi-day campouts
 * / anniversaries / Dining-Ins. Those carry Start+End datetimes (→ `endDate`),
 * cost, organizer, and a HashRego registration link (→ `externalLinks`), so we
 * emit them as rich multi-day events and suppress the calendar's bare
 * single-date `type:"event"` copies for the same kennel+date.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import {
  chronoParseDate,
  decodeEntities,
  extractHashRunNumber,
  fetchHTMLPage,
  parse12HourTime,
  stripHtmlTags,
  stripPlaceholder,
} from "../utils";

const DEFAULT_URL = "https://tidewaterh3.org/calendar";
const EVENTS_PATH = "/upcoming-events";
const DEFAULT_PLACEHOLDER_WINDOW_DAYS = 120;
const REAL_EVENT_WINDOW_DAYS = 365;
const MAX_DETAIL_ENRICHMENTS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pill code (uppercased `entry.title`) → kennelCode. `extendedProps.kennel`
 * full names provide a secondary map. The site advertises ~11 sub-kennels but
 * only active ones appear in the feed at any time; unrecognized kennels are
 * handled by {@link lookupKennel} (emitted as `unmapped-*`, failing closed at
 * the merge source-kennel guard).
 */
const PILL_TO_KENNEL: Record<string, string> = {
  TH3: "twh3",
  T3H3: "t3h3-va",
  HOBOH3: "hoboh3",
  VBFMH3: "vbfmh3",
  MOSH3: "mosh3",
  TKDH3: "tkdh3",
};

const KENNEL_NAME_TO_KENNEL: Record<string, string> = {
  // Full names as the feed currently emits them, plus the short "H3" display
  // variants (mirrors aliases.ts) so a relabel doesn't fall through to unmapped.
  "tidewater hash house harriers": "twh3",
  "tidewater h3": "twh3",
  "tuesday tuesday tuesday hash house harriers": "t3h3-va",
  "tuesday tuesday tuesday h3": "t3h3-va",
  "hobo hash house harriers": "hoboh3",
  "hobo h3": "hoboh3",
  "virginia beach full moon h3": "vbfmh3",
  "vb full moon h3": "vbfmh3",
  "men of shenanigans h3": "mosh3",
  "men of shenanigans": "mosh3",
  tkdh3: "tkdh3",
};

/** Tag emitted for an unrecognized kennel — slugified from its pill/name so it
 * fails closed at the source-kennel guard (SOURCE_KENNEL_MISMATCH) instead of
 * being misattributed to the host kennel. */
function unknownKennelTag(pill?: string, kennelName?: string): string {
  const raw = (pill || kennelName || "unknown").trim().toLowerCase();
  // Runs of non-alphanumerics already collapse to a single "-", so at most one
  // edge dash remains — `^-|-$` (no `+`) trims it without backtracking (S8786).
  const slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `unmapped-${slug}` : "unmapped-kennel";
}

/** Decimal "lat, lng" pair (the feed's coordinate-style locationAddress). */
const DECIMAL_COORDS_RE = /^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/;
/** A run number following the word "Trail" when no `#NNN` marker is present.
 * 1–5 digits so single-/double-digit runs (new sub-kennels) aren't missed; the
 * "Trail" anchor already prevents matching a stray year like "ShiggyFest 2026". */
const TRAIL_NUMBER_RE = /\bTrail\s+#?(\d{1,5})\b/i;

/** Link-button texts that share the special-event "Details" label with the
 * prose blurb — excluded when picking the description. */
const DETAIL_LINK_LABELS = new Set(["view event details", "view details", "view on hashrego"]);

/** Shape of one entry in the inline `trailCalendarEvents` array (partial). */
interface CalendarEntry {
  id?: string;
  title?: string;
  start?: string;
  end?: string;
  className?: string;
  url?: string;
  extendedProps?: {
    type?: string;
    title?: string;
    kennel?: string;
    hares?: string;
    gatherTime?: string;
    startTime?: string;
    location?: string;
    locationAddress?: string;
    locationUrls?: { google?: string; apple?: string } | unknown[];
    cost?: string;
    description?: string;
  };
}

/**
 * Extract the `trailCalendarEvents = [ ... ]` array literal from the page via a
 * bracket-depth scan (string-literal aware). Avoids regex backtracking on the
 * ~88 KB page and the risk of an inner `];` truncating a non-greedy match.
 * Returns the parsed array, or null if the island is absent / malformed.
 */
/** Index of the `]` closing the array opened at `start`, or -1. String-aware. */
function findArrayEndIndex(html: string, start: number): number {
  let depth = 0;
  let inString = false;
  let quote = "";
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++; // skip escaped char
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]" && --depth === 0) {
      return i;
    }
  }
  return -1;
}

export function extractCalendarArray(html: string): CalendarEntry[] | null {
  const markerIdx = html.indexOf("trailCalendarEvents");
  if (markerIdx === -1) return null;
  const start = html.indexOf("[", markerIdx);
  if (start === -1) return null;
  const end = findArrayEndIndex(html, start);
  if (end === -1) return null;

  try {
    const parsed = JSON.parse(html.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as CalendarEntry[]) : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a kennelCode from a pill code and/or a full kennel name. Either may
 * be supplied; the first recognized one wins. Unrecognized kennels get an
 * `unmapped-<slug>` tag (NOT the host kennel) + `known: false`, so their events
 * fail closed at the merge source-kennel guard (SOURCE_KENNEL_MISMATCH alert)
 * rather than being silently misattributed to TWH3 — the site has more
 * sub-kennels than the six mapped here, so new ones must surface, not corrupt.
 */
export function lookupKennel(pill?: string, kennelName?: string): { code: string; known: boolean } {
  const p = (pill ?? "").trim().toUpperCase();
  if (PILL_TO_KENNEL[p]) return { code: PILL_TO_KENNEL[p], known: true };

  const n = (kennelName ?? "").trim().toLowerCase();
  if (KENNEL_NAME_TO_KENNEL[n]) return { code: KENNEL_NAME_TO_KENNEL[n], known: true };

  return { code: unknownKennelTag(pill, kennelName), known: false };
}

/** Map a calendar entry to a kennelCode + whether it was a recognized kennel. */
export function resolveKennel(entry: CalendarEntry): { code: string; known: boolean } {
  return lookupKennel(entry.title, entry.extendedProps?.kennel);
}

/** Run number from a title: `#NNN` marker first, then `Trail NNN`. */
export function parseRunNumber(title: string | undefined): number | undefined {
  const fromHash = extractHashRunNumber(title);
  if (fromHash) return fromHash;
  if (!title) return undefined;
  const m = TRAIL_NUMBER_RE.exec(title);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/** Derive "HH:MM" from an ISO local datetime ("2026-06-28T13:30:00"). */
function startTimeFromIso(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : undefined;
}

/** Strip tags + decode HTML entities; collapse whitespace. */
function cleanHtmlText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return decodeEntities(stripHtmlTags(value)) || undefined;
}

/**
 * Resolve venue name + address into the canonical location fields. Coordinate-
 * style addresses ("lat, lng") set lat/lng directly; street addresses populate
 * locationStreet. The display `location` prefers the venue name, falling back to
 * the street address only when no coordinates were parsed. Shared by both the
 * calendar and special-event parsers.
 */
function parseLocation(
  venue: string | undefined,
  addr: string | undefined,
): {
  location: string | undefined;
  locationStreet: string | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
} {
  let latitude: number | undefined;
  let longitude: number | undefined;
  let locationStreet: string | undefined;
  if (addr) {
    const coords = DECIMAL_COORDS_RE.exec(addr);
    if (coords) {
      latitude = Number.parseFloat(coords[1]);
      longitude = Number.parseFloat(coords[2]);
    } else {
      locationStreet = addr;
    }
  }
  const location = venue ?? (latitude === undefined ? addr : undefined);
  return { location, locationStreet, latitude, longitude };
}

function isPlaceholderEntry(entry: CalendarEntry): boolean {
  return (
    entry.extendedProps?.type === "schedule" ||
    (entry.className ?? "").includes("placeholder")
  );
}

/** Map a single calendar entry to RawEventData (no detail enrichment). */
export function parseCalendarEntry(
  entry: CalendarEntry,
  sourceUrl: string,
): { event: RawEventData; isPlaceholder: boolean; isSpecialEvent: boolean } | null {
  const start = entry.start;
  if (!start) return null;
  const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(start);
  if (!dateMatch) return null;
  const date = dateMatch[1];

  const props = entry.extendedProps ?? {};
  const placeholder = isPlaceholderEntry(entry);
  const { code } = resolveKennel(entry);

  const title = cleanHtmlText(props.title ?? entry.title);
  const runNumber = placeholder ? undefined : parseRunNumber(title);
  // The ISO `start` is the *gather* time (FullCalendar block start); the actual
  // trail start is `extendedProps.startTime`. Prefer it, fall back to the ISO.
  const startTime =
    (props.startTime ? parse12HourTime(props.startTime) : undefined) ?? startTimeFromIso(start);
  const hares = placeholder ? undefined : stripPlaceholder(props.hares);
  const cost = placeholder ? undefined : stripPlaceholder(props.cost);

  const { location, locationStreet, latitude, longitude } = parseLocation(
    stripPlaceholder(props.location),
    stripPlaceholder(props.locationAddress),
  );
  const locationUrls = props.locationUrls;
  const locationUrl =
    locationUrls && !Array.isArray(locationUrls) ? locationUrls.google : undefined;

  // Description: gather time + (non-boilerplate) notes.
  const gatherLine = props.gatherTime ? `Gather: ${props.gatherTime.trim()}.` : "";
  const notes = placeholder ? undefined : cleanHtmlText(props.description);
  const description = [gatherLine, notes].filter(Boolean).join(" ") || undefined;

  const detailUrl = entry.url ? new URL(entry.url, sourceUrl).href : undefined;

  // Multi-day entries (the special events) carry a later `end`; preserve it as
  // endDate so the fallback path (when /upcoming-events is unavailable) still
  // records the weekend range instead of collapsing to a single day.
  const endMatch = entry.end ? /^(\d{4}-\d{2}-\d{2})/.exec(entry.end) : null;
  const endDate = endMatch && endMatch[1] !== date ? endMatch[1] : undefined;

  const event: RawEventData = {
    date,
    endDate,
    kennelTags: [code],
    title,
    runNumber,
    startTime,
    hares,
    location,
    locationStreet,
    locationUrl,
    latitude,
    longitude,
    cost,
    description,
    sourceUrl: detailUrl ?? sourceUrl,
  };

  return { event, isPlaceholder: placeholder, isSpecialEvent: props.type === "event" };
}

/**
 * Parse the inline calendar feed into windowed events. Pure + time-injectable
 * for testing. Real events use a wide forward cap; placeholders are bounded to
 * `days`. Past entries are dropped (the feed keeps no real archive).
 *
 * `rawCount` is the size of the parsed island (before windowing) so the caller
 * can distinguish "page had no feed" (fail loud) from "feed had only
 * out-of-window entries".
 */
export function parseTidewaterCalendar(
  html: string,
  opts: { now: Date; days?: number; sourceUrl: string; suppressEventKeys?: Set<string> },
): { events: RawEventData[]; rawCount: number; unknownKennels: string[] } {
  const arr = extractCalendarArray(html);
  if (!arr) return { events: [], rawCount: 0, unknownKennels: [] };
  const suppress = opts.suppressEventKeys ?? new Set<string>();

  const events: RawEventData[] = [];
  const unknownKennels = new Set<string>();

  for (const entry of arr) {
    const parsed = parseCalendarEntry(entry, opts.sourceUrl);
    if (!parsed) continue;
    const { event, isPlaceholder, isSpecialEvent } = parsed;

    // Special events are owned by the richer /upcoming-events page (multi-day
    // endDate + HashRego links). Drop the calendar's bare single-date copy when
    // the events page already supplied this kennel+date.
    if (isSpecialEvent && suppress.has(`${event.kennelTags[0]}|${event.date}`)) continue;
    if (!isWithinWindow(event.date, isPlaceholder, opts.now, opts.days)) continue;

    if (!resolveKennel(entry).known) {
      unknownKennels.add(`${entry.title ?? "?"} / ${entry.extendedProps?.kennel ?? "?"}`);
    }
    events.push(event);
  }

  return { events, rawCount: arr.length, unknownKennels: [...unknownKennels] };
}

/**
 * Window gate: drop past events; cap placeholders to `days` (default) and real
 * events to the wider {@link REAL_EVENT_WINDOW_DAYS} horizon.
 */
function isWithinWindow(date: string, isPlaceholder: boolean, now: Date, days?: number): boolean {
  const ms = new Date(date + "T12:00:00Z").getTime();
  if (ms < now.getTime() - DAY_MS) return false; // include today
  const maxDays = isPlaceholder ? (days ?? DEFAULT_PLACEHOLDER_WINDOW_DAYS) : REAL_EVENT_WINDOW_DAYS;
  return ms <= now.getTime() + maxDays * DAY_MS;
}

/**
 * Parse the `/upcoming-events` page's `article.special-event-card` blocks into
 * multi-day special events (campouts, anniversaries, Dining-In) with `endDate`
 * + a HashRego `externalLink`. These supersede the calendar's bare single-date
 * `type:"event"` entries. Pure + time-injectable for testing.
 */
export function parseSpecialEvents(
  html: string,
  opts: { now: Date; sourceUrl: string },
): { events: RawEventData[]; unknownKennels: string[] } {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  const unknownKennels = new Set<string>();

  const minMs = opts.now.getTime() - 1 * 24 * 60 * 60 * 1000; // include today
  const maxMs = opts.now.getTime() + REAL_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  $("article.special-event-card").each((_i, el) => {
    const $card = $(el);
    const title = $card.find(".special-event-title").first().text().replace(/\s+/g, " ").trim();
    const subtitle = $card.find(".event-subtitle").first().text().replace(/\s+/g, " ").trim();
    const host = $card
      .find(".special-event-kennel")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .replace(/^hosted by\s*/i, "")
      .trim();

    // Field label → values (labels like "Details" repeat: prose + link text).
    const fields: Record<string, string[]> = {};
    $card.find(".event-field").each((_j, fe) => {
      const label = $(fe).find(".event-label").first().text().trim().toLowerCase();
      if (!label) return;
      const value = $(fe).find(".event-value").first().text().replace(/\s+/g, " ").trim();
      fields[label] ??= [];
      fields[label].push(value);
    });

    const startRaw = fields["start"]?.[0];
    const date = startRaw ? chronoParseDate(startRaw) : null;
    if (!date) return;

    const eventMs = new Date(date + "T12:00:00Z").getTime();
    if (eventMs < minMs || eventMs > maxMs) return;

    const titleToken = title.split(/\s+/)[0];
    const { code, known } = lookupKennel(titleToken, host);
    if (!known) unknownKennels.add(`${title} / ${host}`);

    const endRaw = fields["end"]?.[0];
    const endDateParsed = endRaw ? chronoParseDate(endRaw) : null;
    const endDate = endDateParsed && endDateParsed !== date ? endDateParsed : undefined;

    const { location, locationStreet, latitude, longitude } = parseLocation(
      undefined,
      stripPlaceholder(fields["address"]?.[0] ?? fields["location"]?.[0]),
    );

    // The prose blurb shares the "Details" label with link buttons; drop the
    // known link labels (not a length heuristic, so short blurbs survive) and
    // take the longest remaining.
    const detailsProse = (fields["details"] ?? [])
      .filter((v) => !DETAIL_LINK_LABELS.has(v.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    const description =
      [subtitle, detailsProse].filter(Boolean).join(" — ") || undefined;

    const mapUrl = $card.find("a.map-link").first().attr("href");
    const hashrego = $card.find('a[href*="hashrego.com"]').first().attr("href");
    const detailHref = $card.find('a[href^="/event/"]').first().attr("href");

    events.push({
      date,
      endDate,
      kennelTags: [code],
      title: title || undefined,
      startTime: startRaw ? parse12HourTime(startRaw) : undefined,
      hares: stripPlaceholder(fields["organizer"]?.[0]),
      location,
      locationStreet,
      locationUrl: mapUrl ? mapUrl.replaceAll("&amp;", "&") : undefined,
      latitude,
      longitude,
      cost: stripPlaceholder(fields["cost"]?.[0]),
      description,
      externalLinks: hashrego ? [{ url: hashrego, label: "Hash Rego" }] : undefined,
      sourceUrl: detailHref ? new URL(detailHref, opts.sourceUrl).href : opts.sourceUrl,
    });
  });

  return { events, unknownKennels: [...unknownKennels] };
}

// ---- Detail-page enrichment (trail length + Shiggy/difficulty) ----

/** Parse "2-4 Miles" / "2.69" / "Yes" into verbatim text + numeric bounds. */
export function parseTrailLength(raw: string | undefined): {
  text: string | null;
  min: number | null;
  max: number | null;
} {
  const text = stripPlaceholder(raw);
  if (!text) return { text: null, min: null, max: null };
  // Match the numbers, then use a plain `includes("-")` to detect a range —
  // avoids the backtracking-prone `\d+...\s*-\s*\d+...` pattern (S8786).
  const nums = text.match(/\d+(?:\.\d+)?/g);
  if (nums && nums.length >= 2 && text.includes("-")) {
    return { text, min: Number.parseFloat(nums[0]), max: Number.parseFloat(nums[1]) };
  }
  if (nums && nums.length >= 1) {
    const v = Number.parseFloat(nums[0]);
    return { text, min: v, max: v };
  }
  // Unparseable (e.g. "Yes") — keep verbatim text, clear bounds (atomic bundle).
  return { text, min: null, max: null };
}

/** Parse a Shiggy value into an Int 1–5 (rounded). Out-of-range → null. */
export function parseShiggy(raw: string | undefined): { difficulty: number | null; text: string | null } {
  const text = stripPlaceholder(raw);
  if (!text) return { difficulty: null, text: null };
  const m = /(\d+(?:\.\d+)?)/.exec(text);
  if (!m) return { difficulty: null, text };
  const v = Number.parseFloat(m[1]);
  if (!Number.isFinite(v) || v < 1 || v > 5) return { difficulty: null, text };
  return { difficulty: Math.round(v), text };
}

/** Read a detail page's `.event-grid` label→value map. */
export function parseDetailGrid(html: string): {
  trailLengthText: string | null;
  trailLengthMinMiles: number | null;
  trailLengthMaxMiles: number | null;
  difficulty: number | null;
  shiggyText: string | null;
  trailType: string | null;
} {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $(".event-field").each((_i, el) => {
    const label = $(el).find(".event-label").first().text().trim().toLowerCase();
    if (!label) return;
    const $value = $(el).find(".event-value").first();
    $value.find("br").replaceWith(" ");
    fields[label] = $value.text().replace(/\s+/g, " ").trim();
  });

  const length = parseTrailLength(fields["length"]);
  const shiggy = parseShiggy(fields["shiggy"]);
  return {
    trailLengthText: length.text,
    trailLengthMinMiles: length.min,
    trailLengthMaxMiles: length.max,
    difficulty: shiggy.difficulty,
    shiggyText: shiggy.text,
    trailType: stripPlaceholder(fields["trail type"]) ?? null,
  };
}

export class TidewaterH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || DEFAULT_URL;

    const now = new Date();
    const days = options?.days;
    const errors: string[] = [];
    // Non-fatal fetch failures (secondary events page, detail pages) surface
    // here for operator visibility. Deliberately NOT pushed to `errors[]`:
    // scrape.ts gates reconcile + FAILED status on `errors.length`, and a
    // transient secondary-page outage must not block reconcile of the good
    // calendar events (best-effort contract).
    const errorDetails: ErrorDetails = {};

    // Fetch the calendar and the (best-effort) /upcoming-events page
    // concurrently — they are independent. fetchHTMLPage never throws; it
    // signals failure via `ok: false`.
    const eventsUrl = new URL(EVENTS_PATH, sourceUrl).href;
    const [page, eventsPage] = await Promise.all([
      fetchHTMLPage(sourceUrl),
      fetchHTMLPage(eventsUrl),
    ]);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    // The richer /upcoming-events page (multi-day campouts + HashRego links). A
    // failure here must not fail the scrape — the calendar's bare type:"event"
    // entries remain as a fallback.
    let special: RawEventData[] = [];
    let specialUnknown: string[] = [];
    let specialFetchError: string | undefined;
    if (eventsPage.ok) {
      const parsed = parseSpecialEvents(eventsPage.html, { now, sourceUrl: eventsUrl });
      special = parsed.events;
      specialUnknown = parsed.unknownKennels;
    } else {
      specialFetchError = `HTTP error fetching ${eventsUrl}`;
      errorDetails.fetch ??= [];
      errorDetails.fetch.push({ url: eventsUrl, message: specialFetchError });
    }
    // Suppress the calendar's single-date copies of events the events page owns.
    const suppressEventKeys = new Set(special.map((e) => `${e.kennelTags[0]}|${e.date}`));

    const { events: calendarEvents, rawCount, unknownKennels } = parseTidewaterCalendar(html, {
      now,
      days,
      sourceUrl,
      suppressEventKeys,
    });

    // Fail loud: HTTP 200 but no parseable feed, or no events anywhere in
    // window. Either case must NOT return empty-success — that would let the
    // reconciler cancel the whole kennel family. (#reconcile-blind-to-dropped-rows)
    if (rawCount === 0) {
      const message = "No trailCalendarEvents feed found on /calendar (page structure changed?)";
      const errorDetails: ErrorDetails = { parse: [{ row: 0, section: "calendar", error: message }] };
      return { events: [], errors: [message], structureHash, errorDetails };
    }
    if (calendarEvents.length + special.length === 0) {
      const message = `Calendar feed had ${rawCount} entries but none fell in the scrape window`;
      const errorDetails: ErrorDetails = { parse: [{ row: 0, section: "calendar", error: message }] };
      return { events: [], errors: [message], structureHash, errorDetails };
    }

    const allUnknown = [...new Set([...unknownKennels, ...specialUnknown])];
    if (allUnknown.length > 0) {
      console.warn(
        `[tidewater-h3] ${allUnknown.length} unrecognized kennel(s) emitted as unmapped tags (will block at source-kennel guard — onboard them): ${allUnknown.join("; ")}`,
      );
    }

    // Best-effort detail-page enrichment for the calendar's real trails (those
    // with a detail URL) — recovers trail length + Shiggy/difficulty not in the
    // feed. Special events (campouts) are already complete from the cards.
    const detailFailures: string[] = [];
    const enrichable = calendarEvents
      .filter((e) => e.sourceUrl && e.sourceUrl !== sourceUrl)
      .slice(0, MAX_DETAIL_ENRICHMENTS);
    // Fetch detail pages concurrently; each mutates its own event in place.
    await Promise.all(
      enrichable.map(async (event) => {
        const url = event.sourceUrl as string;
        const detail = await fetchHTMLPage(url);
        if (!detail.ok) {
          detailFailures.push(url);
          errorDetails.fetch ??= [];
          errorDetails.fetch.push({ url, message: `HTTP error fetching detail page ${url}` });
          return;
        }
        const grid = parseDetailGrid(detail.html);
        event.trailLengthText = grid.trailLengthText;
        event.trailLengthMinMiles = grid.trailLengthMinMiles;
        event.trailLengthMaxMiles = grid.trailLengthMaxMiles;
        event.difficulty = grid.difficulty;
        event.trailType = grid.trailType;
        if (grid.shiggyText) {
          event.description = [event.description, `Shiggy: ${grid.shiggyText}.`]
            .filter(Boolean)
            .join(" ");
        }
      }),
    );

    const allEvents = [...special, ...calendarEvents];

    return {
      events: allEvents,
      errors,
      errorDetails: errorDetails.fetch?.length ? errorDetails : undefined,
      structureHash,
      diagnosticContext: {
        rawCount,
        eventsParsed: allEvents.length,
        calendarEvents: calendarEvents.length,
        specialEvents: special.length,
        specialFetchError,
        enrichedAttempted: enrichable.length,
        detailFailures: detailFailures.length > 0 ? detailFailures : undefined,
        unknownKennels: allUnknown.length > 0 ? allUnknown : undefined,
        fetchDurationMs,
      },
    };
  }
}
