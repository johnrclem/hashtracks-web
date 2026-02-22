import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { RawEventData, MergeResult } from "@/adapters/types";
import { parseUtcNoonDate } from "@/lib/date";
import { regionTimezone } from "@/lib/format";
import { composeUtcStart } from "@/lib/timezone";
import { generateFingerprint } from "./fingerprint";
import { resolveKennelTag, clearResolverCache } from "./kennel-resolver";

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

interface MergeContext {
  sourceId: string;
  trustLevel: number;
  linkedKennelIds: Set<string>;
  regionCache: Map<string, string>;
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

  // Already processed — skip sample collection entirely.
  // If also linked to a canonical Event, refresh timezone-derived fields.
  if (existing.processed) {
    if (existing.eventId) {
      const { kennelId, matched } = await resolveKennelTag(event.kennelTag, ctx.sourceId);
      if (matched && kennelId && ctx.linkedKennelIds.has(kennelId)) {
        const region = await resolveRegion(kennelId, ctx);
        const timezone = regionTimezone(region);
        const eventDate = parseUtcNoonDate(event.date);
        const composedUtc = composeUtcStart(eventDate, event.startTime, timezone);
        // Only update if we have a real UTC time AND the source has sufficient trust
        if (composedUtc) {
          const existingEvent = await prisma.event.findUnique({
            where: { id: existing.eventId },
            select: { trustLevel: true, dateUtc: true, timezone: true },
          });
          // Trust guard: don't let lower-trust sources overwrite higher-trust event times
          const isHigherOrEqualTrust = !existingEvent || ctx.trustLevel >= existingEvent.trustLevel;
          // Skip write if values are already correct (avoid redundant DB writes on every scrape)
          const isAlreadyCurrent =
            existingEvent?.dateUtc?.getTime() === composedUtc.getTime() &&
            existingEvent?.timezone === timezone;
          if (isHigherOrEqualTrust && !isAlreadyCurrent) {
            await prisma.event.update({
              where: { id: existing.eventId },
              data: { dateUtc: composedUtc, timezone },
            });
          }
        }
      }
    }
    return existing.eventId;
  }

  // Unprocessed duplicate — collect diagnostic samples as before
  const needSkippedSamples = ctx.result.sampleSkipped && ctx.result.sampleSkipped.length < 3;
  const needBlockedSamples = ctx.result.sampleBlocked && ctx.result.sampleBlocked.length < 3;

  if (needSkippedSamples || needBlockedSamples) {
    const { kennelId: resolvedId, matched: resolvedMatch } =
      await resolveKennelTag(event.kennelTag, ctx.sourceId);

    if (!resolvedMatch || !resolvedId) {
      if (needSkippedSamples) {
        ctx.result.sampleSkipped!.push({
          reason: "UNMATCHED_TAG",
          kennelTag: event.kennelTag,
          event,
          suggestedAction: `Create kennel or alias for "${event.kennelTag}"`,
        });
      }
    } else if (!ctx.linkedKennelIds.has(resolvedId)) {
      if (needBlockedSamples) {
        const kennel = await prisma.kennel.findUnique({ where: { id: resolvedId }, select: { shortName: true } });
        ctx.result.sampleBlocked!.push({
          reason: "SOURCE_KENNEL_MISMATCH",
          kennelTag: event.kennelTag,
          event,
          suggestedAction: `Link ${kennel?.shortName ?? resolvedId} to this source`,
        });
      }
    }
  }

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

  // Check for existing canonical Event with same (kennelId, date)
  const existingEvent = await prisma.event.findUnique({
    where: { kennelId_date: { kennelId, date: eventDate } },
  });

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
      await prisma.event.update({
        where: { id: existingEvent.id },
        data: {
          runNumber: event.runNumber ?? existingEvent.runNumber,
          // Use ?? null for text fields: scraper always attempts these,
          // so undefined means "clear it" (not "I didn't try")
          title: event.title ?? null,
          description: event.description ?? null,
          haresText: event.hares ?? null,
          locationName: event.location ?? null,
          locationAddress: event.locationUrl ?? null,
          startTime: event.startTime ?? existingEvent.startTime,
          dateUtc,
          timezone,
          // Preserve first source's URL; subsequent sources get EventLinks
          sourceUrl: existingEvent.sourceUrl ?? event.sourceUrl,
          trustLevel: ctx.trustLevel,
        },
      });
    }

    // If this source provides a different sourceUrl, create an EventLink for it
    if (event.sourceUrl && existingEvent.sourceUrl && event.sourceUrl !== existingEvent.sourceUrl) {
      await prisma.eventLink.upsert({
        where: { eventId_url: { eventId: existingEvent.id, url: event.sourceUrl } },
        create: { eventId: existingEvent.id, url: event.sourceUrl, label: "Source", sourceId: ctx.sourceId },
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
    const newEvent = await prisma.event.create({
      data: {
        kennelId,
        date: eventDate,
        dateUtc,
        timezone,
        runNumber: event.runNumber,
        title: event.title,
        description: event.description,
        haresText: event.hares,
        locationName: event.location,
        locationAddress: event.locationUrl,
        startTime: event.startTime,
        sourceUrl: event.sourceUrl,
        trustLevel: ctx.trustLevel,
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

  // Get source trust level
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { trustLevel: true },
  });
  const trustLevel = source?.trustLevel ?? 5;

  // Fetch SourceKennel links once for the entire batch
  const sourceKennels = await prisma.sourceKennel.findMany({
    where: { sourceId },
    select: { kennelId: true },
  });
  const linkedKennelIds = new Set(sourceKennels.map(sk => sk.kennelId));

  // Clear resolver cache for fresh lookups
  clearResolverCache();

  const regionCache = new Map<string, string>();
  const ctx: MergeContext = { sourceId, trustLevel, linkedKennelIds, regionCache, result };

  // Track series IDs → canonical event IDs for post-processing
  const seriesGroups = new Map<string, string[]>();

  for (const event of events) {
    try {
      const fingerprint = generateFingerprint(event);

      // 1. Dedup by fingerprint; if already processed, refreshes dateUtc/timezone and
      // creates any new EventLinks, then skips creating a new RawEvent.
      // Returns false only when this is a brand-new fingerprint.
      const dupResult = await handleDuplicateFingerprint(event, fingerprint, ctx);
      if (dupResult !== false) {
        // Already exists — still create any new EventLinks from this scrape run
        if (dupResult) await createEventLinks(dupResult, sourceId, event.externalLinks);
        continue;
      }

      // 2. Create immutable RawEvent record
      const rawEvent = await prisma.rawEvent.create({
        data: {
          sourceId,
          rawData: event as unknown as Prisma.InputJsonValue,
          fingerprint,
          processed: false,
        },
      });

      // 3. Resolve kennel tag + source-kennel guard
      const kennelId = await resolveAndGuardKennel(event, ctx);
      if (!kennelId) continue;

      // 4. Upsert canonical Event
      const targetEventId = await upsertCanonicalEvent(event, kennelId, rawEvent.id, ctx);

      // 5. Create EventLinks from externalLinks
      await createEventLinks(targetEventId, sourceId, event.externalLinks);

      // Track series membership for post-processing
      if (event.seriesId) {
        const group = seriesGroups.get(event.seriesId) ?? [];
        group.push(targetEventId);
        seriesGroups.set(event.seriesId, group);
      }
    } catch (err) {
      // Log error but continue processing other events (graceful degradation)
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
  }

  // Post-processing: Link multi-day series via parentEventId
  await linkMultiDaySeries(seriesGroups);

  return result;
}
