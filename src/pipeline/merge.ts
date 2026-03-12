import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { RawEventData, MergeResult } from "@/adapters/types";
import { parseUtcNoonDate } from "@/lib/date";
import { regionTimezone, getLabelForUrl } from "@/lib/format";
import { composeUtcStart } from "@/lib/timezone";
import { generateFingerprint } from "./fingerprint";
import { resolveKennelTag, clearResolverCache } from "./kennel-resolver";
import { extractCoordsFromMapsUrl, geocodeAddress, resolveShortMapsUrl, reverseGeocode } from "@/lib/geo";
import { isPlaceholder } from "@/adapters/utils";

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

/** Per-batch state threaded through all merge helper functions. */
interface MergeContext {
  sourceId: string;
  /** Source trust level (1–10); higher-trust sources overwrite lower-trust data. */
  trustLevel: number;
  /** Kennel IDs linked to this source via SourceKennel (for the guard check). */
  linkedKennelIds: Set<string>;
  /** Per-batch cache of kennelId → region string to avoid N+1 queries. */
  regionCache: Map<string, string>;
  /** Per-batch cache of short Maps URL → resolved full URL (avoids repeated HTTP calls). */
  shortUrlCache: Map<string, string | null>;
  /** Per-batch tracking: which canonical Event IDs have been matched for each kennel+date.
   *  Key = `${kennelId}:${dateIso}`, value = set of canonical Event IDs matched in this batch.
   *  Used to distinguish double-headers (same source, second event) from cross-source merges. */
  batchMatchedEvents: Map<string, Set<string>>;
  result: MergeResult;
}

/** Resolve region for a kennel, using the per-batch cache to avoid N+1 queries. */
async function resolveRegion(kennelId: string, ctx: MergeContext): Promise<string> {
  let region = ctx.regionCache.get(kennelId);
  if (region === undefined) {
    const kennel = await prisma.kennel.findUnique({ where: { id: kennelId }, select: { region: true } });
    region = kennel?.region ?? "";
    ctx.regionCache.set(kennelId, region);
  }
  return region;
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
  if (!composedUtc) return;

  const existingEvent = await prisma.event.findUnique({
    where: { id: existingEventId },
    select: { trustLevel: true, dateUtc: true, timezone: true },
  });
  const isHigherOrEqualTrust = !existingEvent || ctx.trustLevel >= existingEvent.trustLevel;
  const isAlreadyCurrent =
    existingEvent?.dateUtc?.getTime() === composedUtc.getTime() &&
    existingEvent?.timezone === timezone;
  if (isHigherOrEqualTrust && !isAlreadyCurrent) {
    await prisma.event.update({
      where: { id: existingEventId },
      data: { dateUtc: composedUtc, timezone },
    });
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

  // Unprocessed duplicate — collect diagnostic samples
  await collectSkippedAndBlockedSamples(event, ctx);

  return existing.eventId; // May be null if unprocessed
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
  // Filter out admin/meta content in titles
  if (/hares?\s+needed|need\s+(?:a\s+)?hares?|looking\s+for\s+hares?|email\s+the\s+hare|volunteer\s+to\s+hare/i.test(t)) return null;
  // Strip embedded email addresses
  const cleaned = t.replace(/\s*<?[\w.+-]+@[\w.-]+>?\s*/g, " ").trim();
  return cleaned || null;
}

/**
 * Sanitize location names: filter placeholders (TBA/TBD) and bare URLs.
 * Returns null for locations that are not meaningful display text.
 */
export function sanitizeLocation(location: string | undefined): string | null {
  if (!location) return null;
  const t = location.trim();
  if (!t) return null;
  if (isPlaceholder(t)) return null;
  // Strip "Registration: url" values used as location
  if (/^registration\s*:/i.test(t)) return null;
  // Strip bare URLs (not useful as location names)
  if (/^https?:\/\/\S+$/.test(t)) return null;
  return t;
}

/** Filter non-place location URLs (My Maps viewers, etc). Returns null for unusable URLs. */
function sanitizeLocationUrl(url: string | undefined): string | null {
  if (!url) return null;
  // Google My Maps viewer/editor URLs are not place links
  if (/google\.\w+\/maps\/d\//i.test(url)) return null;
  return url;
}

/**
 * Resolve coordinates for a raw event: explicit coords → URL extraction → geocode fallback.
 * Optionally skips geocoding if the canonical event already has stored coords and
 * the location text hasn't changed.
 */
async function resolveCoords(
  event: RawEventData,
  existingCoords?: { latitude: number | null; longitude: number | null; locationAddress: string | null },
  shortUrlCache?: Map<string, string | null>,
): Promise<{ latitude?: number; longitude?: number }> {
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
    const geocoded = await geocodeAddress(event.location);
    if (geocoded) return { latitude: geocoded.lat, longitude: geocoded.lng };
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
    // If we already matched this event in the current batch, this is a double-header
    if (alreadyMatchedInBatch) {
      existingEvent = null;
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

  const region = await resolveRegion(kennelId, ctx);

  const timezone = regionTimezone(region);
  const composedUtc = composeUtcStart(eventDate, event.startTime, timezone);
  // Default to noon if no start time is provided, or composition fails
  const dateUtc = composedUtc ?? eventDate;

  let targetEventId: string;

  if (existingEvent) {
    targetEventId = existingEvent.id;

    // Update only if our source trust level >= existing
    if (ctx.trustLevel >= existingEvent.trustLevel) {
      const coords = await resolveCoords(event, {
        latitude: existingEvent.latitude,
        longitude: existingEvent.longitude,
        locationAddress: existingEvent.locationAddress,
      }, ctx.shortUrlCache);

      // Reverse-geocode city when we have new coords and locationCity isn't already set
      let locationCity: string | null | undefined;
      if (coords.latitude != null && coords.longitude != null) {
        const coordsChanged =
          coords.latitude !== existingEvent.latitude || coords.longitude !== existingEvent.longitude;
        if (coordsChanged || !existingEvent.locationCity) {
          locationCity = await reverseGeocode(coords.latitude, coords.longitude);
        }
      } else if (event.locationUrl !== undefined && (event.locationUrl ?? null) !== (existingEvent.locationAddress ?? null)) {
        // Coords cleared — also clear city
        locationCity = null;
      }

      await prisma.event.update({
        where: { id: existingEvent.id },
        data: {
          runNumber: event.runNumber ?? existingEvent.runNumber,
          title: sanitizeTitle(event.title) ?? existingEvent.title,
          // Preserve existing fields when source doesn't provide them (undefined)
          ...(event.description !== undefined
            ? { description: event.description ?? null }
            : {}),
          ...(event.hares !== undefined
            ? { haresText: event.hares ?? null }
            : {}),
          ...(event.location !== undefined
            ? { locationName: sanitizeLocation(event.location) }
            : {}),
          ...(event.locationUrl !== undefined
            ? { locationAddress: sanitizeLocationUrl(event.locationUrl) }
            : {}),
          startTime: event.startTime ?? existingEvent.startTime,
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
  } else {
    // Create new canonical Event
    const coords = await resolveCoords(event, undefined, ctx.shortUrlCache);
    // Reverse-geocode city when coords are available
    const locationCity = (coords.latitude != null && coords.longitude != null)
      ? await reverseGeocode(coords.latitude, coords.longitude)
      : null;
    const newEvent = await prisma.event.create({
      data: {
        kennelId,
        date: eventDate,
        dateUtc,
        timezone,
        runNumber: event.runNumber,
        title: sanitizeTitle(event.title),
        description: event.description,
        haresText: event.hares,
        locationName: sanitizeLocation(event.location),
        locationAddress: sanitizeLocationUrl(event.locationUrl),
        startTime: event.startTime,
        sourceUrl: event.sourceUrl,
        trustLevel: ctx.trustLevel,
        latitude: coords.latitude,
        longitude: coords.longitude,
        locationCity,
      },
    });

    targetEventId = newEvent.id;

    // Link RawEvent to new Event
    await prisma.rawEvent.update({
      where: { id: rawEventId },
      data: { processed: true, eventId: newEvent.id },
    });

    ctx.result.created++;
  }

  // Record this match in the per-batch tracker
  const matched = ctx.batchMatchedEvents.get(batchKey) ?? new Set<string>();
  matched.add(targetEventId);
  ctx.batchMatchedEvents.set(batchKey, matched);

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
  // Validate the event has at least one meaningful display field before processing
  const hasDisplayData = event.title || event.location || event.hares || event.runNumber;
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

  const targetEventId = await upsertCanonicalEvent(event, kennelId, rawEvent.id, ctx);

  await createEventLinks(targetEventId, sourceId, event.externalLinks);

  return targetEventId;
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
    updated: 0,
    skipped: 0,
    unmatched: [],
    blocked: 0,
    blockedTags: [],
    eventErrors: 0,
    eventErrorMessages: [],
    mergeErrorDetails: [],
    sampleBlocked: [],
    sampleSkipped: [],
  };

  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { trustLevel: true },
  });
  const trustLevel = source?.trustLevel ?? 5;

  const sourceKennels = await prisma.sourceKennel.findMany({
    where: { sourceId },
    select: { kennelId: true },
  });
  const linkedKennelIds = new Set(sourceKennels.map(sk => sk.kennelId));

  clearResolverCache();

  const regionCache = new Map<string, string>();
  const shortUrlCache = new Map<string, string | null>();
  const batchMatchedEvents = new Map<string, Set<string>>();
  const ctx: MergeContext = { sourceId, trustLevel, linkedKennelIds, regionCache, shortUrlCache, batchMatchedEvents, result };

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
