/**
 * Parser for Facebook Page hosted_events HTML.
 *
 * Extracts event data from the SSR'd inline GraphQL JSON in
 * `<script type="application/json">` tags on
 *   https://www.facebook.com/{handle}/upcoming_hosted_events
 *   https://www.facebook.com/{handle}/past_hosted_events
 *
 * The FB GraphQL response splits each event across two related nodes that
 * share the same numeric `id`:
 *   - **Rich** node (`__typename: "Event"`): id, name, is_canceled, event_place
 *   - **Time** node (no __typename): id, start_timestamp, is_past, eventUrl, ...
 *
 * The parser walks every JSON island, collects both kinds of node by id,
 * and merges them. An event is emitted only when both halves are present
 * (so unrendered or partial events are skipped).
 *
 * Risk: FB rotates the inline GraphQL shape periodically (one of the
 * acknowledged tradeoffs of URL-mode FB scraping documented in
 * facebook-integration-strategy.md). A `FB_PARSE_FAILED` health alert is
 * raised by the surrounding adapter when this returns 0 events for a
 * source that historically had >0 — see `src/pipeline/health.ts`.
 *
 * See `parser.test.ts` for behavioral specification.
 */

import type { RawEventData } from "../types";
import { formatYmdInTimezone, formatTimeInZone, isValidTimezone } from "@/lib/timezone";
import { FB_EVENT_ID_RE } from "./constants";

export interface ParseFacebookOptions {
  /** kennelTag (kennelCode) for all parsed events. */
  kennelTag: string;
  /**
   * IANA timezone for date/time interpretation. Defaults to UTC.
   * `start_timestamp` from FB is unix-UTC; we project it to the kennel's
   * local zone for the canonical date string and HH:MM startTime, since
   * the merge pipeline keys events by (kennelId, local-date).
   */
  timezone?: string;
}

/**
 * Parse Facebook hosted_events HTML into RawEventData[].
 *
 * Returns `[]` when no script tags contain Event payloads; never throws
 * on malformed JSON or missing structure (the adapter classifies a 0-event
 * result against historical baselines to decide between "no events" and
 * "parser broke").
 */
export function parseFacebookHostedEvents(
  html: string,
  options: ParseFacebookOptions,
): RawEventData[] {
  const tz = options.timezone && isValidTimezone(options.timezone) ? options.timezone : "UTC";

  // Collect both halves of each event by id across all JSON islands.
  const byId = new Map<string, EventBag>();
  for (const json of extractJsonIslands(html)) {
    const parsed = safeJsonParse(json);
    if (parsed === undefined) continue;
    walkAndCollect(parsed, byId);
  }

  const results: RawEventData[] = [];
  for (const bag of byId.values()) {
    const evt = bagToRawEvent(bag, options.kennelTag, tz);
    if (evt) results.push(evt);
  }
  return results;
}

interface EventBag {
  id: string;
  /** Node carrying `start_timestamp`, `is_past`, etc. */
  time?: TimeNode;
  /** Node carrying `__typename: "Event"`, `name`, `is_canceled`, `event_place`. */
  rich?: RichNode;
}

interface TimeNode {
  id: string;
  start_timestamp: number;
  is_past?: boolean;
}

interface RichNode {
  __typename: "Event";
  id: string;
  name?: string;
  is_canceled?: boolean;
  event_place?: {
    contextual_name?: string;
    location?: { latitude?: number; longitude?: number };
  };
}

const SCRIPT_JSON_RE = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Pull every `<script type="application/json">…</script>` body. Uses
 *  `matchAll` (no shared `lastIndex` state) so concurrent calls are safe. */
function extractJsonIslands(html: string): string[] {
  const matches: string[] = [];
  for (const m of html.matchAll(SCRIPT_JSON_RE)) {
    matches.push(m[1]);
  }
  return matches;
}

/** Like JSON.parse but returns undefined on malformed input instead of throwing. */
function safeJsonParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/**
 * Recursively walk a parsed JSON value and bucket FB event nodes by id.
 * Tracks visited objects so cyclic references don't infinite-loop.
 */
function walkAndCollect(value: unknown, byId: Map<string, EventBag>): void {
  const seen = new WeakSet<object>();
  function walk(v: unknown): void {
    if (v === null || typeof v !== "object") return;
    if (seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    const obj = v as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : null;
    if (id && FB_EVENT_ID_RE.test(id)) {
      if (typeof obj.start_timestamp === "number") {
        const bag = byId.get(id) ?? { id };
        // First-write-wins for time nodes too, just for consistency. In
        // practice FB emits a single time node per event id.
        if (!bag.time) bag.time = obj as unknown as TimeNode;
        byId.set(id, bag);
      }
      if (obj.__typename === "Event") {
        // Merge per-field instead of replacing wholesale. FB graphs can
        // emit MULTIPLE Event refs for the same id with complementary data
        // (one with `name`, another with `event_place`, a third shallow);
        // a naive overwrite would drop fields. Field-level merging keeps
        // the union of everything we've seen across visit order. Codex
        // pass-3 finding.
        const bag = byId.get(id) ?? { id };
        const candidate = obj as unknown as RichNode;
        bag.rich = mergeRichNodes(bag.rich, candidate);
        byId.set(id, bag);
      }
    }
    for (const child of Object.values(obj)) walk(child);
  }
  walk(value);
}

/**
 * Merge two rich nodes for the same FB event id, preferring non-empty
 * existing fields over later overwrites — a "first non-empty wins" rule.
 * Picking first-non-empty (rather than always-prefer-later) is safer
 * because shallow refs typically appear AFTER full nodes in FB's graph
 * traversal order, so first-wins protects the richer node.
 *
 * Intentionally narrow: only merges the three fields the parser consumes
 * (`name`, `event_place`, `is_canceled`). Adding new fields here is a
 * deliberate parser-surface expansion.
 */
function mergeRichNodes(prev: RichNode | undefined, next: RichNode): RichNode {
  if (!prev) return next;
  return {
    __typename: "Event",
    id: prev.id,
    name: prev.name?.trim() ? prev.name : next.name,
    event_place: mergeEventPlace(prev.event_place, next.event_place),
    // First-non-undefined wins for booleans (treats `false` as a deliberate signal).
    is_canceled: prev.is_canceled !== undefined ? prev.is_canceled : next.is_canceled,
  };
}

/**
 * Per-subfield merge for `event_place`. FB can split a single venue across
 * two Event refs — one with `contextual_name`, another with `location.{lat,lng}`,
 * or the first with an empty contextual_name and the second with the real
 * value. Wholesale-replace would drop complementary data; this picks the
 * first non-empty value per subfield. Codex pass-4 finding.
 */
function mergeEventPlace(
  prev: RichNode["event_place"],
  next: RichNode["event_place"],
): RichNode["event_place"] {
  if (!prev) return next;
  if (!next) return prev;
  return {
    contextual_name: prev.contextual_name?.trim() ? prev.contextual_name : next.contextual_name,
    location: mergeLocation(prev.location, next.location),
  };
}

/** Per-axis merge for venue lat/lng. First defined number wins per axis. */
function mergeLocation(
  prev: NonNullable<RichNode["event_place"]>["location"],
  next: NonNullable<RichNode["event_place"]>["location"],
): NonNullable<RichNode["event_place"]>["location"] {
  if (!prev) return next;
  if (!next) return prev;
  return {
    latitude: typeof prev.latitude === "number" ? prev.latitude : next.latitude,
    longitude: typeof prev.longitude === "number" ? prev.longitude : next.longitude,
  };
}

/**
 * Project a (time, rich) bag onto the project's `RawEventData` shape.
 * Returns null when:
 *   - Either half is missing (Codex pass-1 finding — both required to emit).
 *   - The rich half lacks a non-empty `name` (Codex pass-2 finding —
 *     guards against shallow Event refs satisfying the contract with a
 *     skeleton row that overwrites richer fallback data at trustLevel 8).
 *   - The event is marked `is_canceled: true` (Codex pass-2 finding —
 *     for an `upcomingOnly` source the reconciler won't cancel disappeared
 *     events, so we drop FB-cancelled rows at ingest. Same pattern as the
 *     Meetup adapter's `status === "CANCELLED"` skip.).
 */
function bagToRawEvent(bag: EventBag, kennelTag: string, timezone: string): RawEventData | null {
  if (!bag.time || !bag.rich) return null;
  if (bag.rich.is_canceled === true) return null;
  const title = bag.rich.name?.trim() || undefined;
  if (!title) return null;
  const ms = bag.time.start_timestamp * 1000;
  const instant = new Date(ms);
  if (Number.isNaN(instant.getTime())) return null;

  const date = formatYmdInTimezone(instant, timezone);
  const startTime = formatTimeInZone(instant, timezone, "HH:mm");
  const location = bag.rich.event_place?.contextual_name?.trim() || undefined;
  const lat = bag.rich.event_place?.location?.latitude;
  const lng = bag.rich.event_place?.location?.longitude;

  const event: RawEventData = {
    date,
    kennelTags: [kennelTag],
    startTime,
    sourceUrl: `https://www.facebook.com/events/${bag.id}/`,
    externalLinks: [
      { url: `https://www.facebook.com/events/${bag.id}/`, label: "Facebook event" },
    ],
  };
  if (title !== undefined) event.title = title;
  if (location !== undefined) event.location = location;
  if (typeof lat === "number" && typeof lng === "number") {
    event.latitude = lat;
    event.longitude = lng;
  }
  // Cancelled events are filtered above (return null when is_canceled).
  return event;
}
