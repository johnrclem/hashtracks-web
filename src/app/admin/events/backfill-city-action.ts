"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reverseGeocode } from "@/lib/geo";
import { revalidatePath } from "next/cache";

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

  // Batch update events in a transaction
  const updates: ReturnType<typeof prisma.event.updateMany>[] = [];
  for (const [key, city] of coordToCity) {
    const eventIds = coordToEventIds.get(key)!;
    updates.push(
      prisma.event.updateMany({
        where: { id: { in: eventIds } },
        data: { locationCity: city },
      }),
    );
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  revalidatePath("/hareline");
  revalidatePath("/admin/events");

  return {
    result: {
      total: events.length,
      uniqueCoords: coordEntries.length,
      filled,
      failed,
    },
  };
}
