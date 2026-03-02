import { prisma } from "@/lib/db";

/** Shared kennel + region fetch used by source list and onboarding pages. */
export async function fetchKennelsAndRegions() {
  const [allKennels, allRegions] = await Promise.all([
    prisma.kennel.findMany({
      orderBy: { shortName: "asc" },
      select: { id: true, shortName: true, fullName: true, region: true },
    }),
    prisma.region.findMany({
      orderBy: [{ country: "asc" }, { name: "asc" }],
      select: { id: true, name: true, country: true, abbrev: true },
    }),
  ]);

  return { allKennels, allRegions };
}
