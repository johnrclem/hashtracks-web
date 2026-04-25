"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reverseGeocode } from "@/lib/geo";
import { revalidatePath, revalidateTag } from "next/cache";
import { HARELINE_EVENTS_TAG } from "@/lib/cache-tags";

interface BackfillCityResult {
  total: number;
  uniqueCoords: number;
  filled: number;
  failed: number;
}

/**
 * Backfill locationCity for events that have coordinates but no city.
 * Deduplicates coordinates (rounded to 3 decimal places ~110m) to minimize API calls,
 * then batch-updates all matching events.
 */
export async function backfillEventCities(): Promise<{
  error?: string;
  result?: BackfillCityResult;
}> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const events = await prisma.event.findMany({
    where: {
      latitude: { not: null },
      longitude: { not: null },
      locationCity: null,
    },
    select: { id: true, latitude: true, longitude: true },
  });

  if (events.length === 0) {
    return { result: { total: 0, uniqueCoords: 0, filled: 0, failed: 0 } };
  }

  // Narrow type: WHERE clause guarantees non-null coords
  const withCoords = events as Array<{ id: string; latitude: number; longitude: number }>;

  // Deduplicate by rounding coords to 3 decimal places (~110m precision)
  const coordToEventIds = new Map<string, string[]>();
  for (const e of withCoords) {
    const key = `${e.latitude.toFixed(3)},${e.longitude.toFixed(3)}`;
    const ids = coordToEventIds.get(key) ?? [];
    ids.push(e.id);
    coordToEventIds.set(key, ids);
  }

  const coordEntries = Array.from(coordToEventIds.entries());
  const coordToCity = new Map<string, string>();
  let filled = 0;
  let failed = 0;

  // Batch reverse-geocode with bounded concurrency
  const BATCH_SIZE = 10;
  for (let i = 0; i < coordEntries.length; i += BATCH_SIZE) {
    const batch = coordEntries.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ([key]) => {
        const [lat, lng] = key.split(",").map(Number);
        const city = await reverseGeocode(lat, lng);
        return { key, city };
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const key = batch[j][0];
      const eventCount = coordToEventIds.get(key)?.length ?? 0;
      if (r.status === "fulfilled" && r.value.city) {
        coordToCity.set(key, r.value.city);
        filled += eventCount;
      } else {
        failed += eventCount;
      }
    }
  }

  // Update events in batches (no transaction needed — each updateMany
  // targets a disjoint set of events with an idempotent value).
  // Earlier batches may have already written `locationCity` rows by the
  // time a later batch throws, so the `finally` always runs the
  // invalidations — otherwise the Hareline cache would keep serving the
  // pre-backfill city values until the 3600s fallback window expired.
  const updateEntries = Array.from(coordToCity.entries());
  try {
    for (let i = 0; i < updateEntries.length; i += BATCH_SIZE) {
      await Promise.all(
        updateEntries.slice(i, i + BATCH_SIZE).map(([key, city]) => {
          const eventIds = coordToEventIds.get(key)!;
          return prisma.event.updateMany({
            where: { id: { in: eventIds } },
            data: { locationCity: city },
          });
        }),
      );
    }
  } catch (e) {
    console.error("Failed to backfill event cities:", e);
    return { error: "Database update failed during city backfill." };
  } finally {
    revalidatePath("/hareline");
    revalidatePath("/admin/events");
    revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
  }

  return {
    result: {
      total: events.length,
      uniqueCoords: coordEntries.length,
      filled,
      failed,
    },
  };
}
