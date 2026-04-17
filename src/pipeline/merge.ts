import { prisma } from "@/lib/db";
import type { Prisma, SourceType } from "@/generated/prisma/client";
import type { RawEventData, MergeResult } from "@/adapters/types";
import { parseUtcNoonDate } from "@/lib/date";
import { regionTimezone, getLabelForUrl, stripUrlsFromText } from "@/lib/format";
import { composeUtcStart } from "@/lib/timezone";
import { generateFingerprint } from "./fingerprint";
import { resolveKennelTag, clearResolverCache } from "./kennel-resolver";
import { extractCoordsFromMapsUrl, geocodeAddress, resolveShortMapsUrl, reverseGeocode, haversineDistance, parseDMSFromLocation, stripDMSFromLocation } from "@/lib/geo";
import { isPlaceholder, decodeEntities, HARE_BOILERPLATE_RE } from "@/adapters/utils";

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

  // Filter CTA/volunteer placeholders that aren't real hare names
  if (/^(?:sign[\s\u00A0]*up!?|volunteer)$/i.test(h)) return null;

  // Reject bare URLs (e.g., Google Maps links extracted as hare names)
  if (/^https?:\/\//i.test(h)) return null;

  // Reject single-character values (no real hash name is 1 char — likely a scraping artifact)
  if (h.length === 1) return null;

  // Strip "Hare is " / "Hare: " prefix (some calendars embed the label in the value)
  h = h.replace(/^Hares?\s+(?:is|are|=)\s+/i, "").trim();

  // Truncate at trailing logistics clauses (e.g., ", we are still taking applications...")
  h = h.replace(/,\s*(?:and we |we |still |also |please |but )\b.*/i, "").trim();

  // Truncate at boilerplate markers (description text leaked into hares)
  const boilerplateIdx = h.search(HARE_BOILERPLATE_RE);
  if (boilerplateIdx > 0) {
    h = h.slice(0, boilerplateIdx).trim();
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

/** Cache of kennelCode → compiled Trail pattern for rewriteStaleDefaultTitle. */
const staleTrailPatternCache = new Map<string, RegExp>();

/**
 * Rewrite stale default titles that use a raw kennelCode instead of the current
 * display name. Returns the corrected title or the original if no rewrite needed.
 */
export function rewriteStaleDefaultTitle(
  title: string,
  kennelCode: string,
  shortName: string,
  fullName: string | null,
): string {
  const displayName = friendlyKennelName(shortName, fullName);
  if (!displayName || displayName.toLowerCase() === kennelCode.toLowerCase()) return title;
  let pattern = staleTrailPatternCache.get(kennelCode);
  if (!pattern) {
    const escaped = kennelCode.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    pattern = new RegExp(String.raw`^${escaped}(\s+Trail.*)`, "i");
    staleTrailPatternCache.set(kennelCode, pattern);
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
}

/** Source types whose location field is canonical and should not be enriched with a
 *  reverse-geocoded city. The display layer would otherwise append garbage like "1, Tokyo". */
function shouldSkipReverseGeocode(sourceType: SourceType | null): boolean {
  return sourceType === "HARRIER_CENTRAL";
}

/** Per-batch state threaded through all merge helper functions. */
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
  result: MergeResult;
}

/** Resolve kennel data (name + region + coords + country + region centroid), using the per-batch cache to avoid N+1 queries. */
async function resolveKennelData(kennelId: string, ctx: MergeContext): Promise<KennelCacheEntry> {
  let cached = ctx.kennelCache.get(kennelId);
  if (cached === undefined) {
    const kennel = await prisma.kennel.findUnique({
      where: { id: kennelId },
      select: { kennelCode: true, shortName: true, fullName: true, region: true, latitude: true, longitude: true, country: true, regionRef: { select: { centroidLat: true, centroidLng: true } } },
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
 * Refresh dateUtc/timezone on a canonical Event for a processed duplicate.
 * Only updates if the source has sufficient trust and values differ.
 */
async function refreshExistingEvent(
  existingEventId: string,
  event: RawEventData,
  ctx: MergeContext,
): Promise<void> {
  const { kennelId, matched } = await resolveKennelTag(event.kennelTag, ctx.sourceId);
  if (!matched || !kennelId || !ctx.linkedKennelIds.has(kennelId)) return;

  const region = await resolveRegion(kennelId, ctx);
  const timezone = regionTimezone(region);
  const eventDate = parseUtcNoonDate(event.date);
  const composedUtc = composeUtcStart(eventDate, event.startTime, timezone);
  // No start time → can't update dateUtc/timezone; upsertCanonicalEvent handles restores for these
  if (!composedUtc) return;

  const existingEvent = await prisma.event.findUnique({
    where: { id: existingEventId },
    select: { trustLevel: true, dateUtc: true, timezone: true, status: true },
  });
  const isHigherOrEqualTrust = !existingEvent || ctx.trustLevel >= existingEvent.trustLevel;
  const isAlreadyCurrent =
    existingEvent?.dateUtc?.getTime() === composedUtc.getTime() &&
    existingEvent?.timezone === timezone;
  // Auto-restore cancelled events when source still returns them
  const shouldRestore = existingEvent?.status === "CANCELLED";
  const needsUpdate = (isHigherOrEqualTrust && !isAlreadyCurrent) || shouldRestore;
  if (needsUpdate) {
    await prisma.event.update({
      where: { id: existingEventId },
      data: {
        ...(isHigherOrEqualTrust && !isAlreadyCurrent ? { dateUtc: composedUtc, timezone } : {}),
        ...(shouldRestore ? { status: "CONFIRMED" as const } : {}),
      },
    });
    if (shouldRestore) ctx.result.restored++;
  }
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
    await resolveKennelTag(event.kennelTag, ctx.sourceId);

  if (!resolvedMatch || !resolvedId) {
    if (needSkippedSamples) {
      ctx.result.sampleSkipped?.push({
        reason: "UNMATCHED_TAG",
        kennelTag: event.kennelTag,
        event,
        suggestedAction: `Create kennel or alias for "${event.kennelTag}"`,
      });
    }
  } else if (!ctx.linkedKennelIds.has(resolvedId)) {
    if (needBlockedSamples) {
      const kennel = await prisma.kennel.findUnique({ where: { id: resolvedId }, select: { shortName: true } });
      ctx.result.sampleBlocked?.push({
        reason: "SOURCE_KENNEL_MISMATCH",
        kennelTag: event.kennelTag,
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
  const existing = await prisma.rawEvent.findFirst({
    where: { fingerprint, sourceId: ctx.sourceId },
    select: { id: true, processed: true, eventId: true },
  });
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
  const { kennelId, matched } = await resolveKennelTag(event.kennelTag, ctx.sourceId);

  if (!matched || !kennelId) {
    // Flag for review — leave unprocessed
    if (!ctx.result.unmatched.includes(event.kennelTag)) {
      ctx.result.unmatched.push(event.kennelTag);
    }
    if (ctx.result.sampleSkipped && ctx.result.sampleSkipped.length < 3) {
      ctx.result.sampleSkipped.push({
        reason: "UNMATCHED_TAG",
        kennelTag: event.kennelTag,
        event,
        suggestedAction: `Create kennel or alias for "${event.kennelTag}"`,
      });
    }
    return null;
  }

  // Guard: block events for kennels not linked to this source
  if (!ctx.linkedKennelIds.has(kennelId)) {
    ctx.result.blocked++;
    if (!ctx.result.blockedTags.includes(event.kennelTag)) {
      ctx.result.blockedTags.push(event.kennelTag);
    }
    if (ctx.result.sampleBlocked && ctx.result.sampleBlocked.length < 3) {
      const kennel = await prisma.kennel.findUnique({
        where: { id: kennelId },
        select: { shortName: true },
      });
      ctx.result.sampleBlocked.push({
        reason: "SOURCE_KENNEL_MISMATCH",
        kennelTag: event.kennelTag,
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
 * address with state code and the city doesn't match (avoids "Hartville, OH, Akron, OH").
 */
export function suppressRedundantCity(locationName: string | null, city: string | null): string | null {
  if (!city || !locationName) return city;
  if (!/,\s*[A-Z]{2}(?:\s+\d{5})?$/.test(locationName)) return city;
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

  // Skip geocoding when the canonical event already has coords and location hasn't changed
  if (
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

  // Find existing canonical Events for this kennel+date
  const sameDayEvents = await prisma.event.findMany({
    where: { kennelId, date: eventDate },
  });

  // Match strategy:
  // 1. Zero existing → create new (common case)
  // 2. Exactly one → match unless already matched in this batch (double-header detection)
  // 3. Multiple → disambiguate by sourceUrl, then startTime, then title (sequential fallback)
  // 4. No disambiguation match → create new event
  //
  // Per-batch tracking distinguishes double-headers from cross-source merges:
  // - Same source, second event for kennel+date → already matched in batch → create new
  // - Different source, same event → first match in batch → update + EventLink
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
    if (!existingEvent && event.startTime) {
      existingEvent = sameDayEvents.find(e => e.startTime === event.startTime) ?? null;
    }
    if (!existingEvent && event.title) {
      existingEvent = sameDayEvents.find(e => e.title === event.title) ?? null;
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

    // Auto-restore: if any source actively returns this event, it's not stale
    const shouldRestore = existingEvent.status === "CANCELLED";
    if (shouldRestore && ctx.trustLevel < existingEvent.trustLevel) {
      // Lower-trust source can't update fields, but can still restore status
      await prisma.event.update({
        where: { id: existingEvent.id },
        data: { status: "CONFIRMED" },
      });
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
      } else if (event.locationUrl !== undefined && (event.locationUrl ?? null) !== (existingEvent.locationAddress ?? null)) {
        // Coords cleared — also clear city
        locationCity = null;
      }

      const updated = await prisma.event.update({
        where: { id: existingEvent.id },
        data: {
          ...(shouldRestore ? { status: "CONFIRMED" as const } : {}),
          runNumber: event.runNumber ?? existingEvent.runNumber,
          title: (() => {
            const nextTitle = sanitizeTitle(event.title) ?? existingEvent.title;
            return nextTitle ? rewriteStaleDefaultTitle(nextTitle, kennelData.kennelCode, kennelData.shortName, kennelData.fullName) : nextTitle;
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
          dateUtc,
          timezone,
          // Preserve first source's URL; subsequent sources get EventLinks
          sourceUrl: existingEvent.sourceUrl ?? event.sourceUrl,
          trustLevel: ctx.trustLevel,
          // Write coords if resolved; clear if locationAddress changed and no new coords
          // (prevents stale pins when an event moves to an unparseable location URL)
          ...(coords.latitude != null && coords.longitude != null
            ? { latitude: coords.latitude, longitude: coords.longitude }
            : event.locationUrl !== undefined && (event.locationUrl ?? null) !== (existingEvent.locationAddress ?? null)
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
    const newEvent = await prisma.event.create({
      data: {
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
        sourceUrl: event.sourceUrl,
        trustLevel: ctx.trustLevel,
        latitude: coords.latitude,
        longitude: coords.longitude,
        locationCity,
      },
    });

    targetEventId = newEvent.id;
    sameDayEvents.push(newEvent); // keep finalCandidates consistent for recomputeCanonical

    // Link RawEvent to new Event
    await prisma.rawEvent.update({
      where: { id: rawEventId },
      data: { processed: true, eventId: newEvent.id },
    });

    ctx.result.created++;
    ctx.result.createdEventIds.push(newEvent.id);
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
  const hasDisplayData = event.title || event.location || event.hares || event.runNumber || event.kennelTag;
  if (!hasDisplayData) {
    ctx.result.eventErrors++;
    if (ctx.result.eventErrorMessages.length < 50) {
      ctx.result.eventErrorMessages.push(
        `${event.date}/${event.kennelTag}: Skipping empty event (no title, location, hares, or run number)`,
      );
    }
    return null;
  }

  const rawEvent = await prisma.rawEvent.create({
    data: {
      sourceId,
      rawData: event as unknown as Prisma.InputJsonValue,
      fingerprint,
      processed: false,
    },
  });

  const kennelId = await resolveAndGuardKennel(event, ctx);
  if (!kennelId) return null;

  // Fix the event title using the kennel's display name (not the raw adapter tag).
  // Must happen AFTER kennel resolution so we have access to shortName/fullName.
  const kennelData = await resolveKennelData(kennelId, ctx);
  const sanitized = sanitizeTitle(event.title);
  if (!sanitized) {
    const displayName = friendlyKennelName(kennelData.shortName, kennelData.fullName) || event.kennelTag;
    event.title = event.runNumber
      ? `${displayName} Trail #${event.runNumber}`
      : `${displayName} Trail`;
  } else {
    event.title = rewriteStaleDefaultTitle(sanitized, kennelData.kennelCode, kennelData.shortName, kennelData.fullName);
  }

  const targetEventId = await upsertCanonicalEvent(event, kennelId, rawEvent.id, ctx);

  await createEventLinks(targetEventId, sourceId, event.externalLinks);

  // Update kennel's lastEventDate cache if this event is newer
  const eventDateForCache = parseUtcNoonDate(event.date);
  await prisma.$executeRaw`
    UPDATE "Kennel"
    SET "lastEventDate" = ${eventDateForCache}, "updatedAt" = NOW()
    WHERE id = ${kennelId}
    AND ("lastEventDate" IS NULL OR "lastEventDate" < ${eventDateForCache})
  `;

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
};

export function completenessScore(e: Omit<CanonicalCandidate, "id" | "trustLevel" | "createdAt">): number {
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
  return score;
}

/**
 * Signature for grouping duplicate rows within a (kennelId, date) slot.
 * Rows that share a signature are cross-source dupes of the same real-world
 * run; rows with distinct signatures are genuine double-headers (e.g., a
 * kennel running both a morning and evening trail on the same day, which
 * upsertCanonicalEvent intentionally preserves as separate rows).
 */
function eventSignature(e: CanonicalCandidate): string {
  const time = e.startTime?.trim() || "";
  const url = e.sourceUrl?.trim() || "";
  const title = e.title?.trim() || "";
  return `${time}::${url}::${title}`;
}

/**
 * Pick the canonical row id(s) across a (kennelId, date) group. Rows get
 * grouped by signature first — distinct signatures are genuine multi-event
 * days that must each keep a canonical. Within each signature group,
 * ordering is: trustLevel DESC, completeness DESC, createdAt ASC (stable).
 * Pure function — no DB access; input is whatever the caller has in hand.
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

  for (const group of bySignature.values()) {
    let best = group[0];
    let bestScore = completenessScore(best);
    for (const e of group.slice(1)) {
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
 * Caller provides the full set of rows. No-op for single-row slots and
 * for slots where the flags already match the selector's pick — the
 * early-out matters on chronic-dup kennels where a ~1000-event scrape
 * would otherwise fire a transaction per incoming event.
 */
async function recomputeCanonical(
  candidates: CandidateWithCanonicalState[],
): Promise<void> {
  if (candidates.length <= 1) return;

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
): void {
  const reason = err instanceof Error ? err.message : String(err);
  const msg = `${event.date}/${event.kennelTag}: ${reason}`;
  console.error(`Merge error: ${msg}`);
  result.eventErrors++;
  if (result.eventErrorMessages.length < 50) {
    result.eventErrorMessages.push(msg);
  }
  if (result.mergeErrorDetails && result.mergeErrorDetails.length < 50) {
    result.mergeErrorDetails.push({
      fingerprint: generateFingerprint(event),
      reason,
    });
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

  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { trustLevel: true, type: true },
  });
  const trustLevel = source?.trustLevel ?? 5;
  const sourceType: SourceType | null = source?.type ?? null;

  const sourceKennels = await prisma.sourceKennel.findMany({
    where: { sourceId },
    select: { kennelId: true },
  });
  const linkedKennelIds = new Set(sourceKennels.map(sk => sk.kennelId));

  clearResolverCache();

  const kennelCache = new Map<string, KennelCacheEntry>();
  const shortUrlCache = new Map<string, string | null>();
  const batchMatchedEvents = new Map<string, Set<string>>();
  const ctx: MergeContext = { sourceId, trustLevel, sourceType, linkedKennelIds, kennelCache, shortUrlCache, batchMatchedEvents, result };

  const seriesGroups = new Map<string, string[]>();

  for (const event of events) {
    try {
      const fingerprint = generateFingerprint(event);

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
      recordMergeError(event, err, result);
    }
  }

  await linkMultiDaySeries(seriesGroups);

  return result;
}
