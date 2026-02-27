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
