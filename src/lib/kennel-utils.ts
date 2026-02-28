import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

/** Generate a URL-safe slug from a kennel shortName. Strips parens, collapses hyphens. */
export function toSlug(shortName: string): string {
  return shortName
    .toLowerCase()
    .replaceAll(/[()]/g, "")
    .replaceAll(/\s+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

/** Generate a permanent kennelCode from a shortName. Lowercase alphanumeric + hyphens only. */
export function toKennelCode(shortName: string): string {
  return shortName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

/** Convenience wrapper returning both identifiers at once. */
export function buildKennelIdentifiers(shortName: string): { slug: string; kennelCode: string } {
  return { slug: toSlug(shortName), kennelCode: toKennelCode(shortName) };
}

/** Look up a Region record by name (case-insensitive). Returns `{ id, name }` or `null` if not found. */
export async function resolveRegionByName(regionName: string): Promise<{ id: string; name: string } | null> {
  return prisma.region.findFirst({
    where: { name: { equals: regionName, mode: "insensitive" } },
    select: { id: true, name: true },
  });
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
  const trimmedShort = kennelData.shortName?.trim();
  const trimmedTag = tag?.trim();
  if (!trimmedShort) return { error: "Short name is required" };

  const { slug, kennelCode } = buildKennelIdentifiers(trimmedShort);

  const regionName = kennelData.region?.trim() || "Unknown";
  const regionRecord = await resolveRegionByName(regionName);
  if (!regionRecord) return { error: `Region "${regionName}" not found — create it first in Admin → Regions` };

  const existingKennel = await prisma.kennel.findFirst({
    where: {
      OR: [
        { kennelCode },
        { slug },
        { shortName: trimmedShort, regionId: regionRecord.id },
      ],
    },
  });
  if (existingKennel) return { error: `Kennel "${trimmedShort}" already exists` };

  try {
    const newKennel = await prisma.kennel.create({
      data: {
        kennelCode,
        shortName: trimmedShort,
        fullName: kennelData.fullName?.trim() || trimmedShort,
        slug,
        region: regionRecord.name,
        regionRef: { connect: { id: regionRecord.id } },
        aliases: {
          create: trimmedTag === trimmedShort ? [] : [{ alias: trimmedTag }],
        },
      },
    });
    return { kennelId: newKennel.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: `Kennel "${trimmedShort}" already exists` };
    }
    throw e;
  }
}
