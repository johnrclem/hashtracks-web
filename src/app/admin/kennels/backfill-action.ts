"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { geocodeAddress } from "@/lib/geo";
import { revalidatePath } from "next/cache";

interface BackfillResult {
  total: number;
  fromDiscovery: number;
  geocoded: number;
  failed: string[];
}

/**
 * Backfill lat/lng for existing kennels that don't have coordinates.
 * Priority:
 * 1. Copy from linked KennelDiscovery records
 * 2. Geocode from kennel name + region name
 */
export async function backfillKennelCoords(): Promise<{ error?: string; result?: BackfillResult }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const kennels = await prisma.kennel.findMany({
    where: { OR: [{ latitude: null }, { longitude: null }] },
    select: {
      id: true,
      shortName: true,
      fullName: true,
      region: true,
      country: true,
      discoveries: {
        where: { latitude: { not: null } },
        select: { latitude: true, longitude: true },
        take: 1,
      },
    },
  });

  const result: BackfillResult = {
    total: kennels.length,
    fromDiscovery: 0,
    geocoded: 0,
    failed: [],
  };

  for (const kennel of kennels) {
    try {
      // Try discovery coords first
      const discovery = kennel.discoveries[0];
      if (discovery?.latitude != null && discovery?.longitude != null) {
        await prisma.kennel.update({
          where: { id: kennel.id },
          data: { latitude: discovery.latitude, longitude: discovery.longitude },
        });
        result.fromDiscovery++;
        continue;
      }

      // Geocode from kennel name + region + country
      const address = `${kennel.fullName}, ${kennel.region}, ${kennel.country}`;
      const coords = await geocodeAddress(address);
      if (coords) {
        await prisma.kennel.update({
          where: { id: kennel.id },
          data: { latitude: coords.lat, longitude: coords.lng },
        });
        result.geocoded++;
      } else {
        result.failed.push(kennel.shortName);
      }

      // Rate limit: avoid hammering the geocoding API
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`Backfill error for ${kennel.shortName}:`, err);
      result.failed.push(kennel.shortName);
    }
  }

  revalidatePath("/admin/kennels");
  revalidatePath("/kennels");
  return { result };
}
