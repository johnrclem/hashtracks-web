import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { validateSourceConfig, stripHtmlTags, buildDateWindow } from "../utils";
import { safeFetch } from "../safe-fetch";

/** US state abbreviation → full name mapping (50 states + DC). */
const US_STATE_ABBREV_TO_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

const US_STATE_NAME_SET = new Set(Object.values(US_STATE_ABBREV_TO_NAME).map(s => s.toLowerCase()));

/** States whose full names are also common city names — don't skip these as cities. */
const STATE_CITY_AMBIGUOUS = new Set([
  "new york", "washington", "georgia", "virginia", "indiana", "colorado",
  "delaware", "hawaii", "alaska", "montana", "wyoming", "oregon", "idaho",
  "iowa", "ohio", "utah", "maine", "nevada",
]);

/** Strip trailing `, XX` or `, StateName` from text when a separate state field exists. */
export function stripTrailingState(name: string, stateAbbrev: string | undefined): string {
  if (!stateAbbrev) return name;
  const abbrevRe = new RegExp(`,\\s*${stateAbbrev.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  let cleaned = name.replace(abbrevRe, "").trim();
  const fullName = US_STATE_ABBREV_TO_NAME[stateAbbrev.toUpperCase()];
  if (fullName) {
    const fullRe = new RegExp(`,\\s*${fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
    cleaned = cleaned.replace(fullRe, "").trim();
  }
  return cleaned || name;
}

/** Collapse doubled consecutive words: "Miami Miami" → "Miami". Loops until stable to handle 3+ repeats. */
export function deduplicateWords(text: string): string {
  let result = text;
  let previous;
  do {
    previous = result;
    result = result.replace(/\b(\w+(?:\s+\w+){0,2})\s+\1\b/gi, "$1");
  } while (result !== previous);
  return result;
}

/** Returns true if `city` is a US state full name but NOT an ambiguous city name. */
export function isStateFullName(city: string): boolean {
  const lower = city.toLowerCase().trim();
  if (STATE_CITY_AMBIGUOUS.has(lower)) return false;
  return US_STATE_NAME_SET.has(lower);
}

/** Source.config shape for Meetup sources. */
export interface MeetupConfig {
  /** Meetup group URL name, e.g. "brooklyn-hash-house-harriers". */
  groupUrlname: string;
  /** Kennel shortName to assign all events to. */
  kennelTag: string;
  /** Optional per-event kennel routing: [[regexPattern, kennelTag], ...] */
  kennelPatterns?: [string, string][];
}

/** Shape of an event entry in Meetup's __NEXT_DATA__ Apollo state. */
interface ApolloEvent {
  __typename: string;
  id: string;
  title?: string;
  dateTime?: string;
  endTime?: string;
  status?: string;
  description?: string;
  eventUrl?: string;
  venue?: { __ref?: string; name?: string; address?: string; city?: string; state?: string; lat?: number; lng?: number } | null;
  series?: { __ref?: string } | null;
}

const NUMERIC_ID_RE = /^\d+$/;

/**
 * Returns true if the ID is purely numeric (customized occurrence).
 * Meetup uses numeric IDs for customized occurrences and alphanumeric tokens for templates.
 */
export function isNumericId(id: string): boolean {
  return NUMERIC_ID_RE.test(id);
}

/**
 * Deduplicates events that share the same date, preferring customized occurrences
 * (numeric ID) over templates (alphanumeric token ID).
 * When multiple customized occurrences share a date, all are kept.
 */
export function dedupByDate(events: ApolloEvent[]): ApolloEvent[] {
  const byDate = new Map<string, ApolloEvent[]>();
  const noDates: ApolloEvent[] = [];
  for (const ev of events) {
    if (!ev.dateTime) {
      noDates.push(ev);
      continue;
    }
    const date = ev.dateTime.slice(0, 10);
    const group = byDate.get(date);
    if (group) {
      group.push(ev);
    } else {
      byDate.set(date, [ev]);
    }
  }

  // For each date group, prefer customized (numeric ID) over templates
  const result: ApolloEvent[] = [];
  for (const group of byDate.values()) {
    const numeric = group.filter((ev) => isNumericId(ev.id));
    result.push(...(numeric.length > 0 ? numeric : group));
  }

  return [...result, ...noDates];
}

/**
 * Extract Event objects from Meetup's __NEXT_DATA__ script tag (Apollo state).
 * Returns an empty array if the state isn't found or can't be parsed.
 */
export function extractApolloEvents(html: string): { events: ApolloEvent[]; state: Record<string, Record<string, unknown>> } {
  const $ = cheerio.load(html);
  const scriptEl = $("#__NEXT_DATA__");
  if (!scriptEl.length) return { events: [], state: {} };

  try {
    const nextData = JSON.parse(scriptEl.text());
    const state: Record<string, Record<string, unknown>> = nextData?.props?.pageProps?.__APOLLO_STATE__;
    if (!state || typeof state !== "object") return { events: [], state: {} };

    const events: ApolloEvent[] = [];
    for (const v of Object.values(state)) {
      if (v != null && typeof v === "object" && (v as Record<string, unknown>).__typename === "Event") {
        events.push(v as unknown as ApolloEvent);
      }
    }

    return { events, state };
  } catch {
    return { events: [], state: {} };
  }
}

/**
 * Resolve a venue from Apollo state — handles both inline objects and __ref lookups.
 * Deduplicates venue parts to avoid garbled output from corrupt Meetup data
 * (e.g. "Miami Miami, FL, Miami Miami, FL, Florida, FL" → "Miami Miami, FL, Florida").
 */
export function resolveVenue(
  state: Record<string, Record<string, unknown>>,
  venue: ApolloEvent["venue"],
): { location?: string; latitude?: number; longitude?: number } {
  if (!venue) return {};

  // Resolve __ref if present
  const resolved = venue.__ref ? (state[venue.__ref] as ApolloEvent["venue"]) : venue;
  if (!resolved) return {};

  // Incrementally build location, cleaning corrupt data from each field
  const parts: string[] = [];

  if (resolved.name) {
    let name = resolved.name;
    // Filter Google Maps UI artifacts that bleed into venue names
    if (/^(?:maps|google\s*maps)$/i.test(name.trim())) {
      name = "";
    }
    // Skip compound-address names where name = "address, city, zip" (not a real venue name)
    if (resolved.address && name && name.startsWith(resolved.address) && name.length > resolved.address.length) {
      name = "";
    }
    if (resolved.state && name) {
      const stripped = stripTrailingState(name, resolved.state);
      // Only deduplicate words when state-stripping detected corruption (state was embedded in name)
      name = stripped !== name ? deduplicateWords(stripped) : stripped;
    }
    if (name) parts.push(name);
  }

  if (resolved.address) {
    let addr = resolved.address;
    if (resolved.state) {
      const stripped = stripTrailingState(addr, resolved.state);
      // Only deduplicate words when state-stripping detected corruption (state was embedded in address)
      addr = stripped !== addr ? deduplicateWords(stripped) : stripped;
    }
    const nameMatch = parts[0] && addr.toLowerCase() === parts[0].toLowerCase();
    if (!nameMatch && addr) parts.push(addr);
  }

  const joined = () => parts.join(", ");

  if (resolved.city) {
    // Only suppress city when it equals the full name of THIS specific state (not any state).
    // e.g. city="Florida" + state="FL" → suppress; city="California" + state="MO" → keep.
    const stateFullName = resolved.state
      ? US_STATE_ABBREV_TO_NAME[resolved.state.toUpperCase()]
      : undefined;
    const cityIsCurrentState =
      stateFullName !== undefined &&
      resolved.city.toLowerCase().trim() === stateFullName.toLowerCase() &&
      !STATE_CITY_AMBIGUOUS.has(resolved.city.toLowerCase().trim());

    if (!cityIsCurrentState) {
      const priorText = joined().toLowerCase();
      if (!priorText.includes(resolved.city.toLowerCase())) {
        parts.push(resolved.city);
      }
    }
  }

  if (resolved.state) {
    // Skip state if it appears as a word-boundary match in prior parts
    const stateRe = new RegExp(`\\b${resolved.state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!stateRe.test(joined())) {
      parts.push(resolved.state);
    }
  }

  return {
    location: parts.length > 0 ? parts.join(", ") : undefined,
    latitude: typeof resolved.lat === "number" ? resolved.lat : undefined,
    longitude: typeof resolved.lng === "number" ? resolved.lng : undefined,
  };
}

/** Strip HTML tags from Meetup description and truncate. */
function cleanMeetupDescription(desc: string | undefined): string | undefined {
  if (!desc) return undefined;
  return stripHtmlTags(desc).slice(0, 2000) || undefined;
}

/**
 * Extract local date and time from an ISO 8601 dateTime string.
 * "2026-03-05T18:30:00-05:00" → { date: "2026-03-05", startTime: "18:30" }
 * Uses the local portion of the string (not UTC conversion).
 */
function extractDateTime(dateTime: string): { date: string; startTime: string } {
  return {
    date: dateTime.slice(0, 10),
    startTime: dateTime.slice(11, 16),
  };
}

/** Pre-compile kennel pattern strings into RegExp objects. */
function compileKennelPatterns(
  patterns?: [string, string][],
): [RegExp, string][] | undefined {
  if (!patterns) return undefined;
  const compiled: [RegExp, string][] = [];
  for (const [pattern, tag] of patterns) {
    try { compiled.push([new RegExp(pattern, "i"), tag]); }
    catch { /* skip malformed regex */ }
  }
  return compiled.length > 0 ? compiled : undefined;
}

/** Build a RawEventData from an Apollo event entry. */
export function buildRawEventFromApollo(
  ev: ApolloEvent,
  state: Record<string, Record<string, unknown>>,
  kennelTag: string,
  compiledPatterns?: [RegExp, string][],
): RawEventData {
  const { date, startTime } = ev.dateTime
    ? extractDateTime(ev.dateTime)
    : { date: "", startTime: undefined };

  const venueInfo = resolveVenue(state, ev.venue);

  // Override kennelTag if title matches a kennel pattern
  let resolvedKennelTag = kennelTag;
  if (compiledPatterns && ev.title) {
    for (const [re, tag] of compiledPatterns) {
      if (re.test(ev.title)) {
        resolvedKennelTag = tag;
        break;
      }
    }
  }

  return {
    date,
    kennelTag: resolvedKennelTag,
    title: ev.title || undefined,
    description: cleanMeetupDescription(ev.description),
    location: venueInfo.location,
    latitude: venueInfo.latitude,
    longitude: venueInfo.longitude,
    startTime,
    sourceUrl: ev.eventUrl || undefined,
  };
}

/**
 * For recurring events (those with a `series` field), fetch the individual
 * detail page to get customized title/description. Template events on the
 * list page often show generic data ("Saturday Trail!") instead of the
 * per-occurrence customization ("SAVH3 Trail #1324!").
 *
 * Non-fatal: individual fetch failures fall back to the list page data.
 * Concurrency limited to 3 concurrent fetches with 300ms batch delay.
 */
async function enrichRecurringEvents(
  events: ApolloEvent[],
  headers: Record<string, string>,
): Promise<{ detailPagesFetched: number; detailPagesEnriched: number }> {
  const recurring = events.filter((ev) => ev.series && ev.eventUrl);
  if (recurring.length === 0) return { detailPagesFetched: 0, detailPagesEnriched: 0 };

  let detailPagesEnriched = 0;
  const CONCURRENCY = 3;
  const BATCH_DELAY_MS = 300;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < recurring.length; i += CONCURRENCY) {
    if (i > 0) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));

    const batch = recurring.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (ev) => {
        const res = await safeFetch(ev.eventUrl!, { headers });
        if (!res.ok) return null;
        const html = await res.text();
        const { events: detailEvents } = extractApolloEvents(html);
        // Find the matching event on the detail page
        const match = detailEvents.find((d) => d.id === ev.id);
        return match ?? null;
      }),
    );

    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value) {
        const detail = result.value;
        const ev = batch[j];
        if (detail.title) ev.title = detail.title;
        if (detail.description) ev.description = detail.description;
        detailPagesEnriched++;
      }
    }
  }

  return { detailPagesFetched: recurring.length, detailPagesEnriched };
}

/**
 * Meetup.com HTML scraper adapter.
 *
 * Scrapes the public events page and extracts event data from the
 * embedded __APOLLO_STATE__ JSON (the Meetup v3 REST API was shut down
 * in Jan 2022 and the GraphQL API requires OAuth).
 *
 * Config: { groupUrlname: string, kennelTag: string }
 */
export class MeetupAdapter implements SourceAdapter {
  type = "MEETUP" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    let config: MeetupConfig;
    try {
      config = validateSourceConfig<MeetupConfig>(source.config, "MeetupAdapter", {
        groupUrlname: "string",
        kennelTag: "string",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid source config";
      return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days);

    const errorDetails: ErrorDetails = {};
    const events: RawEventData[] = [];
    const errors: string[] = [];

    const baseUrl = `https://www.meetup.com/${encodeURIComponent(config.groupUrlname)}/events/`;
    const pastUrl = `${baseUrl}?type=past`;
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };

    // Fetch upcoming + past pages in parallel
    const [upcomingResult, pastResult] = await Promise.allSettled([
      safeFetch(baseUrl, { headers }),
      safeFetch(pastUrl, { headers }),
    ]);

    // Upcoming page must succeed (fatal)
    if (upcomingResult.status === "rejected") {
      const message = `Failed to fetch Meetup events: ${upcomingResult.reason instanceof Error ? upcomingResult.reason.message : String(upcomingResult.reason)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: baseUrl, message }] } };
    }
    const upcomingRes = upcomingResult.value;
    if (!upcomingRes.ok) {
      const message = `Meetup page error ${upcomingRes.status} for group "${config.groupUrlname}"`;
      return {
        events: [],
        errors: [message],
        errorDetails: { fetch: [{ url: baseUrl, status: upcomingRes.status, message }] },
      };
    }
    const upcomingHtml = await upcomingRes.text();
    const { events: upcomingEvents, state: upcomingState } = extractApolloEvents(upcomingHtml);

    // Past page is non-fatal
    let pastEvents: ApolloEvent[] = [];
    let pastState: Record<string, Record<string, unknown>> = {};
    if (pastResult.status === "fulfilled" && pastResult.value.ok) {
      const pastHtml = await pastResult.value.text();
      const extracted = extractApolloEvents(pastHtml);
      pastEvents = extracted.events;
      pastState = extracted.state;
    }

    // Merge Apollo states (upcoming takes priority for shared keys)
    const mergedState = { ...pastState, ...upcomingState };

    // Deduplicate events by id (upcoming takes priority)
    const upcomingIds = new Set(upcomingEvents.map((ev) => ev.id));
    const pastOnly = pastEvents.filter((ev) => !upcomingIds.has(ev.id));
    const idDedupedEvents = [...upcomingEvents, ...pastOnly];

    // Track IDs exclusive to the past page (Meetup limits past page to ~10 most recent)
    const pastOnlyIds = new Set(pastOnly.map((ev) => ev.id));

    // Deduplicate template vs customized occurrences sharing the same date
    // then filter to date window before enriching (avoids unnecessary detail page fetches).
    // Past-only events are exempt from minDate since the past page is already limited.
    const allApolloEvents = dedupByDate(idDedupedEvents).filter((ev) => {
      if (!ev.dateTime) return true; // keep for downstream skip
      const d = new Date(ev.dateTime);
      if (pastOnlyIds.has(ev.id)) return d <= maxDate;
      return d >= minDate && d <= maxDate;
    });

    // Enrich recurring events with detail page data (mutates in-place)
    const { detailPagesFetched, detailPagesEnriched } =
      await enrichRecurringEvents(allApolloEvents, headers);

    // Only error when the upcoming page lacks Apollo state entirely (structural breakage).
    // An empty group with valid Apollo state or events outside the date window is valid.
    const upcomingHasApolloState = Object.keys(upcomingState).length > 0;
    if (!upcomingHasApolloState && upcomingEvents.length === 0) {
      const message = "No __NEXT_DATA__ Apollo state found on upcoming events page — page structure may have changed";
      errors.push(message);
      errorDetails.parse = [{ row: 0, error: message }];
    }

    const compiledPatterns = compileKennelPatterns(config.kennelPatterns);
    for (const [i, ev] of allApolloEvents.entries()) {
      try {
        if (!ev.dateTime) continue;
        events.push(buildRawEventFromApollo(ev, mergedState, config.kennelTag, compiledPatterns));
      } catch (err) {
        const msg = `Failed to parse event "${ev.id}": ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        errorDetails.parse = [...(errorDetails.parse ?? []), { row: i, error: msg }];
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        groupUrlname: config.groupUrlname,
        eventsFound: idDedupedEvents.length,
        upcomingEventsFound: upcomingEvents.length,
        pastEventsFound: pastEvents.length,
        pastEventsIngested: allApolloEvents.filter((ev) => pastOnlyIds.has(ev.id)).length,
        eventsAfterDedup: allApolloEvents.length,
        detailPagesFetched,
        detailPagesEnriched,
      },
    };
  }
}
