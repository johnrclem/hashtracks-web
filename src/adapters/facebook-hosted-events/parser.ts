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
import { extractHashRunNumber, hasPlaceholderRunNumber } from "../utils";
import { extractHares } from "../hare-extraction";

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

/**
 * Parsed event-detail data from `https://www.facebook.com/events/{id}/`.
 * Mirrors only the fields we propagate into RawEventData beyond what the
 * listing-tab parse already captures.
 */
export interface FacebookEventDetail {
  /** Trimmed `event_description.text` — the post body shown on the event page. */
  description?: string;
}

/**
 * Parse a Facebook event detail page (`/events/{id}/`) for the post-body
 * description. Pinned to one field for now; extend cautiously since FB
 * shape rotation here breaks separately from the listing-tab parse.
 *
 * Distinguishes `event_description` (the post body) from `best_description`
 * (the venue blurb on `event_place.best_description`). Only the former is
 * what users want as the canonical Event description.
 */
export function parseFacebookEventDetail(html: string): FacebookEventDetail {
  for (const json of extractJsonIslands(html)) {
    const parsed = safeJsonParse(json);
    if (parsed === undefined) continue;
    const text = findEventDescriptionText(parsed);
    if (text) return { description: text };
  }
  return {};
}

/**
 * Walk a parsed JSON tree and return the first `event_description.text`
 * found. Skips matches under any `event_place` ancestor (those are venue
 * blurbs, not event bodies) — the `inEventPlace` flag is sticky through
 * recursion so a nested `.event_place.foo.bar.event_description` cannot
 * leak into the canonical event description (#1292 review). Walks until
 * a hit so the first valid match wins; if FB ever splits the description
 * across two refs we'd need to extend like the listing-tab merge — leave
 * as a follow-up if observed.
 */
function findEventDescriptionText(value: unknown): string | null {
  const seen = new WeakSet<object>();
  function walk(v: unknown, inEventPlace: boolean): string | null {
    if (v === null || typeof v !== "object") return null;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const item of v) {
        const hit = walk(item, inEventPlace);
        if (hit) return hit;
      }
      return null;
    }
    const obj = v as Record<string, unknown>;
    // Only accept event_description (the post body), never the venue
    // best_description that lives under event_place.
    const desc = obj.event_description;
    if (
      !inEventPlace &&
      desc &&
      typeof desc === "object" &&
      typeof (desc as Record<string, unknown>).text === "string"
    ) {
      const text = ((desc as Record<string, unknown>).text as string).trim();
      if (text.length > 0) return text;
    }
    for (const [k, child] of Object.entries(obj)) {
      const hit = walk(child, inEventPlace || k === "event_place");
      if (hit) return hit;
    }
    return null;
  }
  return walk(value, false);
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
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    const obj = v as Record<string, unknown>;
    collectIfEventNode(obj, byId);
    for (const child of Object.values(obj)) walk(child);
  }
  walk(value);
}

/** Inspect a single object node and bucket it into the by-id map if it
 *  carries either an Event __typename (rich half) or a start_timestamp
 *  (time half) under a recognized FB event id. */
function collectIfEventNode(
  obj: Record<string, unknown>,
  byId: Map<string, EventBag>,
): void {
  const id = typeof obj.id === "string" ? obj.id : null;
  if (!id || !FB_EVENT_ID_RE.test(id)) return;
  if (typeof obj.start_timestamp === "number") {
    const bag = byId.get(id) ?? { id };
    // First-write-wins for time nodes too, just for consistency. In
    // practice FB emits a single time node per event id.
    bag.time ??= obj as unknown as TimeNode;
    byId.set(id, bag);
  }
  if (obj.__typename === "Event") {
    // Merge per-field instead of replacing wholesale. FB graphs can emit
    // MULTIPLE Event refs for the same id with complementary data (one
    // with `name`, another with `event_place`, a third shallow); a naive
    // overwrite would drop fields. Codex pass-3 finding.
    const bag = byId.get(id) ?? { id };
    bag.rich = mergeRichNodes(bag.rich, obj as unknown as RichNode);
    byId.set(id, bag);
  }
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
    // First-non-nullish wins for booleans (treats `false` as a deliberate signal).
    is_canceled: prev.is_canceled ?? next.is_canceled,
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
/**
 * Externally-friendly Facebook Event shape consumed by the historical
 * backfill path (`scripts/import-fb-historical-backfill.ts`). The CIC
 * harvester emits events in this exact form via
 * `docs/kennel-research/facebook-historical-backfill-cic-prompt.md`.
 *
 * Camel-cased equivalent of the FB GraphQL Event node: `id`,
 * `start_timestamp`, `is_canceled`, `event_place.contextual_name`,
 * `event_place.location.{latitude,longitude}` rendered as
 * `startTimestamp`, `isCanceled`, `eventPlace.{contextualName, latitude,
 * longitude}`. Same projection rules as the live listing-tab parser
 * (`bagToRawEvent`); cancelled events project to null so the backfill
 * matches the live cron path's behavior.
 */
export interface FacebookEventInput {
  id: string;
  name?: string;
  startTimestamp: number;
  isCanceled?: boolean;
  eventPlace?: {
    contextualName?: string;
    latitude?: number;
    longitude?: number;
  };
}

/**
 * Project a CIC-harvested Facebook Event into a RawEventData. Mirrors
 * `bagToRawEvent`'s contract — same null-rules, same output shape — but
 * accepts a single merged Event node (the GraphQL pagination response
 * shape) instead of the listing-tab's split rich+time bag.
 *
 * Returns null when:
 *   - The event lacks a non-empty `name`.
 *   - The event is `isCanceled: true` (matches the live adapter's
 *     drop-at-ingest semantics; cancelled-event support across the
 *     merge pipeline is a separate follow-up).
 *   - `startTimestamp * 1000` is not a valid Date.
 */
export function facebookEventToRawEvent(
  input: FacebookEventInput,
  kennelTag: string,
  timezone: string,
): RawEventData | null {
  return bagToRawEvent(
    {
      id: input.id,
      time: { id: input.id, start_timestamp: input.startTimestamp },
      rich: {
        __typename: "Event",
        id: input.id,
        name: input.name,
        is_canceled: input.isCanceled,
        event_place: input.eventPlace
          ? {
              contextual_name: input.eventPlace.contextualName,
              location:
                typeof input.eventPlace.latitude === "number" ||
                typeof input.eventPlace.longitude === "number"
                  ? {
                      latitude: input.eventPlace.latitude,
                      longitude: input.eventPlace.longitude,
                    }
                  : undefined,
            }
          : undefined,
      },
    },
    kennelTag,
    timezone,
  );
}

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

  // Placeholder titles ("H6#28?") emit `runNumber: null` so the merge
  // pipeline's tri-state clears any stale value from a prior non-placeholder
  // scrape — see the `runNumber?: number | null` contract on RawEventData.
  if (title) {
    const parsed = extractHashRunNumber(title);
    if (typeof parsed === "number") {
      event.runNumber = parsed;
    } else if (hasPlaceholderRunNumber(title)) {
      event.runNumber = null;
    }
  }
  // Cancelled events are filtered above (return null when is_canceled).
  return event;
}

/**
 * Extract structured fields from the FB event-detail post body (#1319).
 *
 * The listing tab carries `name`, `start_timestamp`, and
 * `event_place.contextual_name` but no description — hash kennels put the
 * Hare and full address in the post body on `/events/{id}/`, which the
 * adapter's `enrichWithDetails` step fetches separately.
 */
export interface FacebookDescriptionFields {
  hares?: string;
  locationStreet?: string;
}

// Address-block label tokens. Matched procedurally (`parseLocationLabel`) to
// avoid the `\s*` near alternation + `(.*)$` shape that Sonar S5852 flags as
// ReDoS-prone, per feedback_sonar_s5852_false_positives.
const FB_LOCATION_LABELS = [
  "location",
  "launchpad",
  "where",
  "address",
  "start",
  "meet",
] as const;
const FB_LEADING_DECORATION_RE = /^[^\p{L}\p{N}]{1,16}/u;
const FB_FIRST_CHAR_OK_RE = /[\p{L}\p{N}\-(\[*]/u;
const FB_TRAILING_PUNCT_RE = /[\s,;.]+$/;
// US-style 5-digit zip (with optional ZIP+4) at end of line — strong signal
// the address block has finished. We append the line then stop walking.
const FB_ZIP_AT_END_RE = /\b\d{5}(?:-\d{4})?\s*$/;
// Sentinel that FB ships in addresses with country/state expanded
// ("…, FL, United States, Florida 33301"). Stripped procedurally instead of
// via a single regex with `\s*` near the trailing zip lookahead, which Sonar
// S5852 flags as ReDoS-prone (per feedback_sonar_s5852_false_positives).
const FB_COUNTRY_NOISE_PREFIX = ", United States, ";
const FB_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;
const STREET_MAX_CONTINUATION_LINES = 4;
const STREET_MAX_LEN = 250;
const HARE_LEADING_STRIP_MAX = 12;

export function extractFieldsFromFbDescription(description: string): FacebookDescriptionFields {
  const out: FacebookDescriptionFields = {};
  const trimmed = description?.trim();
  if (!trimmed) return out;

  const haresRaw = extractHares(trimmed);
  if (haresRaw) {
    const cleaned = stripLeadingDecoration(haresRaw).trim();
    if (cleaned.length > 0) out.hares = cleaned;
  }

  const street = extractStreetBlock(trimmed);
  if (street) out.locationStreet = street;

  return out;
}

function stripLeadingDecoration(value: string): string {
  // Bound the leading-decoration strip so we only eat short emoji/symbol
  // runs (🐰✨, 📍, ➡️) — not long prefixes that might contain real letters.
  const m = FB_LEADING_DECORATION_RE.exec(value);
  if (!m) return value;
  if (m[0].length > HARE_LEADING_STRIP_MAX) return value;
  return value.slice(m[0].length);
}

/**
 * If `line` is a `<Label>:<remainder>` line where `<Label>` is one of
 * `FB_LOCATION_LABELS` (case-insensitive), return the trimmed remainder
 * (possibly empty when the address starts on the next line). Otherwise null.
 */
function parseLocationLabel(line: string): string | null {
  const trimmed = line.trimStart();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) return null;
  const label = trimmed.slice(0, colonIdx).trim().toLowerCase();
  if (!FB_LOCATION_LABELS.includes(label as (typeof FB_LOCATION_LABELS)[number])) return null;
  return trimmed.slice(colonIdx + 1).trim();
}

/**
 * True when `line` looks like the start of any other labelled section
 * (`Pre-Lube:`, `Hare Away:`, `On-After:` …) and should terminate the
 * address-block walk. Procedural to keep Sonar S5852 quiet.
 */
function isFieldLabelLine(line: string): boolean {
  const colonIdx = line.indexOf(":");
  if (colonIdx <= 0 || colonIdx > 41) return false;
  const label = line.slice(0, colonIdx);
  if (!/^[A-Za-z]/.test(label)) return false;
  for (let i = 0; i < label.length; i++) {
    const c = label[i];
    if (!/[A-Za-z\- ]/.test(c)) return false;
  }
  return true;
}

function extractStreetBlock(description: string): string | undefined {
  const lines = description.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const remainder = parseLocationLabel(lines[i]);
    if (remainder === null) continue;
    const continuation: string[] = [];
    // Same-line remainder is either a venue name ("Location: Boston Johnny's"
    // with the address on subsequent lines) or the address itself ("Location:
    // 123 Main St, …"). US addresses lead with a house number; venues do not
    // — include the remainder only when its first char (after a leading
    // emoji decoration like "📍") is a digit. This correctly skips
    // "Launchpad: 📍 Americian Legion Pist 310" (post-suffix digit) as a
    // venue, while "Location: 123 Main St" is captured as an address.
    if (remainder.length > 0) {
      const undecorated = stripLeadingDecoration(remainder).trimStart();
      if (/^\d/.test(undecorated)) continuation.push(undecorated);
    }
    let zipSeen = continuation.some((line) => FB_ZIP_AT_END_RE.test(line));
    for (
      let j = i + 1;
      !zipSeen && j < lines.length && continuation.length < STREET_MAX_CONTINUATION_LINES;
      j++
    ) {
      const line = lines[j].trim();
      if (line.length === 0) break;
      if (isFieldLabelLine(line)) break;
      if (line.startsWith("http://") || line.startsWith("https://")) break;
      // First-char filter rejects emoji-prefixed continuation like
      // "➡️ e'rections: GPS it…" while still admitting addresses that lead
      // with `(Corner of …)`, `- Unit 2B`, `[Building B]`, `*Parking note*`.
      if (!FB_FIRST_CHAR_OK_RE.test(line.charAt(0))) break;
      continuation.push(line);
      // A line ending in a US zip code is a strong terminator: the address
      // block typically ends with the city/state/zip line, and what follows
      // is almost always loose prose (boilerplate, notes, the next field
      // label) that would pollute locationStreet otherwise.
      if (FB_ZIP_AT_END_RE.test(line)) {
        zipSeen = true;
        break;
      }
    }
    if (continuation.length === 0) return undefined;
    let joined = continuation
      .join(", ")
      .replace(/,\s*,/g, ",")
      .replace(FB_TRAILING_PUNCT_RE, "");
    joined = stripFbCountryStateNoise(joined);
    if (joined.length === 0) return undefined;
    if (joined.length > STREET_MAX_LEN) joined = joined.slice(0, STREET_MAX_LEN).trim();
    return joined;
  }
  return undefined;
}

/**
 * Collapse FB's redundant country/state expansion to a clean state-abbrev + zip.
 * Example: `… FL, United States, Florida 33301` → `… FL 33301`.
 *
 * Done procedurally (substring + state-name list) instead of with a single
 * regex containing `\s*` near a `\d{5}` lookahead — the latter shape is what
 * Sonar S5852 flags as ReDoS-prone for these adapters.
 */
function stripFbCountryStateNoise(value: string): string {
  const idx = value.toLowerCase().indexOf(FB_COUNTRY_NOISE_PREFIX.toLowerCase());
  if (idx < 0) return value;
  const after = value.slice(idx + FB_COUNTRY_NOISE_PREFIX.length);
  for (const state of FB_STATE_NAMES) {
    if (!after.toLowerCase().startsWith(state.toLowerCase() + " ")) continue;
    const remainder = after.slice(state.length).trimStart();
    if (FB_ZIP_AT_END_RE.test(remainder)) {
      return `${value.slice(0, idx)} ${remainder}`;
    }
  }
  return value;
}
