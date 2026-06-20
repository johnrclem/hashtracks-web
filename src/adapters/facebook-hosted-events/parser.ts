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
import { FB_EVENT_ID_RE, isAdminNoticeTitle, isPlaceholderTitle } from "./constants";
import { extractHashRunNumber, hasPlaceholderRunNumber, compilePatterns } from "../utils";
import { extractHares } from "../hare-extraction";
import {
  compileKennelPatterns,
  matchCompiledKennelPatterns,
  type KennelPattern,
  type CompiledKennelPattern,
} from "../kennel-patterns";

/**
 * SSR markers FB ships in every hosted_events response when the GraphQL
 * shape we know is intact — present both on pages with events AND on
 * genuinely-empty Pages (FB still renders the full Page UI bundle). They are
 * ABSENT on a checkpoint / login-wall interstitial, which is a different
 * document entirely. Matched in their quoted JSON-token form so a Page
 * coincidentally mentioning either string in prose can't false-match (the
 * tightening from PR #1295).
 *
 * Lives here (not in the adapter) so the adapter's shape-break logic and the
 * `looksLikeFbBlock` retry heuristic share one source of truth.
 */
export const FB_SSR_ENVELOPE_MARKERS = ['"RelayPrefetchedStreamCache"', '"__bbox"'] as const;

/**
 * High-signal substrings that appear on FB's logged-out checkpoint / bot-wall
 * interstitials but not on a normal public hosted_events SSR document (#1939).
 * Pinned to the structural `/checkpoint/` route only — prose like "content
 * isn't available" / "log in" appears in ordinary Page chrome (deleted-photo
 * cards, login buttons) and would false-positive a healthy Page into a FAILED
 * scrape (and trigger a wasted proxy retry). The `/checkpoint/` path is a FB
 * security route that does not appear in event/Page content, so it's safe to
 * match as a substring. The primary block signal is the absence of the SSR
 * envelope markers (below); this is the belt-and-suspenders secondary.
 */
export const FB_BLOCK_MARKERS = ["/checkpoint/"] as const;

/**
 * Heuristic (#1939): does this HTML look like a FB block / checkpoint /
 * login-wall page rather than a real hosted_events document? FB serves these
 * from datacenter IPs (e.g. Vercel) for some Pages — HTTP 200, zero
 * `__typename:"Event"` nodes — so a direct fetch silently yields 0 events.
 *
 * True when the events SSR envelope markers are entirely absent (the primary
 * signal — a checkpoint wall is a different document) OR a checkpoint /
 * unavailable-content marker is present. A genuinely-empty but healthy Page
 * still ships the envelope and trips neither marker, so it returns false (no
 * wasted residential-proxy retry, no false "fetch failure").
 */
export function looksLikeFbBlock(html: string): boolean {
  const hasEnvelope = FB_SSR_ENVELOPE_MARKERS.some((m) => html.includes(m));
  if (!hasEnvelope) return true;
  return FB_BLOCK_MARKERS.some((m) => html.includes(m));
}

export interface ParseFacebookOptions {
  /**
   * Default kennelTag (kennelCode). Used for every event when no
   * `kennelPatterns` are supplied (the single-kennel-per-source case), and
   * as the fallback (alongside `defaultKennelTag`) for events that match no
   * pattern when `kennelPatterns` are supplied.
   */
  kennelTag: string;
  /**
   * IANA timezone for date/time interpretation. Defaults to UTC.
   * `start_timestamp` from FB is unix-UTC; we project it to the kennel's
   * local zone for the canonical date string and HH:MM startTime, since
   * the merge pipeline keys events by (kennelId, local-date).
   */
  timezone?: string;
  /**
   * Optional per-event routing for FB Pages that host multiple kennels'
   * events (e.g. a page that lists a sister kennel's runs). Each event's
   * name is matched against these patterns via the shared
   * `matchCompiledKennelPatterns` engine — same grammar GOOGLE_CALENDAR uses
   * (string tuple = most-specific-wins single kennel; array tuple = co-host
   * union, spec §2 D15). Omit entirely for single-kennel sources; behavior
   * is then identical to pre-#1996 (every event tagged `[kennelTag]`).
   */
  kennelPatterns?: KennelPattern[];
  /**
   * Fallback kennelTag for events that match no `kennelPatterns` entry.
   * No-op without `kennelPatterns`. Defaults to `kennelTag` when unset.
   */
  defaultKennelTag?: string;
  /**
   * Per-source title strips (#2158) — same grammar the GOOGLE_CALENDAR adapter
   * uses. Each pattern is `.replace()`-d out of the stored display title (e.g.
   * a kennel that prefixes every FB event name with its full name). Applied
   * AFTER run-number extraction so an embedded `H6#311` still yields a
   * runNumber. Omit for sources without the issue — titles are then unchanged.
   */
  titleStripPatterns?: string[];
}

/** Resolves a parsed event title to its kennelTag(s). */
type KennelTagResolver = (title: string) => string[];

/**
 * Build the per-event kennelTag resolver (#1996). With no compiled patterns
 * this is the identity single-kennel mapping (`() => [kennelTag]`), so
 * single-kennel sources are byte-for-byte unchanged. With patterns, each
 * title routes via the shared engine, falling back to
 * `defaultKennelTag ?? kennelTag` when nothing matches — mirrors the GCal
 * adapter's `resolveKennelTagFromSummary` precedence.
 */
function buildKennelTagResolver(
  kennelTag: string,
  compiled: CompiledKennelPattern[] | null,
  defaultKennelTag?: string,
): KennelTagResolver {
  if (!compiled || compiled.length === 0) return () => [kennelTag];
  const fallback = defaultKennelTag ?? kennelTag;
  return (title) => {
    const matched = matchCompiledKennelPatterns(title, compiled);
    return matched.length > 0 ? matched : [fallback];
  };
}

/**
 * Reasons `bagToRawEvent` may drop a candidate. Surfaced via
 * `parseFacebookHostedEventsWithStats` so the adapter can tell "FB Page
 * returned zero usable events because they were all placeholders/admin
 * notices" apart from "FB Page genuinely has nothing scheduled" — the
 * former is signal-worthy (per-source-config drift), the latter is normal.
 */
export type FbBagRejectReason =
  | "missing-half"
  | "cancelled"
  | "no-title"
  | "invalid-time"
  | "admin-notice"
  | "placeholder";

export interface ParseFacebookResult {
  events: RawEventData[];
  /**
   * Per-reason counts of bags rejected during projection. Zero values
   * preserved so callers can JSON-serialize the entire shape into
   * diagnosticContext without branching on undefined keys.
   */
  filtered: Record<FbBagRejectReason, number>;
}

function emptyFilteredCounts(): Record<FbBagRejectReason, number> {
  return {
    "missing-half": 0,
    cancelled: 0,
    "no-title": 0,
    "invalid-time": 0,
    "admin-notice": 0,
    placeholder: 0,
  };
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
  return parseFacebookHostedEventsWithStats(html, options).events;
}

/**
 * Same as `parseFacebookHostedEvents`, but also returns per-reason
 * rejection counts (#1497, #1500). The adapter consumes this to surface
 * a `source-coverage-gap` signal when every parsed candidate was filtered
 * for content reasons (admin-notice / placeholder) rather than when the
 * Page genuinely had nothing on the listing tab.
 */
export function parseFacebookHostedEventsWithStats(
  html: string,
  options: ParseFacebookOptions,
): ParseFacebookResult {
  const tz = options.timezone && isValidTimezone(options.timezone) ? options.timezone : "UTC";

  // Compile kennelPatterns once per scrape (hot-path: O(patterns) per event,
  // not per-event regex compilation). Null when single-kennel.
  const compiled =
    options.kennelPatterns && options.kennelPatterns.length > 0
      ? compileKennelPatterns(options.kennelPatterns)
      : null;
  const resolveKennelTags = buildKennelTagResolver(options.kennelTag, compiled, options.defaultKennelTag);

  // Compile per-source title strips once (#2158). Empty when unconfigured, so
  // non-configured sources keep byte-identical titles. Case-insensitive only
  // (no `m`/`g`) — same flags the GOOGLE_CALENDAR adapter uses, so `^`/`$`
  // anchor the whole title, not individual lines of a multi-line FB name.
  const titleStripRes =
    options.titleStripPatterns && options.titleStripPatterns.length > 0
      ? compilePatterns(options.titleStripPatterns, "i")
      : [];

  // Collect both halves of each event by id across all JSON islands.
  const byId = new Map<string, EventBag>();
  for (const json of extractJsonIslands(html)) {
    const parsed = safeJsonParse(json);
    if (parsed === undefined) continue;
    walkAndCollect(parsed, byId);
  }

  const events: RawEventData[] = [];
  const filtered = emptyFilteredCounts();
  for (const bag of byId.values()) {
    const outcome = projectBag(bag, resolveKennelTags, tz, titleStripRes);
    if (outcome.kind === "event") {
      events.push(outcome.event);
    } else {
      filtered[outcome.reason] += 1;
    }
  }
  return { events, filtered };
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

type BagOutcome =
  | { kind: "event"; event: RawEventData }
  | { kind: "rejected"; reason: FbBagRejectReason };

// Title trailing-delimiter strip (#1557 Memphis): Page admins frequently
// leave templated suffixes like " - " in the FB event name when the theme
// segment is empty ("MH3 Trail -", "GyNO H3 Trail 8 -"). Anchored to
// end-of-string, single char class — Sonar S5852 safe. Mirrors the GCal
// adapter strip in `google-calendar/adapter.ts` (#756 / #1060).
const TITLE_TRAILING_DELIMITER_RE = /\s*[-–—:]\s*$/; // NOSONAR — anchored end-of-string strip, single char class

function projectBag(
  bag: EventBag,
  resolveKennelTags: KennelTagResolver,
  timezone: string,
  titleStripRes: RegExp[] = [],
): BagOutcome {
  if (!bag.time || !bag.rich) return { kind: "rejected", reason: "missing-half" };
  if (bag.rich.is_canceled === true) return { kind: "rejected", reason: "cancelled" };
  // Inner `.trim()` is needed before the regex so the anchored `\s*$` strip
  // sees a delimiter at the end; the regex itself absorbs surrounding spaces.
  const rawTitle = bag.rich.name?.trim().replace(TITLE_TRAILING_DELIMITER_RE, "") || undefined;
  if (!rawTitle) return { kind: "rejected", reason: "no-title" };
  const ms = bag.time.start_timestamp * 1000;
  const instant = new Date(ms);
  if (Number.isNaN(instant.getTime())) return { kind: "rejected", reason: "invalid-time" };

  // Normalize the STORED/display title up front (#2158): strip the kennel-name
  // prefix / templated suffix so the content-quality filters below run against
  // the real title — otherwise a prefixed placeholder ("Hollyweird … , Test")
  // would slip past `isPlaceholderTitle` and persist as "Test". Run-number
  // extraction and kennel routing deliberately stay on the RAW FB name (the run
  // marker lives in the stripped suffix; routing keys on the original). Fall back
  // to the raw title if a pattern empties it — stripping only improves, never
  // drops. No-op when the source sets no `titleStripPatterns`.
  let stripped = rawTitle;
  for (const re of titleStripRes) stripped = stripped.replace(re, "").trim();
  const displayTitle = stripped || rawTitle;

  // Admin-notice filter (#1500): titles like "Moving to a new website" are
  // Page-admin announcements, not trails. Drop unconditionally — no field
  // combo can rehabilitate a notice into a real run.
  if (isAdminNoticeTitle(displayTitle)) return { kind: "rejected", reason: "admin-notice" };

  const location = bag.rich.event_place?.contextual_name?.trim() || undefined;
  const lat = bag.rich.event_place?.location?.latitude;
  const lng = bag.rich.event_place?.location?.longitude;
  const parsedRunNumber = extractHashRunNumber(rawTitle);
  const placeholderRun = parsedRunNumber === undefined && hasPlaceholderRunNumber(rawTitle);

  // Placeholder-event filter (#1497): single-word titles like "Test" with
  // no run number AND no location AND no parseable run marker. Hares come
  // from the detail-page enrichment step which the parser doesn't run, so
  // we deliberately don't require their absence — a real test event would
  // not have hares either.
  if (
    isPlaceholderTitle(displayTitle) &&
    parsedRunNumber === undefined &&
    !placeholderRun &&
    !location
  ) {
    return { kind: "rejected", reason: "placeholder" };
  }

  const date = formatYmdInTimezone(instant, timezone);
  const startTime = formatTimeInZone(instant, timezone, "HH:mm");

  const event: RawEventData = {
    date,
    kennelTags: resolveKennelTags(rawTitle),
    title: displayTitle,
    startTime,
    sourceUrl: `https://www.facebook.com/events/${bag.id}/`,
    externalLinks: [
      { url: `https://www.facebook.com/events/${bag.id}/`, label: "Facebook event" },
    ],
  };
  if (location !== undefined) event.location = location;
  // `Number.isFinite` guards `NaN` / `Infinity` that a schema-drift node
  // could ship — `typeof NaN === "number"` is true.
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    event.latitude = lat;
    event.longitude = lng;
  }

  // Placeholder titles ("H6#28?") emit `runNumber: null` so the merge
  // pipeline's tri-state clears any stale value from a prior non-placeholder
  // scrape — see the `runNumber?: number | null` contract on RawEventData.
  if (typeof parsedRunNumber === "number") {
    event.runNumber = parsedRunNumber;
  } else if (placeholderRun) {
    event.runNumber = null;
  }
  return { kind: "event", event };
}

/** Back-compat shim for the existing `facebookEventToRawEvent` external API.
 *  The CIC pagination path is always single-kennel, so it resolves to a fixed
 *  `[kennelTag]` regardless of title. */
function bagToRawEvent(bag: EventBag, kennelTag: string, timezone: string): RawEventData | null {
  const outcome = projectBag(bag, () => [kennelTag], timezone);
  return outcome.kind === "event" ? outcome.event : null;
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
  /**
   * Hare names. A string is a real hare; `null` is an explicit clear (the post
   * body's hare line was a recognized non-hare — bare kennel code, placeholder
   * — so a stale canonical `haresText` should self-heal, #2032); absent means
   * no signal (preserve existing).
   */
  hares?: string | null;
  locationStreet?: string;
  /** Run fee, free-form (`Hash Cash: $6` → `"$6"`). #1930. */
  cost?: string;
  /** Shiggy Scale 1–5 (`Shiggy: 3` → `3`); placeholder/non-numeric omitted. #1930. */
  difficulty?: number;
  /** Pre-event meetup venue/time (`Pre-lube: …`). #1930. */
  prelube?: string;
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
const FB_FIRST_CHAR_OK_RE = /[\p{L}\p{N}\-([*]/u;
const FB_TRAILING_PUNCT_RE = /[\s,;.]+$/; // NOSONAR — single char class + `$` anchor; same shape as PUNCT_TRAILING_RE in hare-extraction.ts
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
    const cleaned = stripNextRunTrailer(stripLeadingDecoration(haresRaw).trim()).trim();
    if (cleaned.length > 0) out.hares = cleaned;
  } else if (haresRaw === null) {
    // Explicit clear: the body had a hare line but it was a recognized
    // non-hare (bare kennel code / placeholder). Propagate `null` so the merge
    // pipeline scrubs a stale canonical `haresText` (#2032 self-heal).
    out.hares = null;
  }

  const street = extractStreetBlock(trimmed);
  if (street) {
    // Belt-and-suspenders: strip any residual leading emoji/symbol decoration
    // from the final street. extractStreetBlock already filters per-line, but
    // a same-line "Location: 📍 123 Main St" path would slip through.
    const cleanedStreet = stripLeadingDecoration(street).trim();
    if (cleanedStreet.length > 0) out.locationStreet = cleanedStreet;
  }

  // #1930: hash kennels (e.g. PCH3) embed `Hash Cash: $6`, `Shiggy: 3`,
  // `Pre-lube: …` as `Label: value` lines in the post body. Map these onto
  // the existing Event columns. Post-run venue lines (`On-after:`) and timing
  // lines (`Gather:`, `Hares away:`) have no column and stay in the verbatim
  // description, matching the SDH3 "On after → description" precedent.
  const labeled = extractCostShiggyPrelube(trimmed);
  if (labeled.cost !== undefined) out.cost = labeled.cost;
  if (labeled.difficulty !== undefined) out.difficulty = labeled.difficulty;
  if (labeled.prelube !== undefined) out.prelube = labeled.prelube;

  return out;
}

// #1930 label sets. Matched as whole, case-insensitive labels (the part before
// the first `:` on a line) via plain string ops — no regex, so Sonar S5852 is
// moot. Kept narrow so unrelated lines (`Start:`, `Gather:`, `Pets:`) don't leak.
// Deliberately narrow: only the unambiguous "hash cash" label. A bare "cash"
// label would mis-fire on prose like "Cash: bring small bills" for any FB
// kennel (this parser is shared across all FACEBOOK_HOSTED_EVENTS sources).
const FB_COST_LABELS = new Set(["hash cash"]);
const FB_SHIGGY_LABELS = new Set(["shiggy", "shiggy level", "shiggy scale"]);
const FB_PRELUBE_LABELS = new Set(["pre-lube", "prelube"]);

/**
 * Validate a Shiggy Scale value: integer 1–5, else undefined. Mirrors
 * `parseShiggyScale` in burlington-hash.ts (kept local to avoid coupling the
 * FB parser to an HTML-scraper module). Placeholder values like `?` or prose
 * (`hilly`) yield undefined so we never fabricate a difficulty.
 */
function parseFbShiggy(raw: string): number | undefined {
  const match = /^(\d+)$/.exec(raw.trim());
  if (!match) return undefined;
  const n = Number.parseInt(match[1], 10);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
}

/**
 * Walk description lines once, pulling the first cost / shiggy / prelube
 * `Label: value` line each. First-match-wins per field; empty values skipped.
 */
function extractCostShiggyPrelube(description: string): {
  cost?: string;
  difficulty?: number;
  prelube?: string;
} {
  const out: { cost?: string; difficulty?: number; prelube?: string } = {};
  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const label = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!value) continue;
    if (out.cost === undefined && FB_COST_LABELS.has(label)) {
      out.cost = value;
    } else if (out.difficulty === undefined && FB_SHIGGY_LABELS.has(label)) {
      const n = parseFbShiggy(value);
      if (n !== undefined) out.difficulty = n;
    } else if (out.prelube === undefined && FB_PRELUBE_LABELS.has(label)) {
      out.prelube = value;
    }
  }
  return out;
}

/**
 * Truncate a hare-names string at the first next-run announcement teaser.
 *
 * Some Page admins format the Hare line as
 *   `Hare: Comfort and Tight Lips on Saturday, March 14`
 * where `on Saturday, March 14` is the NEXT trail's date, not part of the
 * attribution (#1498). Two-stage match keeps the regex provably linear
 * (Sonar S5852 safe) AND guards against false positives on hare names
 * that happen to contain ` on <weekday>` followed by non-date prose
 * ("Born on Saturday Night" → don't truncate to "Born", Codex P2):
 *
 *   Stage 1: a flat regex locates the candidate ` on <weekday>` token.
 *   Stage 2: a procedural check confirms the suffix is empty OR begins
 *            with `, <date>` (month name or digit), which is the only
 *            real-world shape of a next-run trailer.
 */
// Each `\s+` is sandwiched between literal anchors (` on `, weekday prefix)
// and `[a-z]*\b` is bounded by a word boundary — no nested quantifiers, no
// catastrophic backtracking risk. Input is a single hare-line ≤200 chars.
const HARE_TRAILER_WEEKDAY_RE = /\s+on\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b/i; // NOSONAR — flat regex, single quantifier per position, input ≤200 chars
// `^`-anchored, single `\s*` per position. Each alternative is a literal
// month prefix or single digit; `the\s+\d` is anchored to a literal digit.
const HARE_TRAILER_DATE_SUFFIX_RE =
  /^\s*,\s*(?:\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|the\s+\d)/i; // NOSONAR — anchored, literal alternation, input ≤200 chars
const HARE_TRAILER_PUNCT_TAIL_RE = /[\s,;:]+$/; // NOSONAR — single char class + `$` anchor
function stripNextRunTrailer(value: string): string {
  const m = HARE_TRAILER_WEEKDAY_RE.exec(value);
  if (!m) return value;
  const suffix = value.slice(m.index + m[0].length);
  // Empty suffix (end-of-string) OR ", <date>" — anything else is prose,
  // not a trailer. Leave the original untouched in the prose case.
  if (suffix.length > 0 && !HARE_TRAILER_DATE_SUFFIX_RE.test(suffix)) return value;
  return value.slice(0, m.index).replace(HARE_TRAILER_PUNCT_TAIL_RE, "");
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
const FIELD_LABEL_CHAR_RE = /[A-Za-z\- ]/;
function isFieldLabelLine(line: string): boolean {
  const colonIdx = line.indexOf(":");
  if (colonIdx <= 0 || colonIdx > 41) return false;
  const label = line.slice(0, colonIdx);
  if (!/^[A-Za-z]/.test(label)) return false;
  for (const c of label) {
    if (!FIELD_LABEL_CHAR_RE.test(c)) return false;
  }
  return true;
}

/**
 * Should `line` terminate the address-block walk? Centralizes the four
 * stop conditions so the inner loop in `extractStreetBlock` stays flat.
 */
function isContinuationTerminator(line: string): boolean {
  if (line.length === 0) return true;
  if (isFieldLabelLine(line)) return true;
  if (line.startsWith("http://") || line.startsWith("https://")) return true;
  // First-char filter rejects emoji-prefixed continuation like
  // "➡️ e'rections: GPS it…" while still admitting addresses that lead
  // with `(Corner of …)`, `- Unit 2B`, `[Building B]`, `*Parking note*`.
  if (!FB_FIRST_CHAR_OK_RE.test(line.charAt(0))) return true;
  return false;
}

/**
 * Pick the same-line remainder from a `Location:` line, or skip it entirely.
 * US addresses lead with a house number; venues do not — include the
 * remainder only when its first char (after a leading emoji decoration like
 * "📍") is a digit. This correctly skips
 * `Launchpad: 📍 Americian Legion Pist 310` (post-suffix digit) as a venue,
 * while `Location: 123 Main St` is captured as an address.
 */
function pickAddressRemainder(remainder: string): string | undefined {
  if (remainder.length === 0) return undefined;
  const undecorated = stripLeadingDecoration(remainder).trimStart();
  return /^\d/.test(undecorated) ? undecorated : undefined;
}

/**
 * Walk forward from `startIdx` collecting up to `STREET_MAX_CONTINUATION_LINES`
 * address-continuation lines. A line ending in a US zip code terminates the
 * walk (subsequent lines are almost always boilerplate or the next field).
 */
function collectAddressContinuation(lines: string[], startIdx: number, seed: string[]): string[] {
  const out = [...seed];
  if (out.some((line) => FB_ZIP_AT_END_RE.test(line))) return out;
  for (let j = startIdx; j < lines.length && out.length < STREET_MAX_CONTINUATION_LINES; j++) {
    const line = lines[j].trim();
    if (isContinuationTerminator(line)) break;
    out.push(line);
    if (FB_ZIP_AT_END_RE.test(line)) break;
  }
  return out;
}

function buildAddressFromContinuation(continuation: string[]): string | undefined {
  if (continuation.length === 0) return undefined;
  let joined = continuation
    .join(", ")
    .replace(/,\s*,/g, ",")
    .replace(FB_TRAILING_PUNCT_RE, "");
  joined = stripFbCountryStateNoise(joined);
  if (joined.length === 0) return undefined;
  // Address-shape sanity check: reject candidates that don't look like a
  // real address. Some descriptions have an earlier `Start: 6:30 PM` whose
  // label matches the location-label list; without this gate, the time
  // string would mis-fill locationStreet.
  if (!looksLikeAddress(joined)) return undefined;
  if (joined.length > STREET_MAX_LEN) joined = joined.slice(0, STREET_MAX_LEN).trim();
  return joined;
}

function extractStreetBlock(description: string): string | undefined {
  const lines = description.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const remainder = parseLocationLabel(lines[i]);
    if (remainder === null) continue;
    const seed = pickAddressRemainder(remainder);
    const continuation = collectAddressContinuation(lines, i + 1, seed ? [seed] : []);
    const candidate = buildAddressFromContinuation(continuation);
    if (candidate) return candidate;
  }
  return undefined;
}

/**
 * Heuristic: does `value` look like a US street address rather than a time
 * or other label value? Some descriptions have an earlier `Start:` field
 * carrying a clock time ("Start: 6:30 PM"); without this gate, the first
 * matched location-label wins and the time mis-fills locationStreet.
 *
 * Returns true unless `value` is recognizably a clock time. Plain street
 * fragments like "12 First Ave" or "1234 Maple St" pass — they contain
 * digits but no `H:MM` clock pattern.
 */
const FB_CLOCK_TIME_RE = /^\s*\d{1,2}:\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?\s*$/;
function looksLikeAddress(value: string): boolean {
  if (FB_ZIP_AT_END_RE.test(value)) return true;
  if (FB_CLOCK_TIME_RE.test(value)) return false;
  return /\d/.test(value);
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
