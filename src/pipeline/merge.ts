import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { RawEventData, MergeResult, EventSample } from "@/adapters/types";
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
    mergeErrorDetails: [], // Phase 2A: Structured merge errors
    sampleBlocked: [], // Phase 2B: Sample blocked events
    sampleSkipped: [], // Phase 2B: Sample skipped events
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

  // Track series IDs → canonical event IDs for post-processing
  const seriesGroups = new Map<string, string[]>();

  for (const event of events) {
    try {
      const fingerprint = generateFingerprint(event);

      // Check if this exact fingerprint already exists
      const existing = await prisma.rawEvent.findFirst({
        where: { fingerprint, sourceId },
      });
      if (existing) {
        result.skipped++;

        // Phase 2B: Capture samples from previously-unprocessed events so that
        // recurring blocked/skipped issues generate samples on every scrape,
        // not just the first one (fingerprint dedup would otherwise skip them).
        if (!existing.processed) {
          const needSkippedSamples = result.sampleSkipped && result.sampleSkipped.length < 3;
          const needBlockedSamples = result.sampleBlocked && result.sampleBlocked.length < 3;

          if (needSkippedSamples || needBlockedSamples) {
            const { kennelId: resolvedId, matched: resolvedMatch } =
              await resolveKennelTag(event.kennelTag, sourceId);

            if (!resolvedMatch || !resolvedId) {
              if (needSkippedSamples) {
                result.sampleSkipped!.push({
                  reason: "UNMATCHED_TAG",
                  kennelTag: event.kennelTag,
                  event,
                  suggestedAction: `Create kennel or alias for "${event.kennelTag}"`,
                });
              }
            } else if (!linkedKennelIds.has(resolvedId)) {
              if (needBlockedSamples) {
                const kennel = await prisma.kennel.findUnique({
                  where: { id: resolvedId },
                  select: { shortName: true },
                });
                result.sampleBlocked!.push({
                  reason: "SOURCE_KENNEL_MISMATCH",
                  kennelTag: event.kennelTag,
                  event,
                  suggestedAction: `Link ${kennel?.shortName ?? resolvedId} to this source`,
                });
              }
            }
          }
        }

        continue;
      }

      // Create immutable RawEvent record
      const rawEvent = await prisma.rawEvent.create({
        data: {
          sourceId,
          rawData: event as unknown as Prisma.InputJsonValue,
          fingerprint,
          processed: false,
        },
      });

      // Resolve kennel tag (source-scoped for disambiguation)
      const { kennelId, matched } = await resolveKennelTag(event.kennelTag, sourceId);

      if (!matched || !kennelId) {
        // Flag for review — leave unprocessed
        if (!result.unmatched.includes(event.kennelTag)) {
          result.unmatched.push(event.kennelTag);
        }
        // Phase 2B: Capture sample skipped events (first 3)
        if (result.sampleSkipped && result.sampleSkipped.length < 3) {
          result.sampleSkipped.push({
            reason: "UNMATCHED_TAG",
            kennelTag: event.kennelTag,
            event,
            suggestedAction: `Create kennel or alias for "${event.kennelTag}"`,
          });
        }
        continue;
      }

      // Guard: block events for kennels not linked to this source
      if (!linkedKennelIds.has(kennelId)) {
        result.blocked++;
        if (!result.blockedTags.includes(event.kennelTag)) {
          result.blockedTags.push(event.kennelTag);
        }
        // Phase 2B: Capture sample blocked events (first 3)
        if (result.sampleBlocked && result.sampleBlocked.length < 3) {
          const kennel = await prisma.kennel.findUnique({
            where: { id: kennelId },
            select: { shortName: true },
          });
          result.sampleBlocked.push({
            reason: "SOURCE_KENNEL_MISMATCH",
            kennelTag: event.kennelTag,
            event,
            suggestedAction: `Link ${kennel?.shortName ?? kennelId} to this source`,
          });
        }
        continue;
      }

      // Parse date as UTC noon
      const [yearStr, monthStr, dayStr] = event.date.split("-");
      const eventDate = new Date(
        Date.UTC(
          parseInt(yearStr, 10),
          parseInt(monthStr, 10) - 1,
          parseInt(dayStr, 10),
          12,
          0,
          0,
        ),
      );

      // Check for existing canonical Event with same (kennelId, date)
      const existingEvent = await prisma.event.findUnique({
        where: { kennelId_date: { kennelId, date: eventDate } },
      });

      let targetEventId: string;

      if (existingEvent) {
        targetEventId = existingEvent.id;

        // Update only if our source trust level >= existing
        if (trustLevel >= existingEvent.trustLevel) {
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
              // Preserve first source's URL; subsequent sources get EventLinks
              sourceUrl: existingEvent.sourceUrl ?? event.sourceUrl,
              trustLevel,
            },
          });
        }

        // If this source provides a different sourceUrl, create an EventLink for it
        if (event.sourceUrl && existingEvent.sourceUrl && event.sourceUrl !== existingEvent.sourceUrl) {
          await prisma.eventLink.upsert({
            where: { eventId_url: { eventId: existingEvent.id, url: event.sourceUrl } },
            create: { eventId: existingEvent.id, url: event.sourceUrl, label: "Source", sourceId },
            update: {},
          });
        }

        // Link RawEvent to existing Event
        await prisma.rawEvent.update({
          where: { id: rawEvent.id },
          data: { processed: true, eventId: existingEvent.id },
        });

        result.updated++;
      } else {
        // Create new canonical Event
        const newEvent = await prisma.event.create({
          data: {
            kennelId,
            date: eventDate,
            dateUtc: eventDate,
            timezone: "America/New_York",
            runNumber: event.runNumber,
            title: event.title,
            description: event.description,
            haresText: event.hares,
            locationName: event.location,
            locationAddress: event.locationUrl,
            startTime: event.startTime,
            sourceUrl: event.sourceUrl,
            trustLevel,
          },
        });

        targetEventId = newEvent.id;

        // Link RawEvent to new Event
        await prisma.rawEvent.update({
          where: { id: rawEvent.id },
          data: { processed: true, eventId: newEvent.id },
        });

        result.created++;
      }

      // Create EventLinks from externalLinks
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
      // Phase 2A: Structured merge error with fingerprint
      if (result.mergeErrorDetails && result.mergeErrorDetails.length < 50) {
        result.mergeErrorDetails.push({
          fingerprint: generateFingerprint(event),
          reason,
        });
      }
    }
  }

  // Post-processing: Link multi-day series via parentEventId
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

  return result;
}
