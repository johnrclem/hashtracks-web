import { prisma } from "@/lib/db";

/** Generate a URL-safe slug from a kennel shortName. Strips parens, collapses hyphens. */
export function toSlug(shortName: string): string {
  return shortName
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Generate a permanent kennelCode from a shortName. Lowercase alphanumeric + hyphens only. */
export function toKennelCode(shortName: string): string {
  return shortName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Convenience wrapper returning both identifiers at once. */
export function buildKennelIdentifiers(shortName: string): { slug: string; kennelCode: string } {
  return { slug: toSlug(shortName), kennelCode: toKennelCode(shortName) };
}

/** Look up a Region record by name. Returns `{ id }` or `null` if not found. */
export async function resolveRegionByName(regionName: string): Promise<{ id: string; name: string } | null> {
  return prisma.region.findUnique({ where: { name: regionName }, select: { id: true, name: true } });
}

/**
 * Create a kennel record with region resolution, uniqueness checks, and optional alias.
 * Returns `{ kennelId }` on success or `{ error }` on failure.
 * Callers handle their own post-creation side effects (source linking, alerts, re-scraping).
 */
export async function createKennelRecord(
  kennelData: { shortName: string; fullName?: string; region?: string },
  tag: string,
): Promise<{ kennelId: string } | { error: string }> {
  const { slug, kennelCode } = buildKennelIdentifiers(kennelData.shortName);

  const regionName = kennelData.region || "Unknown";
  const regionRecord = await resolveRegionByName(regionName);
  if (!regionRecord) return { error: `Region "${regionName}" not found — create it first in Admin → Regions` };

  const existingKennel = await prisma.kennel.findFirst({
    where: {
      OR: [
        { kennelCode },
        { slug },
        { shortName: kennelData.shortName, regionId: regionRecord.id },
      ],
    },
  });
  if (existingKennel) return { error: `Kennel "${kennelData.shortName}" already exists` };

  const newKennel = await prisma.kennel.create({
    data: {
      kennelCode,
      shortName: kennelData.shortName,
      fullName: kennelData.fullName || kennelData.shortName,
      slug,
      region: regionName,
      regionRef: { connect: { id: regionRecord.id } },
      aliases: {
        create: tag !== kennelData.shortName ? [{ alias: tag }] : [],
      },
    },
  });

  return { kennelId: newKennel.id };
}
