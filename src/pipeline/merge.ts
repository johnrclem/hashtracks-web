import { prisma } from "@/lib/db";
import type { Prisma, EventStatus, SourceType } from "@/generated/prisma/client";
import { isUniqueConstraintViolation } from "@/lib/prisma-errors";
import type { RawEventData, MergeResult } from "@/adapters/types";
import { parseUtcNoonDate } from "@/lib/date";
import { regionTimezone, getLabelForUrl, stripUrlsFromText, timeToMinutes } from "@/lib/format";
import { composeUtcStart } from "@/lib/timezone";
import { generateFingerprint } from "./fingerprint";
import { resolveKennelTag, resolveKennelTags, clearResolverCache } from "./kennel-resolver";
import { extractCoordsFromMapsUrl, geocodeAddress, resolveShortMapsUrl, reverseGeocode, haversineDistance, parseDMSFromLocation, stripDMSFromLocation } from "@/lib/geo";
import { isPlaceholder, decodeEntities, HARE_BOILERPLATE_RE, CTA_EMBEDDED_PATTERNS } from "@/adapters/utils";
import { LOCATION_EMAIL_CTA_RE } from "./audit-checks";
import { levenshtein } from "@/lib/fuzzy";
import { createEventWithKennel } from "@/lib/event-write";

/**
 * Admin lock predicate: an event whose `adminCancelledAt` is non-null has been
 * explicitly cancelled by an admin and must not be auto-restored to CONFIRMED
 * by any merge code path. Centralized here so all restore sites consult the
 * same invariant — see refreshExistingEvent and upsertCanonicalEvent below.
 *
 * Spec: docs/superpowers/specs/2026-05-01-cancellation-override-design.md
 */
export function isAdminLocked(event: { adminCancelledAt: Date | null }): boolean {
  return event.adminCancelledAt !== null;
}

// Strip a trailing "(text/call/… for address)" parenthetical when its body
// starts with a contact verb AND carries a contact-info signal (3+ digits, @,
// or "for <noun>"). Legit parens like "(Call Center entrance)" or
// "The Pub (upstairs)" survive — both gates must fire.
const CTA_VERB_PREFIX_RE = /^(?:text|call|phone|ping|msg|message)\b/i;
const CONTACT_SIGNAL_RE = /\d{3,}|@|\bfor\s+(?:address|info|directions|details|location)\b/i;

function stripTrailingContactCtaParen(input: string): string {
  const trimmed = input.trimEnd();
  if (!trimmed.endsWith(")")) return input;
  const openIdx = trimmed.lastIndexOf("(");
  if (openIdx === -1) return input;
  const inner = trimmed.slice(openIdx + 1, -1);
  if (!CTA_VERB_PREFIX_RE.test(inner) || !CONTACT_SIGNAL_RE.test(inner)) return input;
  return trimmed.slice(0, openIdx).trimEnd();
}

/** Map kennel country field to Google Geocoding ccTLD region bias code. */
function countryToRegionBias(country?: string | null): string | undefined {
  if (!country) return undefined;
  const normalized = country.toUpperCase();
  if (normalized === "US" || normalized === "USA") return "us";
  if (normalized === "UK" || normalized === "GB") return "gb";
  if (normalized === "IE" || normalized === "IRELAND") return "ie";
  return undefined;
}

/**
 * Resolve the region bias Google Geocoding should use for an event. Prefers the
 * per-event `countryOverride` when the adapter set one (e.g. an annual overseas
 * trip leaving the kennel's home country). An empty-string override means "no
 * bias" — intentionally skip the kennel's default.
 */
function resolveRegionBias(
  event: RawEventData,
  kennelCountry: string | null | undefined,
): string | undefined {
  if (event.countryOverride !== undefined) {
    return event.countryOverride === ""
      ? undefined
      : countryToRegionBias(event.countryOverride);
  }
  return countryToRegionBias(kennelCountry);
}

/**
 * Sanitize raw event fields: decode HTML entities in text fields.
 * Applied at the top of processNewRawEvent() so all downstream sanitizers receive clean text.
 */
function sanitizeRawFields(event: RawEventData): void {
  if (event.title) event.title = decodeEntities(event.title);
  if (event.hares) event.hares = decodeEntities(event.hares);
  if (event.location) event.location = decodeEntities(event.location);
  if (event.description) event.description = decodeEntities(event.description);

  // Extract "Hared by X" from title to hares field (e.g., H5 Harrisburg calendar)
  if (event.title && !event.hares) {
    const haredByMatch = event.title.match(/\s+Hared?\s+by\s+(.+)$/i);
    if (haredByMatch) {
      event.hares = haredByMatch[1].trim();
      event.title = event.title.slice(0, haredByMatch.index).trim();
    }
  }
}

/**
 * Sanitize hares text: strip placeholders, truncate at boilerplate markers,
 * and cap length at 200 chars with smart truncation at last delimiter.
 */
export function sanitizeHares(hares: string | undefined | null): string | null {
  if (!hares) return null;
  let h = hares.trim();
  if (!h) return null;
  if (isPlaceholder(h)) return null;

  // Filter CTA/volunteer placeholders that aren't real hare names — sentence-shaped
  // CTAs (e.g. "We need a Hare, Contact Full Load!" — Makesweat City H3 #1920)
  // get caught here so adapters don't need to special-case per-source. See #963.
  if (/^(?:sign[\s\u00A0]*up!?|volunteer)$/i.test(h)) return null;
  for (const re of CTA_EMBEDDED_PATTERNS) {
    if (re.test(h)) return null;
  }

  // Reject bare URLs (e.g., Google Maps links extracted as hare names)
  if (/^https?:\/\//i.test(h)) return null;

  // Reject single-character values (no real hash name is 1 char — likely a scraping artifact)
  if (h.length === 1) return null;

  // Strip "Hare is " / "Hare: " prefix (some calendars embed the label in the value)
  h = h.replace(/^Hares?\s+(?:is|are|=)\s+/i, "").trim();

  // Truncate at trailing logistics clauses (e.g., ", we are still taking applications...")
  h = h.replace(/,\s*(?:and we |we |still |also |please |but )\b.*/i, "").trim();

  // Truncate at boilerplate markers (description text leaked into hares).
  // If the whole value matches (idx === 0), drop it entirely — e.g. "On On Q"
  // #819 — rather than storing an empty string that would pass through merge.
  const boilerplateIdx = h.search(HARE_BOILERPLATE_RE);
  if (boilerplateIdx === 0) return null;
  if (boilerplateIdx > 0) {
    h = h.slice(0, boilerplateIdx).trim();
    if (!h) return null;
  }

  // Cap at 200 chars with smart truncation at last delimiter
  if (h.length > 200) {
    const truncated = h.slice(0, 200);
    const lastDelim = Math.max(
      truncated.lastIndexOf(","),
      truncated.lastIndexOf(";"),
      truncated.lastIndexOf("&"),
    );
    h = lastDelim > 0 ? truncated.slice(0, lastDelim).trim() : truncated.trim();
  }

  return h || null;
}

/**
 * Derive a user-friendly kennel name for default event titles.
 * For short/cryptic codes (≤4 chars), derives a readable name from fullName.
 * Strips "Hash House Harriers" suffix and appends "H3" when appropriate.
 */
export function friendlyKennelName(shortName: string, fullName: string | null): string {
  if (shortName.length > 4) return shortName;
  if (!fullName) return shortName;
  const friendly = fullName.replace(/\s*Hash House Harriers?(?:\s+and\s+Harriettes?)?\s*$/i, "").trim();
  if (!friendly || friendly === shortName) return shortName;
  const hadHHH = /Hash House Harriers?/i.test(fullName);
  return hadHHH ? `${friendly} H3` : friendly;
}

/** Cache of cache-key → compiled Trail pattern for rewriteStaleDefaultTitle.
 *  Cache key includes both kennelCode and the sorted alias list so renames or
 *  alias additions invalidate the cached pattern naturally. */
const staleTrailPatternCache = new Map<string, RegExp>();

/**
 * Rewrite stale default titles that use a raw kennelCode (or a known alias)
 * instead of the current display name. Returns the corrected title or the
 * original if no rewrite needed.
 *
 * Examples:
 *   - "BRIS Trail" → "Bristol H3 Trail"      (alias "BRIS" rewrites; #884)
 *   - "bristolh3 Trail #42" → "Bristol H3 Trail #42"  (kennelCode rewrites)
 *   - "Bristol H3 Trail" → "Bristol H3 Trail" (already current; no-op)
 *   - "The Posset Cup" → "The Posset Cup"     (real title; no match, unchanged)
 *
 * Aliases that ARE the current display name (case-insensitive) are skipped to
 * avoid no-op rewrites that just rebuild the same string.
 */
export function rewriteStaleDefaultTitle(
  title: string,
  kennelCode: string,
  shortName: string,
  fullName: string | null,
  aliases: string[] = [],
): string {
  const displayName = friendlyKennelName(shortName, fullName);
  if (!displayName) return title;
  const displayLc = displayName.toLowerCase();

  // Build the set of stale prefixes: kennelCode plus any alias that isn't the
  // current display name. Skip empty/whitespace aliases.
  const stalePrefixes = new Set<string>();
  if (kennelCode && kennelCode.toLowerCase() !== displayLc) {
    stalePrefixes.add(kennelCode);
  }
  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (trimmed && trimmed.toLowerCase() !== displayLc) {
      stalePrefixes.add(trimmed);
    }
  }
  if (stalePrefixes.size === 0) return title;

  // Sort by length desc so longer aliases match first (e.g. "Bristol HHH"
  // before "Bristol"), avoiding partial-prefix collisions. Tiebreak with
  // localeCompare so equal-length aliases produce a deterministic cache key
  // regardless of Set insertion order (which depends on alias-add order
  // upstream and would otherwise fragment the regex cache across batches).
  const sortedPrefixes = [...stalePrefixes].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
  const cacheKey = `${kennelCode}|${sortedPrefixes.join("|")}`;
  let pattern = staleTrailPatternCache.get(cacheKey);
  if (!pattern) {
    const escaped = sortedPrefixes
      .map((p) => p.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
      .join("|");
    pattern = new RegExp(String.raw`^(?:${escaped})(\s+Trail.*)`, "i");
    staleTrailPatternCache.set(cacheKey, pattern);
  }
  const match = title.match(pattern);
  return match ? `${displayName}${match[1]}` : title;
}

/** Compiled once — matches admin/meta content in event titles (split to keep regex complexity low). */
const ADMIN_TITLE_PATTERNS = [
  /hares?\s+needed/i,
  /need\s+(?:a\s+)?hares?/i,
  /looking\s+for\s+hares?/i,
  /email\s+the\s+hare/i,
  /volunteer\s+to\s+hare/i,
  /wanna\s+hare/i,
  /available\s+dates/i,
  /check\s+out\s+our/i,
];

/** Detects schedule descriptions used as event titles (e.g., "Mosquito H3 runs on the first and third...") */
const ORDINALS = "first|second|third|fourth|last|1st|2nd|3rd|4th";
const SCHEDULE_DESC_RE = new RegExp(
  `\\b(?:runs?\\s+on\\s+the\\s+(?:${ORDINALS})|meets?\\s+every|hashes?\\s+on\\s+the\\s+(?:${ORDINALS})|runs?\\s+every)\\b`, "i",
);
const isAdminTitle = (s: string) => ADMIN_TITLE_PATTERNS.some(re => re.test(s));

/**
 * Create EventLink records for an event from externalLinks + alternate sourceUrls.
 * Uses upsert with eventId+url unique key to prevent duplicates.
 */
async function createEventLinks(
  eventId: string,
  sourceId: string,
  externalLinks?: { url: string; label: string }[],
) {
  if (!externalLinks?.length) return;
  for (const link of externalLinks) {
    await prisma.eventLink.upsert({
      where: { eventId_url: { eventId, url: link.url } },
      create: { eventId, url: link.url, label: link.label, sourceId },
      update: {}, // No-op if already exists
    });
  }
}

// ── Helper types for internal decomposition ──

/** Cached kennel data shape used by the per-batch cache and resolveKennelData. */
interface KennelCacheEntry {
  kennelCode: string;
  shortName: string;
  fullName: string | null;
  region: string;
  latitude: number | null;
  longitude: number | null;
  country: string;
  regionCentroidLat: number | null;
  regionCentroidLng: number | null;
  /** All known aliases for this kennel — used by rewriteStaleDefaultTitle to
   *  catch alias-prefixed stale titles like "BRIS Trail" → "Bristol H3 Trail"
   *  on kennels whose displayed shortName has changed since the row was
   *  scraped. See #884. */
  aliases: string[];
}

/** Source types whose location field is canonical and should not be enriched with a
 *  reverse-geocoded city. The display layer would otherwise append garbage like "1, Tokyo". */
function shouldSkipReverseGeocode(sourceType: SourceType | null): boolean {
  return sourceType === "HARRIER_CENTRAL";
}

/** Per-batch state threaded through all merge helper functions. */
/** Narrow select for the per-batch event cache. Skips columns the merge
 *  pipeline never reads — notably `adminAuditLog`, a Json column that grows
 *  unbounded on rows with cancel/uncancel history and would otherwise
 *  balloon prefetch payloads on backfill scrapes. */
const EVENT_CACHE_SELECT = {
  id: true,
  kennelId: true,
  date: true,
  dateUtc: true,
  timezone: true,
  runNumber: true,
  title: true,
  description: true,
  haresText: true,
  locationName: true,
  locationStreet: true,
  locationCity: true,
  locationAddress: true,
  latitude: true,
  longitude: true,
  startTime: true,
  endTime: true,
  cost: true,
  trailLengthText: true,
  trailLengthMinMiles: true,
  trailLengthMaxMiles: true,
  difficulty: true,
  trailType: true,
  dogFriendly: true,
  prelube: true,
  sourceUrl: true,
  trustLevel: true,
  isSeriesParent: true,
  parentEventId: true,
  status: true,
  adminCancelledAt: true,
  createdAt: true,
  isCanonical: true,
} as const satisfies Prisma.EventSelect;
type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_CACHE_SELECT }>;

interface MergeContext {
  sourceId: string;
  /** Source trust level (1–10); higher-trust sources overwrite lower-trust data. */
  trustLevel: number;
  /** Source adapter type — used to skip reverse-geocoded city enrichment for sources
   *  that already provide a canonical location (e.g. HARRIER_CENTRAL). */
  sourceType: SourceType | null;
  /** Kennel IDs linked to this source via SourceKennel (for the guard check). */
  linkedKennelIds: Set<string>;
  /** Per-batch cache of kennelId → kennel data to avoid N+1 queries. */
  kennelCache: Map<string, KennelCacheEntry>;
  /** Per-batch cache of short Maps URL → resolved full URL (avoids repeated HTTP calls). */
  shortUrlCache: Map<string, string | null>;
  /** Per-batch tracking: which canonical Event IDs have been matched for each kennel+date.
   *  Key = `${kennelId}:${dateIso}`, value = set of canonical Event IDs matched in this batch.
   *  Used to distinguish double-headers (same source, second event) from cross-source merges. */
  batchMatchedEvents: Map<string, Set<string>>;
  /** Per-batch prefetched RawEvents keyed by fingerprint. Avoids the N+1 in
   *  `handleDuplicateFingerprint` (one `findFirst` per incoming event). Populated
   *  once before the loop; updated in-place when `processNewRawEvent` creates a
   *  new RawEvent so duplicate fingerprints later in the same batch still resolve. */
  existingByFingerprint: Map<string, ExistingRawEventEntry>;
  /** Per-kennel event-cache + write buffers driving the #1287 batching
   *  (one `event.findMany` per kennel touched, one `kennel.updateMany` per
   *  kennel after the loop). Lazily populated by `ensureKennelEventCache`;
   *  mirrored on CREATE via `rememberCreatedEvent` and on UPDATE via
   *  in-place patching at the upsert site. */
  eventBatch: EventBatchState;
  result: MergeResult;
}

interface EventBatchState {
  /** Union of UTC-noon event dates across the batch — drives the prefetch window. */
  dates: Date[];
  /** Per-kennel pool of canonical Events. Filtered by date on access in `getSameDayEvents`. */
  sameDayByKennel: Map<string, EventRow[]>;
  /** Per-kennel pool of fuzzy candidates: parents/non-series only, sorted trustLevel desc. */
  fuzzyPoolByKennel: Map<string, EventRow[]>;
  /** Per-kennel max event date observed; flushed as one `kennel.updateMany` per kennel. */
  kennelMaxDates: Map<string, Date>;
}

/** `select` for the dedup prefetch — kept as a hoisted const so the value type
 *  derived from it (`ExistingRawEventEntry`) stays in lock-step with the query. */
const RAW_EVENT_DEDUP_SELECT = {
  id: true,
  fingerprint: true,
  processed: true,
  eventId: true,
} as const satisfies Prisma.RawEventSelect;
type ExistingRawEventEntry = Prisma.RawEventGetPayload<{ select: typeof RAW_EVENT_DEDUP_SELECT }>;

/** Cap on `WHERE fingerprint IN (...)` size per query — keeps Postgres planner
 *  cost linear and stays well below the 65535 bind-parameter limit. Historical
 *  re-scrapes (e.g. SDH3 ~7649 events) chunk transparently. */
const DEDUP_PREFETCH_CHUNK_SIZE = 1000;

/** Single-query batch dedup prefetch (with chunking for very large batches).
 *  Returns the prefetched RawEvent rows, in any order. The caller keys them
 *  by fingerprint into `existingByFingerprint`. */
/** Compute fingerprints for every event up front so the prefetch query and the
 *  per-event loop can share them. Wraps each call so a malformed event
 *  (rare) is recorded as an isolated `eventError` instead of aborting the
 *  whole batch. Events absent from the returned map are skipped by the loop. */
function precomputeFingerprints(
  events: RawEventData[],
  result: MergeResult,
): Map<RawEventData, string> {
  const fingerprintByEvent = new Map<RawEventData, string>();
  for (const event of events) {
    try {
      fingerprintByEvent.set(event, generateFingerprint(event));
    } catch (err) {
      recordMergeError(event, err, result, "<fingerprint-error>");
    }
  }
  return fingerprintByEvent;
}

async function prefetchExistingByFingerprint(
  sourceId: string,
  fingerprints: string[],
): Promise<ExistingRawEventEntry[]> {
  if (fingerprints.length === 0) return [];
  if (fingerprints.length <= DEDUP_PREFETCH_CHUNK_SIZE) {
    return prisma.rawEvent.findMany({
      where: { sourceId, fingerprint: { in: fingerprints } },
      select: RAW_EVENT_DEDUP_SELECT,
    });
  }
  const chunks: string[][] = [];
  for (let i = 0; i < fingerprints.length; i += DEDUP_PREFETCH_CHUNK_SIZE) {
    chunks.push(fingerprints.slice(i, i + DEDUP_PREFETCH_CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      prisma.rawEvent.findMany({
        where: { sourceId, fingerprint: { in: chunk } },
        select: RAW_EVENT_DEDUP_SELECT,
      }),
    ),
  );
  return results.flat();
}

/** Resolve kennel data (name + region + coords + country + region centroid), using the per-batch cache to avoid N+1 queries. */
async function resolveKennelData(kennelId: string, ctx: MergeContext): Promise<KennelCacheEntry> {
  let cached = ctx.kennelCache.get(kennelId);
  if (cached === undefined) {
    const kennel = await prisma.kennel.findUnique({
      where: { id: kennelId },
      select: {
        kennelCode: true, shortName: true, fullName: true, region: true,
        latitude: true, longitude: true, country: true,
        regionRef: { select: { centroidLat: true, centroidLng: true } },
        aliases: { select: { alias: true } },
      },
    });
    cached = {
      kennelCode: kennel?.kennelCode ?? "",
      shortName: kennel?.shortName ?? "",
      fullName: kennel?.fullName ?? null,
      region: kennel?.region ?? "",
      latitude: kennel?.latitude ?? null,
      longitude: kennel?.longitude ?? null,
      country: kennel?.country ?? "",
      regionCentroidLat: kennel?.regionRef?.centroidLat ?? null,
      regionCentroidLng: kennel?.regionRef?.centroidLng ?? null,
      aliases: kennel?.aliases?.map((a) => a.alias) ?? [],
    };
    ctx.kennelCache.set(kennelId, cached);
  }
  return cached;
}

/** Resolve region for a kennel, using the per-batch cache to avoid N+1 queries. */
async function resolveRegion(kennelId: string, ctx: MergeContext): Promise<string> {
  const data = await resolveKennelData(kennelId, ctx);
  return data.region;
}

/**
 * Lazy-warm the per-batch event caches for a kennel (issue #1287).
 *
 * On first call for a kennelId, runs ONE `event.findMany` covering the union
 * of `ctx.eventBatch.dates ± FUZZY_WINDOW_MS`, then partitions the result into:
 *   - `ctx.eventBatch.sameDayByKennel`     — `Map<dateISO, EventRow[]>` for same-day matching
 *                              in `upsertCanonicalEvent` (no parent/series filter).
 *   - `ctx.eventBatch.fuzzyPoolByKennel` — sorted `EventRow[]` of parents/non-series only,
 *                              for `findFuzzyDuplicateInWindow`.
 *
 * Replaces two per-new-event `event.findMany` calls. Subsequent calls for the
 * same kennelId are no-ops; CREATE paths in `upsertCanonicalEvent` keep both
 * caches in sync via `rememberCreatedEvent`. A cross-window match (rare —
 * `MERGE_FUZZY_DEDUP=true` is off in prod) physically moves an Event's date,
 * so we invalidate via `invalidateKennelEventCache` and re-fetch on next use.
 */
async function ensureKennelEventCache(kennelId: string, ctx: MergeContext): Promise<void> {
  if (ctx.eventBatch.sameDayByKennel.has(kennelId)) return;

  if (ctx.eventBatch.dates.length === 0) {
    ctx.eventBatch.sameDayByKennel.set(kennelId, []);
    ctx.eventBatch.fuzzyPoolByKennel.set(kennelId, []);
    return;
  }

  // Window strategy:
  //   - Fuzzy OFF (default in prod): query `date IN [...batchDates]`. Narrow
  //     and Postgres uses the (kennelId, date) index efficiently — never
  //     pulls non-batch events for a kennel (avoids the SDH3-backfill
  //     pathology where one scrape would otherwise load 7K+ historical
  //     rows because batchDates spans a year).
  //   - Fuzzy ON: widen to `date BETWEEN min - 48h AND max + 48h` so the
  //     fuzzy probe sees ±48h neighbors. Acceptable cost since fuzzy is
  //     gated by `MERGE_FUZZY_DEDUP=true` and only enabled deliberately.
  const fuzzyEnabled = process.env.MERGE_FUZZY_DEDUP === "true";
  let where: { kennelId: string; date: Prisma.DateTimeFilter | { in: Date[] } };
  if (fuzzyEnabled) {
    let minMs = Infinity;
    let maxMs = -Infinity;
    for (const d of ctx.eventBatch.dates) {
      const t = d.getTime();
      if (t < minMs) minMs = t;
      if (t > maxMs) maxMs = t;
    }
    where = {
      kennelId,
      date: { gte: new Date(minMs - FUZZY_WINDOW_MS), lte: new Date(maxMs + FUZZY_WINDOW_MS) },
    };
  } else {
    where = { kennelId, date: { in: ctx.eventBatch.dates } };
  }

  const events = await prisma.event.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: EVENT_CACHE_SELECT,
  });
  ctx.eventBatch.sameDayByKennel.set(kennelId, events);

  // Fuzzy pool: parents/non-series only, sorted by trustLevel desc (createdAt
  // asc preserves the secondary key from the cache-wide sort). `== null`
  // matches both `null` (real Events) and `undefined` (test mocks that omit
  // parentEventId — same loose contract the prior `where:` filter gave when
  // Vitest mocks ignored the `parentEventId: null` predicate).
  const fuzzyPool = events.filter(
    (e) => e.parentEventId == null && !e.isSeriesParent,
  );
  fuzzyPool.sort((a, b) => b.trustLevel - a.trustLevel);
  ctx.eventBatch.fuzzyPoolByKennel.set(kennelId, fuzzyPool);
}

/** Filter a kennel's cached pool down to events on a specific UTC-noon date.
 *  Rows without a Date `date` (test mocks) match every lookup, mirroring the
 *  loose contract of the prior per-event `event.findMany` whose `where.date`
 *  was ignored by Vitest mocks. */
function getSameDayEvents(kennelId: string, eventDate: Date, ctx: MergeContext): EventRow[] {
  const pool = ctx.eventBatch.sameDayByKennel.get(kennelId);
  if (!pool) return [];
  const eventTime = eventDate.getTime();
  return pool.filter((e) => !(e.date instanceof Date) || e.date.getTime() === eventTime);
}

/** Mirror a freshly-created Event into both per-kennel caches so subsequent
 *  events in the same batch see it on lookup. Mirrors the row reference, so
 *  in-place updates by later iterations stay visible. The fuzzy-pool insert
 *  uses an O(N) walk + splice instead of `Array.sort` so a batch creating
 *  M events on one kennel stays linear, not M·N·logN. */
function rememberCreatedEvent(kennelId: string, created: EventRow, ctx: MergeContext): void {
  const pool = ctx.eventBatch.sameDayByKennel.get(kennelId);
  if (pool) pool.push(created);
  if (created.parentEventId == null && !created.isSeriesParent) {
    const fuzzyPool = ctx.eventBatch.fuzzyPoolByKennel.get(kennelId);
    if (fuzzyPool) {
      // Pool is sorted by trustLevel desc; insert before the first row with
      // a lower trustLevel (or push if `created` is the new lowest).
      let i = 0;
      while (i < fuzzyPool.length && fuzzyPool[i].trustLevel >= created.trustLevel) i++;
      fuzzyPool.splice(i, 0, created);
    }
  }
}

/** Force a refetch of the kennel's event caches on next access. Used when a
 *  cross-window fuzzy match physically moves an Event's date in DB; the cache
 *  index by date would otherwise be stale. Cheap because cross-window matches
 *  are gated by MERGE_FUZZY_DEDUP and very rare. */
function invalidateKennelEventCache(kennelId: string, ctx: MergeContext): void {
  ctx.eventBatch.sameDayByKennel.delete(kennelId);
  ctx.eventBatch.fuzzyPoolByKennel.delete(kennelId);
}

/**
 * Refresh dateUtc/timezone on a canonical Event for a processed duplicate.
 * Only updates if the source has sufficient trust and values differ.
 */
async function refreshExistingEvent(
  existingEventId: string,
  event: RawEventData,
  ctx: MergeContext,
): Promise<void> {
  const { kennelId, matched } = await resolveKennelTag(event.kennelTags[0], ctx.sourceId);
  if (!matched || !kennelId || !ctx.linkedKennelIds.has(kennelId)) return;

  const region = await resolveRegion(kennelId, ctx);
  const timezone = regionTimezone(region);
  const eventDate = parseUtcNoonDate(event.date);
  const composedUtc = composeUtcStart(eventDate, event.startTime, timezone);

  const existingEvent = await prisma.event.findUnique({
    where: { id: existingEventId },
    select: {
      trustLevel: true,
      dateUtc: true,
      timezone: true,
      status: true,
      adminCancelledAt: true,
    },
  });
  // Auto-restore cancelled events when source still returns them. Runs even
  // when we can't compose a dateUtc (scraped row has no startTime) — otherwise
  // processed=true duplicates for rows without startTime stay CANCELLED forever
  // because upsertCanonicalEvent's restore path is unreachable here. (#874)
  // Admin-locked events are exempt from auto-restore: an admin explicitly
  // cancelled the event and the lock survives any source re-emission.
  const shouldRestore =
    existingEvent?.status === "CANCELLED" && !isAdminLocked(existingEvent);
  const isHigherOrEqualTrust = !existingEvent || ctx.trustLevel >= existingEvent.trustLevel;
  const isAlreadyCurrent =
    !!composedUtc &&
    existingEvent?.dateUtc?.getTime() === composedUtc.getTime() &&
    existingEvent?.timezone === timezone;
  const shouldRefreshDateUtc = !!composedUtc && isHigherOrEqualTrust && !isAlreadyCurrent;
  if (!shouldRestore && !shouldRefreshDateUtc) return;

  await prisma.event.update({
    where: { id: existingEventId },
    data: {
      ...(shouldRefreshDateUtc ? { dateUtc: composedUtc, timezone } : {}),
      ...(shouldRestore ? { status: "CONFIRMED" as const } : {}),
    },
  });
  if (shouldRestore) ctx.result.restored++;
}

/**
 * Collect diagnostic samples for unprocessed duplicates (skipped/blocked).
 */
async function collectSkippedAndBlockedSamples(
  event: RawEventData,
  ctx: MergeContext,
): Promise<void> {
  const needSkippedSamples = ctx.result.sampleSkipped && ctx.result.sampleSkipped.length < 3;
  const needBlockedSamples = ctx.result.sampleBlocked && ctx.result.sampleBlocked.length < 3;
  if (!needSkippedSamples && !needBlockedSamples) return;

  const { kennelId: resolvedId, matched: resolvedMatch } =
    await resolveKennelTag(event.kennelTags[0], ctx.sourceId);

  if (!resolvedMatch || !resolvedId) {
    if (needSkippedSamples) {
      ctx.result.sampleSkipped?.push({
        reason: "UNMATCHED_TAG",
        kennelTag: event.kennelTags[0],
        event,
        suggestedAction: `Create kennel or alias for "${event.kennelTags[0]}"`,
      });
    }
  } else if (!ctx.linkedKennelIds.has(resolvedId)) {
    if (needBlockedSamples) {
      const kennel = await prisma.kennel.findUnique({ where: { id: resolvedId }, select: { shortName: true } });
      ctx.result.sampleBlocked?.push({
        reason: "SOURCE_KENNEL_MISMATCH",
        kennelTag: event.kennelTags[0],
        event,
        suggestedAction: `Link ${kennel?.shortName ?? resolvedId} to this source`,
      });
    }
  }
}

/**
 * Check if the event fingerprint already exists (dedup).
 * If the RawEvent is already processed, refreshes dateUtc/timezone on the canonical Event.
 * Returns `false` if no duplicate exists (proceed with upsert).
 * Returns the canonical eventId (or null if unprocessed) when a duplicate is found.
 */
async function handleDuplicateFingerprint(
  event: RawEventData,
  fingerprint: string,
  ctx: MergeContext,
): Promise<false | string | null> {
  // Read-through the per-batch prefetch map populated in `processRawEvents`
  // (Sentry JAVASCRIPT-NEXTJS-3 — was one `findFirst` per incoming event).
  const existing = ctx.existingByFingerprint.get(fingerprint);
  if (!existing) return false; // Not a duplicate — proceed normally

  ctx.result.skipped++;

  if (existing.processed) {
    if (existing.eventId) {
      await refreshExistingEvent(existing.eventId, event, ctx);
    }
    return existing.eventId;
  }

  // Orphaned RawEvent: unprocessed with no linked Event (e.g., canonical Event was
  // admin-deleted). Re-process it — the caller will upsert the RawEvent and create
  // a fresh canonical Event. Without this, orphaned RawEvents are permanently stuck.
  if (!existing.eventId) {
    ctx.result.skipped--; // undo the increment — this will be counted as created
    return false;
  }

  // Unprocessed duplicate with linked Event — collect diagnostic samples
  await collectSkippedAndBlockedSamples(event, ctx);

  return existing.eventId;
}

/**
 * Resolve kennel tag and apply source-kennel guard.
 * Returns the kennelId if resolution succeeds and the kennel is linked,
 * or null if the event should be skipped/blocked.
 */
async function resolveAndGuardKennel(
  event: RawEventData,
  ctx: MergeContext,
): Promise<string | null> {
  const { kennelId, matched } = await resolveKennelTag(event.kennelTags[0], ctx.sourceId);

  if (!matched || !kennelId) {
    // Flag for review — leave unprocessed
    if (!ctx.result.unmatched.includes(event.kennelTags[0])) {
      ctx.result.unmatched.push(event.kennelTags[0]);
    }
    if (ctx.result.sampleSkipped && ctx.result.sampleSkipped.length < 3) {
      ctx.result.sampleSkipped.push({
        reason: "UNMATCHED_TAG",
        kennelTag: event.kennelTags[0],
        event,
        suggestedAction: `Create kennel or alias for "${event.kennelTags[0]}"`,
      });
    }
    return null;
  }

  // Guard: block events for kennels not linked to this source
  if (!ctx.linkedKennelIds.has(kennelId)) {
    ctx.result.blocked++;
    if (!ctx.result.blockedTags.includes(event.kennelTags[0])) {
      ctx.result.blockedTags.push(event.kennelTags[0]);
    }
    if (ctx.result.sampleBlocked && ctx.result.sampleBlocked.length < 3) {
      const kennel = await prisma.kennel.findUnique({
        where: { id: kennelId },
        select: { shortName: true },
      });
      ctx.result.sampleBlocked.push({
        reason: "SOURCE_KENNEL_MISMATCH",
        kennelTag: event.kennelTags[0],
        event,
        suggestedAction: `Link ${kennel?.shortName ?? kennelId} to this source`,
      });
    }
    return null;
  }

  return kennelId;
}

/**
 * Extract lat/lng from a raw event, preferring explicit coords then parsing the locationUrl.
 * Returns an empty object if no coordinates can be determined.
 */
function extractRawCoords(event: RawEventData): { latitude?: number; longitude?: number } {
  if (event.latitude != null && event.longitude != null) {
    return { latitude: event.latitude, longitude: event.longitude };
  }
  if (event.locationUrl) {
    const coords = extractCoordsFromMapsUrl(event.locationUrl);
    if (coords) return { latitude: coords.lat, longitude: coords.lng };
  }
  // Parse DMS coordinates embedded in location string (e.g., "Fort Misery, 34°08'52.8"N 112°22'05.6"W")
  if (event.location) {
    const dms = parseDMSFromLocation(event.location);
    if (dms) return { latitude: dms.lat, longitude: dms.lng };
  }
  return {};
}

/**
 * Sanitize event titles: strip admin placeholders, "hares needed" messages, and email addresses.
 * Returns null for titles that are pure admin content, so the display layer falls back to kennel name.
 */
export function sanitizeTitle(title: string | undefined): string | null {
  if (!title) return null;
  const t = title.trim();
  if (!t) return null;
  // Detect titles that are purely a time string (e.g. "12:30pm", "1pm") — fall back to kennel name
  if (/^(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})$/i.test(t)) return null;
  // Strip leading kennel-tag prefix (e.g. "BH3: " or "NYCH3 - ") before testing
  const stripped = t.replace(/^[A-Z0-9]{2,10}\s*[:–—-]\s*/i, "").trim();
  // Filter out admin/meta content in titles (test both original and stripped)
  if (isAdminTitle(t) || isAdminTitle(stripped)) return null;
  // Filter schedule descriptions used as titles (e.g., "Mosquito H3 runs on the first and third Wednesdays")
  if (SCHEDULE_DESC_RE.test(t) || SCHEDULE_DESC_RE.test(stripped)) return null;
  // Strip embedded numeric dates (M/DD/YY, MM/DD/YYYY) — but not "#N/NN" run numbers
  let cleaned = t.replace(/(?<!#)\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "");
  // Strip leading "DayOfWeek Month DDth" prefix (e.g., "Saturday March 28th OH3 #1364 Granny Panties")
  cleaned = cleaned.replace(
    /^(?:Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?)\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\s+/i,
    "",
  );
  // Strip trailing "day-of-week, month DD[, YYYY]" patterns
  cleaned = cleaned.replace(
    /,?\s*(?:Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?),?\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s*\d{4})?\s*$/i,
    "",
  );
  // Strip trailing " - Location TBD" suffixes (e.g., EWH3 calendar: "Hare Names - Location TBD")
  cleaned = cleaned.replace(/\s*-\s*Location\s+TBD\s*$/i, "").trim();
  // Collapse multiple spaces from stripping and trim
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  // Strip embedded email addresses
  cleaned = cleaned.replace(/\s*<?[\w.+-]+@[\w.-]+>?\s*/g, " ").trim();
  // Strip parenthetical instruction text (e.g., "(See: hashphilly.com for details)")
  cleaned = cleaned.replace(/\s*\((?:See|Visit|Check|Go to)[:\s].+?\)/gi, "").trim();
  return cleaned || null;
}

/** Abbreviation map for address normalization (used by deduplicateAddressPrefix). */
/** Pre-compiled address abbreviation patterns (avoids RegExp allocation per call). */
const ADDR_PATTERNS = Object.entries({
  north: "n", south: "s", east: "e", west: "w",
  road: "rd", street: "st", avenue: "ave",
  boulevard: "blvd", place: "pl", drive: "dr",
  lane: "ln", court: "ct", circle: "cir", highway: "hwy",
} as Record<string, string>).map(([word, abbr]) => ({
  pattern: new RegExp(`\\b${word}\\b`, "gi"),
  abbr,
}));

/** Normalize an address segment for comparison: lowercase + apply abbreviations. */
function normalizeAddr(s: string): string {
  let normalized = s.toLowerCase();
  for (const { pattern, abbr } of ADDR_PATTERNS) {
    normalized = normalized.replace(pattern, abbr);
  }
  return normalized.replaceAll(/[.\s]+/g, " ").trim();
}

/**
 * Deduplicate abbreviated address prefixes in Google Calendar locations.
 * E.g., "North San Miguel Road & Barcelona Place, N San Miguel Rd & Barcelona Pl, Walnut, CA"
 * → "North San Miguel Road & Barcelona Place, Walnut, CA"
 */
function deduplicateAddressPrefix(location: string): string {
  const parts = location.split(", ");
  if (parts.length < 3) return location;
  const norm0 = normalizeAddr(parts[0]);
  const norm1 = normalizeAddr(parts[1]);
  if (norm0 && norm1 && (norm0 === norm1 || norm0.includes(norm1) || norm1.includes(norm0))) {
    const keepFirst = parts[0].length >= parts[1].length;
    return keepFirst
      ? [parts[0], ...parts.slice(2)].join(", ")
      : parts.slice(1).join(", ");
  }
  return location;
}

/**
 * Sanitize location names: filter placeholders (TBA/TBD) and bare URLs.
 * Returns null for locations that are not meaningful display text.
 */
export function sanitizeLocation(location: string | undefined): string | null {
  if (!location) return null;
  let t = location.trim();
  if (!t) return null;
  if (isPlaceholder(t)) return null;
  // Strip embedded DMS coordinates (e.g., "Fort Misery, 34°08'52.8"N 112°22'05.6"W") — coords stored separately
  t = stripDMSFromLocation(t);
  // Filter "Online event" (Meetup/Calendar default for virtual events — not valid for hash runs)
  if (/^online\s*(?:event)?$/i.test(t)) return null;
  // Strip "Registration: url" values used as location
  if (/^registration\s*:/i.test(t)) return null;
  // Strip bare URLs (not useful as location names)
  if (/^https?:\/\/\S+$/.test(t)) return null;
  // Strip trailing "(text/call/… for address)" CTA so geocoding stays clean (#831).
  t = stripTrailingContactCtaParen(t);
  if (!t) return null;
  // Strip "Maps, " prefix (Google Calendar link text bleed)
  // Strip common instruction prefixes ("Meet at", "Park at", "Start at", etc.)
  const stripped = t.replace(/^Maps,\s*/i, "")
    .replace(/^(?:Meet|Park|Start|Gather|Hash|Walk)\s+at\s+/i, "")
    .replace(/^(?:Head|Leave|Walk)\s+(?:to|from)\s+/i, "")
    // Strip leading decimal coordinate pairs (e.g., "30.290552, -97.772365, the corner of...")
    .replace(/^-?\d+\.\d{3,},\s*-?\d+\.\d{3,}[,\s]*/, "")
    // Strip trailing decimal coordinate pairs (e.g., ". 35.898606, -78.579631" or bare "35.898, -78.579")
    .replace(/[.,]?\s*-?\d+\.\d{3,},\s*-?\d+\.\d{3,}\s*$/, "")
    .replace(/\.\s*$/, "")  // clean up trailing period left behind
    // Strip instruction suffixes after em-dash or period ("— check Facebook for details")
.replace(/(\s*[—–]|\.)\s*(?:check|see|visit|call|contact|email|for)\b.*/i, "")
    .trim();
  // Drop pure email-CTA locations ("Inquire for location: foo@bar.com") — not
  // geocodable (#829). Applied after prefix strip so "Maps, Inquire..." hits too.
  if (LOCATION_EMAIL_CTA_RE.test(stripped)) return null;
  // Clean up embedded URLs, double commas, extra whitespace, normalize state abbrev
  let cleaned = stripUrlsFromText(stripped)
    .replace(/,\s*,/g, ",")
    .replace(/^,+|,+$/g, "")
    .trim()
    .replace(/,\s*([a-z]{2})$/i, (_, st: string) => `, ${st.toUpperCase()}`);
  if (!cleaned || isPlaceholder(cleaned)) return null;
  cleaned = deduplicateAddressPrefix(cleaned);
  // Deduplicate comma-separated segments (case-insensitive, keep first occurrence)
  const segments = cleaned.split(", ");
  if (segments.length > 1) {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const seg of segments) {
      const key = seg.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(seg);
      }
    }
    cleaned = unique.join(", ");
  }
  return cleaned;
}

/**
 * Suppress reverse-geocoded locationCity when locationName already contains a full
 * US address and the city doesn't match (avoids "Hartville, OH, Akron, OH").
 *
 * Three US-specific patterns trigger the city/locationName comparison:
 *   1. `…, ST` or `…, ST 12345`            (short-form trailing state code)
 *   2. `ST 12345` anywhere in the string   (#906: catches `…, ST 12345, USA`
 *      where Google's reverse geocoder returns a neighborhood like
 *      "Marlene Village, OR" that shouldn't be appended to a fully-qualified
 *      address.)
 *   3. `12345, ST` anywhere in the string  (#906 + #907: Harrier Central and
 *      Google Maps emit addresses like `…, 26505-7511, WV, United States`
 *      with ZIP before state.)
 *
 * All three require a 2-letter US state code adjacent to a 5-digit ZIP —
 * a bare 5-digit number is not enough, so international addresses with
 * 5-digit postal codes (e.g. "80331 München, Germany") are left alone.
 */
export function suppressRedundantCity(locationName: string | null, city: string | null): string | null {
  if (!city || !locationName) return city;
  const stateSuffix = /,\s*[A-Z]{2}(?:\s+\d{5})?$/.test(locationName);
  const hasStateZip = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(locationName);
  const hasZipState = /\b\d{5}(?:-\d{4})?,\s*[A-Z]{2}\b/.test(locationName);
  if (!stateSuffix && !hasStateZip && !hasZipState) return city;
  // Require at least 3 segments (e.g., "Street, City, ST") — fewer suggests incomplete address
  if (locationName.split(",").length < 3) return city;
  const cityName = city.split(",")[0].trim();
  if (cityName && !locationName.includes(cityName)) return null;
  return city;
}

/** Filter non-place location URLs (My Maps viewers, etc). Returns null for unusable URLs. */
function sanitizeLocationUrl(url: string | undefined): string | null {
  if (!url) return null;
  // Google My Maps viewer/editor URLs are not place links
  if (/google\.[\w.]+\/maps\/d\//i.test(url)) return null;
  return url;
}

/**
 * Resolve coordinates for a raw event: explicit coords → URL extraction → geocode fallback.
 * Optionally skips geocoding if the canonical event already has stored coords and
 * the location text hasn't changed.
 */
/** Detect non-English geographic terms in a location string (e.g., French "État de New York"). */
export const NON_ENGLISH_GEO_RE = /\b(?:États?[ -]Unis|État de|Bundesland|Straße|Vereinigte Staaten|Provincia de|Comunidad de|Préfecture)\b/i;

async function resolveCoords(
  event: RawEventData,
  existingCoords?: { latitude: number | null; longitude: number | null; locationAddress: string | null },
  shortUrlCache?: Map<string, string | null>,
  kennelCoords?: { latitude: number | null; longitude: number | null; regionCentroidLat?: number | null; regionCentroidLng?: number | null },
  regionBias?: string,
): Promise<{ latitude?: number; longitude?: number; normalizedLocation?: string }> {
  const rawCoords = extractRawCoords(event);
  if (rawCoords.latitude != null) return rawCoords;

  // Skip geocoding when the canonical event already has coords and location hasn't changed.
  // Adapters can opt out via `dropCachedCoords` when they know the stored coords are
  // stale (e.g. Harrier Central's geocode-failure fallback pin — #957) and need a
  // fresh geocode even though `locationUrl` hasn't changed (HC events have it null).
  if (
    !event.dropCachedCoords &&
    existingCoords &&
    existingCoords.latitude != null &&
    existingCoords.longitude != null &&
    (event.locationUrl ?? null) === (existingCoords.locationAddress ?? null)
  ) {
    return { latitude: existingCoords.latitude, longitude: existingCoords.longitude };
  }

  // Try resolving short Maps URLs (maps.app.goo.gl) to full URLs with coordinates
  if (event.locationUrl) {
    let resolvedUrl = shortUrlCache?.get(event.locationUrl);
    if (resolvedUrl === undefined) {
      resolvedUrl = await resolveShortMapsUrl(event.locationUrl);
      shortUrlCache?.set(event.locationUrl, resolvedUrl);
    }
    if (resolvedUrl) {
      const coords = extractCoordsFromMapsUrl(resolvedUrl);
      if (coords) return { latitude: coords.lat, longitude: coords.lng };
    }
  }

  if (event.location) {
    const geocoded = await geocodeAddress(event.location, regionBias ? { regionBias } : undefined);
    if (geocoded) {
      // Validate geocoded result against kennel coords or region centroid (if available)
      // Skip geocode if result is >200km from reference point — likely wrong city/state.
      // Adapters set `countryOverride` on per-event overseas trips (e.g. NTKH4 annual
      // Taoyuan run) to opt out of the kennel-proximity check, which would otherwise
      // reject the correct far-away pin.
      const valLat = kennelCoords?.latitude ?? kennelCoords?.regionCentroidLat;
      const valLng = kennelCoords?.longitude ?? kennelCoords?.regionCentroidLng;
      if (valLat != null && valLng != null && event.countryOverride === undefined) {
        const dist = haversineDistance(geocoded.lat, geocoded.lng, valLat, valLng);
        if (dist > 200) {
          console.warn(`Geocode validation: "${event.location}" resolved ${dist.toFixed(0)}km from kennel — skipping`);
          return {};
        }
      }
      // If location contains non-English geographic terms, use the geocoder's
      // English formatted address instead (e.g., "Rochester, État de New York" → "Rochester, NY")
      const normalizedLocation = NON_ENGLISH_GEO_RE.test(event.location) && geocoded.formattedAddress
        ? geocoded.formattedAddress
        : undefined;
      return { latitude: geocoded.lat, longitude: geocoded.lng, normalizedLocation };
    }
  }
  return {};
}

// ── Fuzzy ±48h cross-source dedup (#990) ──
//
// Strict same-day `(kennelId, date)` dedup misses the case where two sources
// legitimately disagree on the start date by ±1 day (setup-day vs main-day,
// TZ confusion, AM/PM ambiguity — see BurlyH3 Invihash in #886). Gated
// behind `MERGE_FUZZY_DEDUP=true` so the feature ships disabled and can be
// flipped on in Vercel without redeploy.

const FUZZY_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // ±48h
const FUZZY_TITLE_DISTANCE = 4;
const FUZZY_LOCATION_DISTANCE = 8;
// 120 min: setup-day vs main-day in #886 diverges by 60 min (14:00 vs 15:00),
// AM/PM ambiguity can shift 12h but title/location gates catch those, and
// >2h dayparts are reliably distinct trails worth keeping split.
const FUZZY_TIME_TOLERANCE_MIN = 120;
// Min normalized-title length: Levenshtein ≤ 4 against a 3-char title matches
// almost any other 3-char title, so refuse to probe when there's not enough
// signal — avoids both wasted DB round-trips and pathological matches.
const FUZZY_MIN_TITLE_LEN = 4;

/** Normalize a title for fuzzy comparison: lowercase, strip run-number tokens
 *  (`#42`, `42`), collapse whitespace. */
function normalizeTitleForFuzzy(t: string | null | undefined): string {
  if (!t) return "";
  return t.toLowerCase().replace(/\b#?\d+\b/g, "").replace(/\s+/g, " ").trim();
}

/** Absolute minute diff between two `"HH:MM"` strings; returns Infinity on
 *  malformed input so callers' reject-on-conflict gates stay conservative. */
function timeDiffMinutes(a: string, b: string): number {
  const av = timeToMinutes(a);
  const bv = timeToMinutes(b);
  if (av == null || bv == null) return Infinity;
  return Math.abs(av - bv);
}


/**
 * Look for an existing canonical row at the same kennel within ±48h whose title
 * fuzzy-matches the incoming event AND has no conflicting runNumber, startTime,
 * or location. Returns at most one candidate (highest trust, most recent).
 *
 * Excludes series rows (parentEventId set OR isSeriesParent=true) so multi-day
 * series machinery from `linkMultiDaySeries` stays disjoint from cross-source
 * dedup. Also excludes candidates that already have a RawEvent from the
 * incoming source — fuzzy dedup is for collapsing DIFFERENT sources' takes on
 * one real-world event, not the same source emitting back-to-back trails on
 * adjacent days (PR #1040 review).
 */
async function findFuzzyDuplicateInWindow(
  event: RawEventData,
  kennelId: string,
  eventDate: Date,
  ctx: MergeContext,
): Promise<EventRow | null> {
  const incomingTitle = normalizeTitleForFuzzy(event.title);
  if (incomingTitle.length < FUZZY_MIN_TITLE_LEN) return null;

  const windowStart = eventDate.getTime() - FUZZY_WINDOW_MS;
  const windowEnd = eventDate.getTime() + FUZZY_WINDOW_MS;
  const eventTime = eventDate.getTime();

  // Pull the per-kennel fuzzy pool from the per-batch cache — issue #1287
  // collapsed the previous per-event `event.findMany` here. Pool is already
  // filtered to parents/non-series and sorted by trustLevel desc, createdAt
  // asc; we just narrow to the per-event ±48h window in memory.
  await ensureKennelEventCache(kennelId, ctx);
  const pool = ctx.eventBatch.fuzzyPoolByKennel.get(kennelId) ?? [];
  const candidates = pool.filter((c) => {
    if (!(c.date instanceof Date)) return true; // tolerate test mocks without date
    const t = c.date.getTime();
    return t >= windowStart && t <= windowEnd && t !== eventTime;
  });
  if (candidates.length === 0) return null;

  // Batch-query: which of these candidates already have a RawEvent from our
  // source? Those are same-source events (e.g. back-to-back weekend trails)
  // and must NOT be fuzzy-merge targets — would silently collapse two
  // legitimate adjacent-day trails into one. Kept per-event for now since
  // the candidate set is already small (#1287 deferred this batching).
  const sameSourceLinks = await prisma.rawEvent.findMany({
    where: { eventId: { in: candidates.map(c => c.id) }, sourceId: ctx.sourceId },
    select: { eventId: true },
  });
  const sameSourceEventIds = new Set(
    sameSourceLinks.map(r => r.eventId).filter((id): id is string => id != null),
  );

  for (const c of candidates) {
    if (sameSourceEventIds.has(c.id)) continue;

    const candTitle = normalizeTitleForFuzzy(c.title);
    if (!candTitle) continue;
    if (levenshtein(incomingTitle, candTitle) > FUZZY_TITLE_DISTANCE) continue;

    if (event.runNumber != null && c.runNumber != null && event.runNumber !== c.runNumber) continue;

    if (event.startTime && c.startTime && timeDiffMinutes(event.startTime, c.startTime) > FUZZY_TIME_TOLERANCE_MIN) continue;

    if (event.location && c.locationName
        && levenshtein(event.location.toLowerCase(), c.locationName.toLowerCase()) > FUZZY_LOCATION_DISTANCE) continue;

    return c;
  }
  return null;
}

/**
 * Create or update the canonical Event record and link the RawEvent to it.
 * Returns the canonical event ID.
 */
async function upsertCanonicalEvent(
  event: RawEventData,
  kennelId: string,
  rawEventId: string,
  ctx: MergeContext,
): Promise<string> {
  const eventDate = parseUtcNoonDate(event.date);

  // Read sameDayEvents from the per-batch per-kennel cache instead of issuing
  // a per-event `event.findMany` (#1287). The pool is sorted by createdAt asc
  // / id asc to preserve the matcher's stable-tiebreak rule on ties.
  // `getSameDayEvents` returns a fresh array; local mutations (cross-window
  // splice and post-create push) don't leak back into the cache.
  await ensureKennelEventCache(kennelId, ctx);
  const sameDayEvents = getSameDayEvents(kennelId, eventDate, ctx);

  // Match strategy:
  // 1. Zero existing → create new
  // 2. Exactly one → match unless already matched in this batch (double-header)
  // 3. Multiple → disambiguate by sourceUrl, runNumber, startTime, title
  // 4. No disambiguation match → create new
  //
  // runNumber sits between sourceUrl and startTime for URL-less iCal feeds,
  // aligning with eventSignature's (runNumber, sourceUrl) keying so matcher
  // and selector converge on the same row.
  //
  // Per-batch tracking distinguishes double-headers from cross-source merges:
  // - Same source, second event for kennel+date → already matched → create new
  // - Different source, same event → first match → update + EventLink
  const batchKey = `${kennelId}:${eventDate.toISOString()}`;
  let existingEvent: (typeof sameDayEvents)[number] | null = null;
  if (sameDayEvents.length === 1) {
    const sole = sameDayEvents[0];
    const alreadyMatchedInBatch = ctx.batchMatchedEvents.get(batchKey)?.has(sole.id) ?? false;
    if (alreadyMatchedInBatch) {
      // Same-batch duplicate: treat as update (not double-header) when the incoming
      // event shares a startTime or runNumber with the existing one — this catches
      // overlapping past/future table entries from adapters like hashnyc.com.
      const looksLikeSameEvent =
        (event.startTime != null && sole.startTime === event.startTime) ||
        (event.runNumber != null && sole.runNumber === event.runNumber);
      existingEvent = looksLikeSameEvent ? sole : null;
    } else {
      existingEvent = sole; // Cross-source or first match — backward-compatible
    }
  } else if (sameDayEvents.length > 1) {
    if (event.sourceUrl) {
      existingEvent = sameDayEvents.find(e => e.sourceUrl === event.sourceUrl) ?? null;
    }
    if (!existingEvent && event.runNumber != null) {
      // Only match when runNumber resolves to exactly one row. Ambiguous
      // groups (same run # at distinct URLs) are genuine multi-part events
      // that the selector keeps split via (runNumber, sourceUrl) keying.
      const runMatches = sameDayEvents.filter(e => e.runNumber === event.runNumber);
      if (runMatches.length === 1) existingEvent = runMatches[0];
    }
    if (!existingEvent && event.startTime) {
      existingEvent = sameDayEvents.find(e => e.startTime === event.startTime) ?? null;
    }
    if (!existingEvent && event.title) {
      existingEvent = sameDayEvents.find(e => e.title === event.title) ?? null;
    }
  }

  // ±48h fuzzy cross-source dedup (#990) — only when nothing matched same-day,
  // the feature flag is on, and the incoming event isn't part of a series.
  // Splices the matched row into sameDayEvents so recomputeCanonical operates
  // on the matched row's bucket. The matched row's ORIGINAL date is captured
  // here so we can recanonicalize that abandoned bucket after the update
  // physically moves the row to the incoming source's date.
  let crossWindowMatch = false;
  let crossWindowOldDate: Date | null = null;
  if (
    !existingEvent
    && sameDayEvents.length === 0
    && process.env.MERGE_FUZZY_DEDUP === "true"
    && !event.seriesId
  ) {
    const fuzzy = await findFuzzyDuplicateInWindow(event, kennelId, eventDate, ctx);
    if (fuzzy) {
      existingEvent = fuzzy;
      sameDayEvents.push(fuzzy);
      crossWindowMatch = true;
      crossWindowOldDate = fuzzy.date;
    }
  }

  const kennelData = await resolveKennelData(kennelId, ctx);
  const region = kennelData.region;

  const timezone = regionTimezone(region);
  const composedUtc = composeUtcStart(eventDate, event.startTime, timezone);
  // Default to noon if no start time is provided, or composition fails
  const dateUtc = composedUtc ?? eventDate;

  let targetEventId: string;

  if (existingEvent) {
    targetEventId = existingEvent.id;

    // Auto-restore: if any source actively returns this event, it's not stale.
    // Admin-locked events are exempt — an admin explicitly cancelled the event
    // and the lock survives any source re-emission.
    const shouldRestore =
      existingEvent.status === "CANCELLED" && !isAdminLocked(existingEvent);
    if (shouldRestore && ctx.trustLevel < existingEvent.trustLevel) {
      // Lower-trust source can't update fields, but can still restore status
      await prisma.event.update({
        where: { id: existingEvent.id },
        data: { status: "CONFIRMED" },
      });
      // Mirror DB into the in-memory row so recomputeCanonical's status-aware
      // pool sees the live state (existingEvent aliases a sameDayEvents entry).
      existingEvent.status = "CONFIRMED";
    }

    // Update only if our source trust level >= existing; lower-trust
    // sources get the null-field enrichment path in the else branch.
    if (ctx.trustLevel >= existingEvent.trustLevel) {
      const coords = await resolveCoords(event, {
        latitude: existingEvent.latitude,
        longitude: existingEvent.longitude,
        locationAddress: existingEvent.locationAddress,
      }, ctx.shortUrlCache, kennelData, resolveRegionBias(event, kennelData.country));

      const locName = coords.normalizedLocation ?? sanitizeLocation(event.location);

      // Reverse-geocode city when we have new coords and locationCity isn't already set.
      // Canonical-location sources (HARRIER_CENTRAL) skip the reverse-geocode entirely on
      // CREATE — but on UPDATE we leave locationCity alone, never clearing it. If a non-HC
      // source previously populated city for this canonical event (cross-source merge),
      // we must not wipe it. The CREATE branch handles fresh HC-only events correctly.
      let locationCity: string | null | undefined;
      if (shouldSkipReverseGeocode(ctx.sourceType)) {
        // No-op: preserve existingEvent.locationCity
      } else if (coords.latitude != null && coords.longitude != null) {
        const coordsChanged =
          coords.latitude !== existingEvent.latitude || coords.longitude !== existingEvent.longitude;
        if (coordsChanged || !existingEvent.locationCity) {
          const rawCity = await reverseGeocode(coords.latitude, coords.longitude);
          locationCity = suppressRedundantCity(locName, rawCity);
        }
      } else if (
        (event.locationUrl !== undefined && (event.locationUrl ?? null) !== (existingEvent.locationAddress ?? null)) ||
        event.dropCachedCoords
      ) {
        // Coords cleared (either via locationUrl change or adapter dropCachedCoords
        // signal — #957) — also clear city so we don't display a stale Tokyo
        // "Chiyoda" against a now-uncoordinated event.
        locationCity = null;
      }

      const updated = await prisma.event.update({
        where: { id: existingEvent.id },
        data: {
          ...(shouldRestore ? { status: "CONFIRMED" as const } : {}),
          // Tri-state: undefined = preserve existing, null = explicit clear
          // (e.g. HC eventNumber=0 socials), number = overwrite (#892).
          ...(event.runNumber !== undefined
            ? { runNumber: event.runNumber }
            : {}),
          title: (() => {
            const nextTitle = sanitizeTitle(event.title) ?? existingEvent.title;
            return nextTitle ? rewriteStaleDefaultTitle(nextTitle, kennelData.kennelCode, kennelData.shortName, kennelData.fullName, kennelData.aliases) : nextTitle;
          })(),
          // Preserve existing fields when source doesn't provide them (undefined)
          ...(event.description !== undefined
            ? { description: event.description ?? null }
            : {}),
          ...(event.hares !== undefined
            ? { haresText: sanitizeHares(event.hares) }
            : {}),
          ...(event.location !== undefined
            ? {
                locationName: locName,
                // Clear stale street when location changes but no street provided
                locationStreet: event.locationStreet ?? null,
              }
            : {}),
          ...(event.locationUrl !== undefined
            ? { locationAddress: sanitizeLocationUrl(event.locationUrl) }
            : {}),
          ...(event.startTime !== undefined
            ? { startTime: event.startTime ?? null }
            : {}),
          ...(event.endTime !== undefined
            ? { endTime: event.endTime ?? null }
            : {}),
          ...(event.cost !== undefined
            ? { cost: event.cost ?? null }
            : {}),
          ...(event.trailLengthText === undefined
            ? {}
            : { trailLengthText: event.trailLengthText ?? null }),
          ...(event.trailLengthMinMiles === undefined
            ? {}
            : { trailLengthMinMiles: event.trailLengthMinMiles ?? null }),
          ...(event.trailLengthMaxMiles === undefined
            ? {}
            : { trailLengthMaxMiles: event.trailLengthMaxMiles ?? null }),
          ...(event.difficulty === undefined
            ? {}
            : { difficulty: event.difficulty ?? null }),
          ...(event.trailType === undefined
            ? {}
            : { trailType: event.trailType ?? null }),
          ...(event.dogFriendly === undefined
            ? {}
            : { dogFriendly: event.dogFriendly ?? null }),
          ...(event.prelube === undefined
            ? {}
            : { prelube: event.prelube ?? null }),
          // Cross-window fuzzy match (#990) physically moves the row from
          // its old `date` bucket to the incoming source's date, so display
          // paths that compose `date + startTime + timezone` render the
          // correct day. Old bucket is recanonicalized below the
          // recomputeCanonical for the new bucket. Same-day matches: `date`
          // unchanged, dateUtc/timezone refresh as before.
          ...(crossWindowMatch ? { date: eventDate } : {}),
          dateUtc,
          timezone,
          // Preserve first source's URL; subsequent sources get EventLinks
          sourceUrl: existingEvent.sourceUrl ?? event.sourceUrl,
          trustLevel: ctx.trustLevel,
          // Write coords if resolved; clear if locationAddress changed and no new coords
          // (prevents stale pins when an event moves to an unparseable location URL),
          // or when the adapter signalled the cached coords are stale and the
          // re-geocode came up empty (HC fallback-pin recovery — #957).
          ...(coords.latitude != null && coords.longitude != null
            ? { latitude: coords.latitude, longitude: coords.longitude }
            : (event.locationUrl !== undefined && (event.locationUrl ?? null) !== (existingEvent.locationAddress ?? null)) ||
                event.dropCachedCoords
              ? { latitude: null, longitude: null }
              : {}),
          // Reverse-geocoded city (only set when computed above)
          ...(locationCity !== undefined ? { locationCity } : {}),
        },
      });
      // Splice the fresh row into sameDayEvents so recomputeCanonical scores
      // post-update completeness, not pre-update (real regression path:
      // equal-trust sibling was winning on stale numbers before the update
      // added fields that would flip the pick).
      const idx = sameDayEvents.findIndex(e => e.id === existingEvent.id);
      if (idx !== -1) sameDayEvents[idx] = updated;

      if (crossWindowMatch) {
        // Cross-window UPDATE moved `date` in DB, shifting the row's bucket
        // in the cache. Invalidate so the next event refetches; surgical
        // patching of a moved-date row is bug-prone.
        invalidateKennelEventCache(kennelId, ctx);
      } else {
        // Non-cross-window UPDATE: the row's `date` is unchanged but other
        // fields the matcher reads (runNumber, startTime, sourceUrl,
        // trustLevel, title, etc.) may have moved. Patch the shared caches
        // in place so a later event in the same batch matching against
        // this canonical row sees post-update values, not stale ones —
        // skipping this leaks the same "stale match → spurious create"
        // regression a fresh DB findMany would have avoided pre-#1287.
        const sharedPool = ctx.eventBatch.sameDayByKennel.get(kennelId);
        if (sharedPool) {
          const si = sharedPool.findIndex(e => e.id === updated.id);
          if (si !== -1) sharedPool[si] = updated;
        }
        if (updated.parentEventId == null && !updated.isSeriesParent) {
          const fuzzyPool = ctx.eventBatch.fuzzyPoolByKennel.get(kennelId);
          if (fuzzyPool) {
            const fi = fuzzyPool.findIndex(e => e.id === updated.id);
            if (fi !== -1) fuzzyPool[fi] = updated;
          }
        }
      }
    }

    // Lower-trust enrichment: fill NULL fields without overwriting non-null
    // data set by the higher-trust primary source. Sanitizers that return
    // null (e.g. placeholder "TBD" values) are excluded from the payload so
    // we don't write null over null and trigger a redundant DB round-trip.
    // dateUtc is intentionally NOT updated here — it stays at noon UTC by
    // design (CLAUDE.md Appendix F.4); startTime is a display-only string.
    else {
      const enrichData: Record<string, unknown> = {};
      if (!existingEvent.description && event.description) {
        enrichData.description = event.description;
      }
      if (!existingEvent.haresText && event.hares) {
        const sanitized = sanitizeHares(event.hares);
        if (sanitized) enrichData.haresText = sanitized;
      }
      if (!existingEvent.locationName && event.location) {
        const sanitized = sanitizeLocation(event.location);
        if (sanitized) enrichData.locationName = sanitized;
      }
      if (!existingEvent.startTime && event.startTime) {
        enrichData.startTime = event.startTime;
      }
      // #890 — fill the trail-length bundle when the canonical event has
      // it unset, so a higher-trust primary that lacks these fields
      // doesn't drop a lower-trust source's parsed values on the floor.
      // The bundle is treated atomically: if the source provided text but
      // not numerics (or vice versa), we still backfill what we have so
      // partial data lands rather than nothing.
      if (existingEvent.trailLengthText == null && event.trailLengthText) {
        enrichData.trailLengthText = event.trailLengthText;
      }
      if (existingEvent.trailLengthMinMiles == null && event.trailLengthMinMiles != null) {
        enrichData.trailLengthMinMiles = event.trailLengthMinMiles;
      }
      if (existingEvent.trailLengthMaxMiles == null && event.trailLengthMaxMiles != null) {
        enrichData.trailLengthMaxMiles = event.trailLengthMaxMiles;
      }
      if (existingEvent.difficulty == null && event.difficulty != null) {
        enrichData.difficulty = event.difficulty;
      }
      if (existingEvent.trailType == null && event.trailType != null) {
        enrichData.trailType = event.trailType;
      }
      if (existingEvent.dogFriendly == null && event.dogFriendly != null) {
        enrichData.dogFriendly = event.dogFriendly;
      }
      if (existingEvent.prelube == null && event.prelube != null) {
        enrichData.prelube = event.prelube;
      }
      if (Object.keys(enrichData).length > 0) {
        const enriched = await prisma.event.update({
          where: { id: existingEvent.id },
          data: enrichData,
        });
        const idx = sameDayEvents.findIndex(e => e.id === existingEvent.id);
        if (idx !== -1) sameDayEvents[idx] = enriched;
      }
    }

    // If this source provides a different sourceUrl, create an EventLink for it
    if (event.sourceUrl && existingEvent.sourceUrl && event.sourceUrl !== existingEvent.sourceUrl) {
      await prisma.eventLink.upsert({
        where: { eventId_url: { eventId: existingEvent.id, url: event.sourceUrl } },
        create: { eventId: existingEvent.id, url: event.sourceUrl, label: getLabelForUrl(event.sourceUrl), sourceId: ctx.sourceId },
        update: {},
      });
    }

    // Link RawEvent to existing Event
    await prisma.rawEvent.update({
      where: { id: rawEventId },
      data: { processed: true, eventId: existingEvent.id },
    });

    ctx.result.updated++;
    if (shouldRestore) ctx.result.restored++;
  } else {
    // Create new canonical Event
    const coords = await resolveCoords(event, undefined, ctx.shortUrlCache, kennelData, resolveRegionBias(event, kennelData.country));
    // Reverse-geocode city when coords are available (suppress when address already has state).
    // Canonical-location sources skip this entirely — see shouldSkipReverseGeocode.
    const locName = coords.normalizedLocation ?? sanitizeLocation(event.location);
    let locationCity: string | null = null;
    if (!shouldSkipReverseGeocode(ctx.sourceType) && coords.latitude != null && coords.longitude != null) {
      locationCity = suppressRedundantCity(locName, await reverseGeocode(coords.latitude, coords.longitude));
    }
    // Dual-write Event + primary EventKennel atomically (#1023 step 2).
    // Uses Prisma's nested create — one round-trip, one implicit tx.
    const newEvent = await createEventWithKennel(prisma, {
      kennelId,
      date: eventDate,
      dateUtc,
      timezone,
      runNumber: event.runNumber,
      title: sanitizeTitle(event.title),
      description: event.description,
      haresText: sanitizeHares(event.hares),
      locationName: locName,
      locationStreet: event.locationStreet ?? null,
      locationAddress: sanitizeLocationUrl(event.locationUrl),
      startTime: event.startTime,
      endTime: event.endTime,
      cost: event.cost,
      trailLengthText: event.trailLengthText,
      trailLengthMinMiles: event.trailLengthMinMiles,
      trailLengthMaxMiles: event.trailLengthMaxMiles,
      difficulty: event.difficulty,
      trailType: event.trailType,
      dogFriendly: event.dogFriendly,
      prelube: event.prelube,
      sourceUrl: event.sourceUrl,
      trustLevel: ctx.trustLevel,
      latitude: coords.latitude,
      longitude: coords.longitude,
      locationCity,
    });

    targetEventId = newEvent.id;
    sameDayEvents.push(newEvent); // keep finalCandidates consistent for recomputeCanonical
    // Mirror the new row into the per-batch caches so subsequent events for
    // the same kennel see it (#1287 — replaces the per-event findMany).
    rememberCreatedEvent(kennelId, newEvent, ctx);

    // Link RawEvent to new Event
    await prisma.rawEvent.update({
      where: { id: rawEventId },
      data: { processed: true, eventId: newEvent.id },
    });

    ctx.result.created++;
    ctx.result.createdEventIds.push(newEvent.id);
  }

  // #1023 step 3: write co-host EventKennel rows for any additional kennel
  // tags beyond the primary. No-op for single-tag events (every adapter
  // currently emits a 1-element array; multi-tag emission opts in via
  // step 4's `matchConfigPatterns` arrayification). Upsert is safe across
  // re-scrapes; we never delete co-host rows so a tag dropping from a
  // future scrape doesn't reverse a real co-host relationship.
  //
  // The `update: {}` no-op is intentional: if a kennel was previously the
  // primary on this event (isPrimary=true), a fresh scrape that lists it
  // as a co-host should NOT demote it. Demotion only happens via the admin
  // kennel-merge path in `app/admin/kennels/actions.ts`.
  if (event.kennelTags.length > 1) {
    const secondaryTags = [...new Set(event.kennelTags.slice(1))];
    const resolved = await resolveKennelTags(secondaryTags, ctx.sourceId);
    const coHostIds = new Set<string>();
    for (const r of resolved) {
      if (!r.matched || !r.kennelId || r.kennelId === kennelId) continue;
      coHostIds.add(r.kennelId);
    }
    await Promise.all(
      [...coHostIds].map((coHostId) =>
        prisma.eventKennel.upsert({
          where: { eventId_kennelId: { eventId: targetEventId, kennelId: coHostId } },
          create: { eventId: targetEventId, kennelId: coHostId, isPrimary: false },
          update: {},
        }),
      ),
    );
  }

  // Record this match in the per-batch tracker
  const matched = ctx.batchMatchedEvents.get(batchKey) ?? new Set<string>();
  matched.add(targetEventId);
  ctx.batchMatchedEvents.set(batchKey, matched);

  // Reconcile isCanonical across rows we already have in hand for this
  // (kennelId, date) slot. sameDayEvents was fetched at the top with all
  // fields; the CREATE branch pushes the just-inserted row. Update-path
  // field values may be slightly stale but trustLevel + createdAt (the
  // dominant sort keys) are immutable.
  await recomputeCanonical(sameDayEvents);

  // Cross-window match (#990) physically moved the row out of its original
  // bucket. If that bucket had siblings, the previous canonical pick is now
  // stale (the moved row may have been the canonical winner). Refetch the
  // abandoned bucket and recanonicalize. recomputeCanonical also promotes
  // any single non-canonical leftover row so it stays visible.
  if (crossWindowMatch && crossWindowOldDate && ctx.trustLevel >= (existingEvent?.trustLevel ?? 0)) {
    // Deterministic orderBy mirrors the same-day `findMany` at the top of
    // upsertCanonicalEvent — keeps `pickCanonicalEventIds`' input-order
    // tiebreaker stable across retries / parallel scrapes.
    const oldBucket = await prisma.event.findMany({
      where: { kennelId, date: crossWindowOldDate },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: EVENT_CACHE_SELECT,
    });
    await recomputeCanonical(oldBucket as never);
  }

  return targetEventId;
}

/**
 * Link multi-day series via parentEventId.
 * The earliest event in each series becomes the parent.
 */
async function linkMultiDaySeries(
  seriesGroups: Map<string, string[]>,
): Promise<void> {
  for (const [, eventIds] of seriesGroups) {
    if (eventIds.length < 2) continue;
    try {
      // Sort by date to pick the earliest as parent
      const seriesEvents = await prisma.event.findMany({
        where: { id: { in: eventIds } },
        orderBy: { date: "asc" },
        select: { id: true },
      });
      const parentId = seriesEvents[0].id;
      await prisma.event.update({
        where: { id: parentId },
        data: { isSeriesParent: true },
      });
      for (const child of seriesEvents.slice(1)) {
        await prisma.event.update({
          where: { id: child.id },
          data: { parentEventId: parentId },
        });
      }
    } catch (err) {
      console.error(`Series linking error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Process a single new raw event: create RawEvent, resolve kennel, upsert canonical Event,
 * create EventLinks. Returns the canonical event ID or null if unresolvable.
 */
async function processNewRawEvent(
  event: RawEventData,
  fingerprint: string,
  sourceId: string,
  ctx: MergeContext,
): Promise<string | null> {
  // Decode HTML entities in text fields before any downstream processing
  sanitizeRawFields(event);

  // Validate the event has at least one meaningful display field before processing.
  // kennelTag counts because we'll generate a default title from it after kennel resolution.
  const hasDisplayData = event.title || event.location || event.hares || event.runNumber || event.kennelTags[0];
  if (!hasDisplayData) {
    ctx.result.eventErrors++;
    if (ctx.result.eventErrorMessages.length < 50) {
      ctx.result.eventErrorMessages.push(
        `${event.date}/${event.kennelTags[0]}: Skipping empty event (no title, location, hares, or run number)`,
      );
    }
    return null;
  }

  // Race-window guard for #1286: concurrent QStash workers can both miss
  // the per-batch dedup prefetch; the @@unique constraint makes the loser
  // raise P2002 and we route via the duplicate-fingerprint path.
  let rawEvent: { id: string };
  try {
    rawEvent = await prisma.rawEvent.create({
      data: {
        sourceId,
        rawData: event as unknown as Prisma.InputJsonValue,
        fingerprint,
        processed: false,
      },
    });
  } catch (err) {
    if (!isUniqueConstraintViolation(err, ["sourceId", "fingerprint"])) throw err;

    const winner = await prisma.rawEvent.findUnique({
      where: { sourceId_fingerprint: { sourceId, fingerprint } },
      select: RAW_EVENT_DEDUP_SELECT,
    });
    if (!winner) throw err;

    ctx.existingByFingerprint.set(fingerprint, winner);
    const dupId = await handleDuplicateFingerprint(event, fingerprint, ctx);
    if (dupId === false) {
      // Orphan-reprocess signal: the racing worker's row is unprocessed
      // and unlinked. Pre-#1286 the caller would have created its own
      // RawEvent and a fresh canonical Event (leaving the orphan as a
      // tombstone); the unique constraint blocks that, so we ADOPT the
      // orphan instead — fall through with `rawEvent = winner` and run
      // the rest of `processNewRawEvent` against winner.id. Without this,
      // a worker that crashed mid-processing would leave a permanently-
      // dropped event for that fingerprint.
      rawEvent = winner;
    } else {
      if (!dupId) return null;
      await createEventLinks(dupId, sourceId, event.externalLinks);
      return dupId;
    }
  }

  const kennelId = await resolveAndGuardKennel(event, ctx);
  if (!kennelId) return null;

  // Fix the event title using the kennel's display name (not the raw adapter tag).
  // Must happen AFTER kennel resolution so we have access to shortName/fullName.
  const kennelData = await resolveKennelData(kennelId, ctx);
  const sanitized = sanitizeTitle(event.title);
  if (!sanitized) {
    const displayName = friendlyKennelName(kennelData.shortName, kennelData.fullName) || event.kennelTags[0];
    event.title = event.runNumber
      ? `${displayName} Trail #${event.runNumber}`
      : `${displayName} Trail`;
  } else {
    event.title = rewriteStaleDefaultTitle(sanitized, kennelData.kennelCode, kennelData.shortName, kennelData.fullName, kennelData.aliases);
  }

  const targetEventId = await upsertCanonicalEvent(event, kennelId, rawEvent.id, ctx);
  // Mirror DB state into the dedup map *immediately* after upsertCanonicalEvent
  // marks the RawEvent processed. If a later side-effect (createEventLinks, the
  // kennel cache update) throws, the per-event try/catch records the error but
  // the row is already `processed: true` in the DB — keeping map ↔ DB aligned
  // means a later in-batch duplicate still takes the existing-Event branch
  // instead of being re-processed as new.
  ctx.existingByFingerprint.set(fingerprint, {
    id: rawEvent.id,
    fingerprint,
    processed: true,
    eventId: targetEventId,
  });

  await createEventLinks(targetEventId, sourceId, event.externalLinks);

  // Track the max event date per kennel — flushed as one batched
  // `kennel.updateMany` per kennel after the loop in `processRawEvents`
  // (#1287 — replaces the per-event `$executeRaw UPDATE "Kennel"`).
  const eventDateForCache = parseUtcNoonDate(event.date);
  const previousMax = ctx.eventBatch.kennelMaxDates.get(kennelId);
  if (!previousMax || previousMax.getTime() < eventDateForCache.getTime()) {
    ctx.eventBatch.kennelMaxDates.set(kennelId, eventDateForCache);
  }

  return targetEventId;
}

/**
 * Fields that carry user-facing value on an Event row. Counted to pick a
 * canonical row when two sources disagree on a (kennelId, date) — the row
 * with more populated display fields wins tiebreakers on trustLevel ties.
 */
type CanonicalCandidate = {
  id: string;
  trustLevel: number;
  createdAt: Date;
  status: EventStatus;
  title: string | null;
  haresText: string | null;
  locationName: string | null;
  locationStreet: string | null;
  locationCity: string | null;
  locationAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  startTime: string | null;
  endTime: string | null;
  cost: string | null;
  sourceUrl: string | null;
  runNumber: number | null;
  description: string | null;
  trailType: string | null;
  dogFriendly: boolean | null;
  prelube: string | null;
};

export function completenessScore(e: Omit<CanonicalCandidate, "id" | "trustLevel" | "createdAt" | "status">): number {
  let score = 0;
  if (e.title) score++;
  if (e.haresText) score++;
  if (e.locationName) score++;
  if (e.locationStreet) score++;
  if (e.locationCity) score++;
  if (e.locationAddress) score++;
  // Coords count as one unit — half a pair is useless for display.
  if (e.latitude != null && e.longitude != null) score++;
  if (e.startTime) score++;
  if (e.endTime) score++;
  if (e.cost) score++;
  if (e.sourceUrl) score++;
  if (e.runNumber != null) score++;
  if (e.description) score++;
  // #1316 — structured hareline fields count for canonical tiebreaks so an
  // equally-trusted sibling that lacks them can't keep the richer row from
  // becoming canonical (Codex review on PR #1366).
  if (e.trailType) score++;
  if (e.dogFriendly != null) score++;
  if (e.prelube) score++;
  return score;
}

/**
 * Signature for grouping dupes within a (kennelId, date) slot. Shared
 * signature → collapse; distinct → genuine double-header.
 *
 * With runNumber: key on (runNumber, sourceUrl) so same-URL races collapse
 * (#826) and multi-part events at distinct URLs stay split. Without:
 * fall back to (time, url, title). The `run#` prefix prevents collisions.
 */
function eventSignature(e: CanonicalCandidate): string {
  const url = e.sourceUrl?.trim() || "";
  if (e.runNumber != null) return `run#${e.runNumber}::${url}`;
  const time = e.startTime?.trim() || "";
  const title = e.title?.trim() || "";
  return `${time}::${url}::${title}`;
}

/**
 * Collapse signature groups that share a runNumber when one group is
 * URL-bearing and the other is URL-less, provided startTimes don't conflict.
 *
 * Covers the cross-source race path (#866): one source emits
 * `(runNumber, no URL)` and another emits `(runNumber, URL)`. They produce
 * distinct signatures (`run#N::` vs `run#N::<url>`) but are the same event.
 *
 * Preserves multi-part events: two URL-bearing groups with the same
 * runNumber at distinct URLs (AVLH3 #786 Part B/C) stay split because
 * neither is URL-less.
 *
 * Ambiguous cases — a URL-less group with two or more compatible URL-bearing
 * peers — are left alone. Collapsing would incorrectly merge genuine
 * multi-part events; reproducing #866 for that rare topology is safer.
 *
 * Compatibility is computed over every row in each group, not just the first:
 * `eventSignature` ignores startTime when runNumber is set, so one URL-less
 * group can contain rows with differing times. Collapse only when the two
 * groups' non-blank startTime sets are either empty or equal.
 */
function collapseRunNumberRaces(groups: CanonicalCandidate[][]): CanonicalCandidate[][] {
  const nonBlankTimes = (group: CanonicalCandidate[]): Set<string> => {
    const set = new Set<string>();
    for (const row of group) {
      const t = row.startTime?.trim();
      if (t) set.add(t);
    }
    return set;
  };
  const timesCompatible = (a: Set<string>, b: Set<string>): boolean => {
    // A blank peer (size 0) can't disambiguate an internally time-conflicted
    // group — if `a` has {09:00, 18:00} and `b` is all-null, collapsing
    // would silently fold two distinct events into one. Only allow the
    // empty-side shortcut when the other side has at most one concrete time.
    if (a.size === 0) return b.size <= 1;
    if (b.size === 0) return a.size <= 1;
    if (a.size !== b.size) return false;
    for (const t of a) if (!b.has(t)) return false;
    return true;
  };
  const isUrlLess = (group: CanonicalCandidate[]): boolean =>
    // Signature buckets by trimmed URL, so every row in a group shares the
    // same URL presence — `[0]` is a safe proxy for the whole group here.
    (group[0].sourceUrl?.trim() || "") === "";

  const absorbed = new Set<number>();
  for (let i = 0; i < groups.length; i++) {
    if (absorbed.has(i)) continue;
    const urlLess = groups[i];
    const rep = urlLess[0];
    if (rep.runNumber == null) continue;
    if (!isUrlLess(urlLess)) continue;
    const urlLessTimes = nonBlankTimes(urlLess);
    const peers: number[] = [];
    for (let j = 0; j < groups.length; j++) {
      if (j === i || absorbed.has(j)) continue;
      const peer = groups[j];
      if (peer[0].runNumber !== rep.runNumber) continue;
      if (isUrlLess(peer)) continue;
      if (!timesCompatible(urlLessTimes, nonBlankTimes(peer))) continue;
      peers.push(j);
    }
    if (peers.length === 1) {
      // Replace the peer with a new concatenated array so we don't mutate
      // the bucket still referenced by the outer signature map — easier to
      // reason about even though nothing downstream reads it.
      groups[peers[0]] = [...groups[peers[0]], ...urlLess];
      absorbed.add(i);
    }
  }
  // Footgun: `pickCanonicalEventIds` picks the winner by trustLevel then
  // completeness. If a URL-less source has strictly higher trustLevel than
  // the URL-bearing peer it gets absorbed into, the URL-less row wins
  // canonical and `Event.sourceUrl` will be null despite a URL-bearing
  // sibling existing in the group. No source combination produces this
  // today (URL-bearing sources are trusted ≥ URL-less), but watch for it
  // if trust levels are rebalanced.
  return groups.filter((_, i) => !absorbed.has(i));
}

/**
 * Pick canonical row id(s) across a (kennelId, date) group. Rows group by
 * signature; distinct signatures each keep a canonical. Within a group:
 *   1. Prefer non-CANCELLED rows — every display path filters
 *      `status != CANCELLED AND isCanonical = true`, so a cancelled winner
 *      would hide the live sibling. Fall through to cancelled only when
 *      the whole group is cancelled (keeps pointer stable for un-cancel).
 *   2. Order: trustLevel DESC, completeness DESC, createdAt ASC.
 * Pure function — no DB access.
 */
export function pickCanonicalEventIds(events: CanonicalCandidate[]): Set<string> {
  const canonical = new Set<string>();
  if (events.length === 0) return canonical;

  const bySignature = new Map<string, CanonicalCandidate[]>();
  for (const e of events) {
    const sig = eventSignature(e);
    const group = bySignature.get(sig) ?? [];
    group.push(e);
    bySignature.set(sig, group);
  }

  const mergedGroups = collapseRunNumberRaces(Array.from(bySignature.values()));

  for (const group of mergedGroups) {
    // Prefer live rows; if the whole group is cancelled, keep them all eligible
    // so reconcile has a stable canonical pointer to un-cancel later.
    const live = group.filter(e => e.status !== "CANCELLED");
    const pool = live.length > 0 ? live : group;
    let best = pool[0];
    let bestScore = completenessScore(best);
    for (const e of pool.slice(1)) {
      const score = completenessScore(e);
      if (
        e.trustLevel > best.trustLevel ||
        (e.trustLevel === best.trustLevel && score > bestScore) ||
        (e.trustLevel === best.trustLevel && score === bestScore &&
          e.createdAt.getTime() < best.createdAt.getTime())
      ) {
        best = e;
        bestScore = score;
      }
    }
    canonical.add(best.id);
  }
  return canonical;
}

/**
 * Single-winner variant for callers that only handle one signature group
 * (tests exercising dup-drift scenarios). Returns null on empty input,
 * the one id for a single-row slot, and the first canonical id from the
 * selector for multi-row groups sharing a signature.
 */
export function pickCanonicalEventId(events: CanonicalCandidate[]): string | null {
  if (events.length === 0) return null;
  const canonicalIds = pickCanonicalEventIds(events);
  return canonicalIds.values().next().value ?? null;
}

interface CandidateWithCanonicalState extends CanonicalCandidate {
  isCanonical: boolean;
}

/**
 * Reconcile `isCanonical` across a set of rows for one (kennelId, date).
 * Caller provides the full set of rows. Single-row slots: promote the row
 * if it's currently non-canonical (the cross-window dedup at #990 can move
 * a previously non-canonical row into an empty bucket, or leave a previously
 * non-canonical sibling alone in its old bucket). Otherwise the early-out
 * matters on chronic-dup kennels where a ~1000-event scrape would otherwise
 * fire a transaction per incoming event.
 */
async function recomputeCanonical(
  candidates: CandidateWithCanonicalState[],
): Promise<void> {
  if (candidates.length === 0) return;
  if (candidates.length === 1) {
    const sole = candidates[0];
    if (!sole.isCanonical) {
      await prisma.event.update({
        where: { id: sole.id },
        data: { isCanonical: true },
      });
    }
    return;
  }

  const canonicalIds = pickCanonicalEventIds(candidates);
  if (canonicalIds.size === 0) return;

  // Only touch rows whose flag needs to flip — skip writes that would be
  // no-ops (row is already canonical or already non-canonical as intended).
  const toPromote = candidates
    .filter(e => canonicalIds.has(e.id) && !e.isCanonical)
    .map(e => e.id);
  const toDemote = candidates
    .filter(e => !canonicalIds.has(e.id) && e.isCanonical)
    .map(e => e.id);
  if (toPromote.length === 0 && toDemote.length === 0) return;

  const ops = [];
  if (toPromote.length > 0) {
    ops.push(
      prisma.event.updateMany({
        where: { id: { in: toPromote } },
        data: { isCanonical: true },
      }),
    );
  }
  if (toDemote.length > 0) {
    ops.push(
      prisma.event.updateMany({
        where: { id: { in: toDemote } },
        data: { isCanonical: false },
      }),
    );
  }
  await prisma.$transaction(ops);
}

/** Record a merge error in the result context. */
function recordMergeError(
  event: RawEventData,
  err: unknown,
  result: MergeResult,
  precomputedFingerprint?: string,
): void {
  const reason = err instanceof Error ? err.message : String(err);
  const msg = `${event.date}/${event.kennelTags[0]}: ${reason}`;
  console.error(`Merge error: ${msg}`);
  result.eventErrors++;
  if (result.eventErrorMessages.length < 50) {
    result.eventErrorMessages.push(msg);
  }
  if (result.mergeErrorDetails && result.mergeErrorDetails.length < 50) {
    // Prefer the caller's fingerprint (the precompute always passes one,
    // including the `<fingerprint-error>` sentinel for events that failed
    // there). For loop-body errors with no precomputed value, regenerate —
    // and shield against the rare case where regenerate also throws.
    let fingerprint = precomputedFingerprint;
    if (fingerprint === undefined) {
      try {
        fingerprint = generateFingerprint(event);
      } catch {
        fingerprint = "<fingerprint-error>";
      }
    }
    result.mergeErrorDetails.push({ fingerprint, reason });
  }
}

/**
 * Process raw events from a scrape into RawEvent records and canonical Events.
 *
 * For each RawEventData:
 * 1. Generate fingerprint — skip if already exists
 * 2. Create immutable RawEvent record
 * 3. Resolve kennel tag — if unmatched, leave unprocessed
 * 4. Upsert canonical Event (kennel + date composite key)
 * 5. Create EventLinks from externalLinks + alternate sourceUrls
 *
 * After all events: link multi-day series via parentEventId
 */
export async function processRawEvents(
  sourceId: string,
  events: RawEventData[],
): Promise<MergeResult> {
  const result: MergeResult = {
    created: 0,
    createdEventIds: [],
    updated: 0,
    skipped: 0,
    unmatched: [],
    blocked: 0,
    blockedTags: [],
    restored: 0,
    eventErrors: 0,
    eventErrorMessages: [],
    mergeErrorDetails: [],
    sampleBlocked: [],
    sampleSkipped: [],
  };

  // Sync fingerprint precompute keyed by event identity. Runs first so the
  // prefetch query can join the parallel batch below; the loop body reuses
  // the same fingerprints without recomputing.
  const fingerprintByEvent = precomputeFingerprints(events, result);
  const uniqueFingerprints = [...new Set(fingerprintByEvent.values())];

  // Two independent reads — source metadata (with linked kennels via the FK
  // relation) and the dedup prefetch (Sentry JAVASCRIPT-NEXTJS-3) — fan out
  // together to save round-trips on every scrape. Collapsing the previous
  // separate `sourceKennel.findMany` into the same `findUnique` saves one
  // round-trip per scrape (issue #1288).
  const [source, prefetchedRawEvents] = await Promise.all([
    prisma.source.findUnique({
      where: { id: sourceId },
      select: {
        trustLevel: true,
        type: true,
        kennels: { select: { kennelId: true } },
      },
    }),
    prefetchExistingByFingerprint(sourceId, uniqueFingerprints),
  ]);
  const trustLevel = source?.trustLevel ?? 5;
  const sourceType: SourceType | null = source?.type ?? null;
  const linkedKennelIds = new Set((source?.kennels ?? []).map((sk) => sk.kennelId));

  clearResolverCache();

  const existingByFingerprint = new Map<string, ExistingRawEventEntry>(
    prefetchedRawEvents.map((r) => [r.fingerprint, r]),
  );

  const kennelCache = new Map<string, KennelCacheEntry>();
  const shortUrlCache = new Map<string, string | null>();
  const batchMatchedEvents = new Map<string, Set<string>>();

  // Union of UTC-noon dates across the batch — drives the per-kennel
  // prefetch in `ensureKennelEventCache` (#1287). Skip events whose
  // fingerprint precompute failed (their dates may be unparseable).
  const batchDates: Date[] = [];
  const seenDates = new Set<number>();
  for (const e of events) {
    if (!fingerprintByEvent.has(e)) continue;
    try {
      const d = parseUtcNoonDate(e.date);
      const t = d.getTime();
      if (!Number.isNaN(t) && !seenDates.has(t)) {
        seenDates.add(t);
        batchDates.push(d);
      }
    } catch {
      // ignore — recordMergeError handles per-event date errors below
    }
  }

  const ctx: MergeContext = {
    sourceId,
    trustLevel,
    sourceType,
    linkedKennelIds,
    kennelCache,
    shortUrlCache,
    batchMatchedEvents,
    existingByFingerprint,
    eventBatch: {
      dates: batchDates,
      sameDayByKennel: new Map(),
      fuzzyPoolByKennel: new Map(),
      kennelMaxDates: new Map(),
    },
    result,
  };

  const seriesGroups = new Map<string, string[]>();

  for (const event of events) {
    // Events that failed the fingerprint precompute were already recorded as
    // errors and are skipped here so the prefetch's empty-fingerprint case
    // doesn't re-classify them as new.
    const fingerprint = fingerprintByEvent.get(event);
    if (fingerprint === undefined) continue;
    try {
      const dupResult = await handleDuplicateFingerprint(event, fingerprint, ctx);
      if (dupResult !== false) {
        if (dupResult) await createEventLinks(dupResult, sourceId, event.externalLinks);
        continue;
      }

      const targetEventId = await processNewRawEvent(event, fingerprint, sourceId, ctx);

      if (targetEventId && event.seriesId) {
        const group = seriesGroups.get(event.seriesId) ?? [];
        group.push(targetEventId);
        seriesGroups.set(event.seriesId, group);
      }
    } catch (err) {
      recordMergeError(event, err, result, fingerprint);
    }
  }

  await linkMultiDaySeries(seriesGroups);

  // Flush per-kennel max event dates as a single batched write per kennel
  // (#1287 — replaces the per-event `$executeRaw UPDATE "Kennel"`). The
  // OR-NULL-or-LT guard in `where` preserves the "only update if newer"
  // semantic. `updatedAt` auto-updates via Prisma's @updatedAt.
  //
  // `allSettled` (not `all`) so a transient DB error on one kennel's cache
  // write doesn't reject the whole batch — pre-#1287 the equivalent
  // `$executeRaw` was inside the per-event try/catch and a single failure
  // was recorded as `eventErrors` while the batch still completed.
  // `lastEventDate` is a non-critical UI-cache field (used by the kennel
  // directory's "recently active" filter); a missed update self-heals on
  // the next scrape.
  if (ctx.eventBatch.kennelMaxDates.size > 0) {
    const entries = [...ctx.eventBatch.kennelMaxDates];
    const settled = await Promise.allSettled(
      entries.map(([kennelId, maxDate]) =>
        prisma.kennel.updateMany({
          where: {
            id: kennelId,
            OR: [{ lastEventDate: null }, { lastEventDate: { lt: maxDate } }],
          },
          data: { lastEventDate: maxDate },
        }),
      ),
    );
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i];
      if (outcome.status === "rejected") {
        const [kennelId] = entries[i];
        console.error(
          `[merge] lastEventDate flush failed for kennel ${kennelId}:`,
          outcome.reason,
        );
      }
    }
  }

  return result;
}
