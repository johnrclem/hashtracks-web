"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { resolveKennelTag, clearResolverCache } from "@/pipeline/kennel-resolver";
import { scrapeSource } from "@/pipeline/scrape";

export async function createSource(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const name = (formData.get("name") as string)?.trim();
  const url = (formData.get("url") as string)?.trim();
  const type = (formData.get("type") as string)?.trim();
  const trustLevel = parseInt(
    (formData.get("trustLevel") as string) || "5",
    10,
  );
  const scrapeFreq = (formData.get("scrapeFreq") as string)?.trim() || "daily";
  const kennelIds = (formData.get("kennelIds") as string)?.trim() || "";

  if (!name || !url || !type) {
    return { error: "Name, URL, and type are required" };
  }

  const source = await prisma.source.create({
    data: {
      name,
      url,
      type: type as "HTML_SCRAPER" | "GOOGLE_CALENDAR" | "GOOGLE_SHEETS" | "ICAL_FEED" | "RSS_FEED" | "JSON_API" | "MANUAL",
      trustLevel,
      scrapeFreq,
    },
  });

  // Create SourceKennel links
  const ids = kennelIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  for (const kennelId of ids) {
    await prisma.sourceKennel.create({
      data: { sourceId: source.id, kennelId },
    });
  }

  revalidatePath("/admin/sources");
  return { success: true };
}

export async function updateSource(sourceId: string, formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const name = (formData.get("name") as string)?.trim();
  const url = (formData.get("url") as string)?.trim();
  const type = (formData.get("type") as string)?.trim();
  const trustLevel = parseInt(
    (formData.get("trustLevel") as string) || "5",
    10,
  );
  const scrapeFreq = (formData.get("scrapeFreq") as string)?.trim() || "daily";
  const kennelIds = (formData.get("kennelIds") as string)?.trim() || "";

  if (!name || !url || !type) {
    return { error: "Name, URL, and type are required" };
  }

  const ids = kennelIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  await prisma.$transaction([
    prisma.sourceKennel.deleteMany({ where: { sourceId } }),
    prisma.source.update({
      where: { id: sourceId },
      data: {
        name,
        url,
        type: type as "HTML_SCRAPER" | "GOOGLE_CALENDAR" | "GOOGLE_SHEETS" | "ICAL_FEED" | "RSS_FEED" | "JSON_API" | "MANUAL",
        trustLevel,
        scrapeFreq,
        kennels: {
          create: ids.map((kennelId) => ({ kennelId })),
        },
      },
    }),
  ]);

  revalidatePath("/admin/sources");
  return { success: true };
}

export async function deleteSource(sourceId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  // Check for raw events
  const rawEventCount = await prisma.rawEvent.count({
    where: { sourceId },
  });

  if (rawEventCount > 0) {
    return {
      error: `Cannot delete: source has ${rawEventCount} raw event(s). Remove them first.`,
    };
  }

  await prisma.$transaction([
    prisma.sourceKennel.deleteMany({ where: { sourceId } }),
    prisma.source.delete({ where: { id: sourceId } }),
  ]);

  revalidatePath("/admin/sources");
  return { success: true };
}

/**
 * Link a known kennel to a source (for SOURCE_KENNEL_MISMATCH).
 * The kennelTag must already resolve to a kennel — this just creates the SourceKennel link.
 */
export async function linkKennelToSourceDirect(
  sourceId: string,
  kennelTag: string,
) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  clearResolverCache();
  const { kennelId, matched } = await resolveKennelTag(kennelTag);
  if (!matched || !kennelId) {
    return { error: `Cannot resolve "${kennelTag}" to a kennel` };
  }

  // Check if link already exists
  const existing = await prisma.sourceKennel.findUnique({
    where: { sourceId_kennelId: { sourceId, kennelId } },
  });
  if (existing) {
    return { error: "Kennel is already linked to this source" };
  }

  await prisma.sourceKennel.create({
    data: { sourceId, kennelId },
  });

  // Auto-resolve any matching SOURCE_KENNEL_MISMATCH alert for this source
  const matchingAlerts = await prisma.alert.findMany({
    where: {
      sourceId,
      type: "SOURCE_KENNEL_MISMATCH",
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });
  for (const alert of matchingAlerts) {
    const ctx = alert.context as { tags?: string[] } | null;
    if (ctx?.tags?.includes(kennelTag)) {
      await prisma.alert.update({
        where: { id: alert.id },
        data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: admin.id },
      });
    }
  }

  // Re-scrape to pick up previously blocked events
  clearResolverCache();
  await scrapeSource(sourceId, { force: true });

  revalidatePath("/admin/sources");
  revalidatePath(`/admin/sources/${sourceId}`);
  revalidatePath("/admin/alerts");
  return { success: true };
}

/**
 * Create an alias mapping an unmatched tag to an existing kennel (for UNMATCHED_TAG).
 */
export async function createAliasForSource(
  sourceId: string,
  tag: string,
  kennelId: string,
) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  // Check alias doesn't already exist
  const existing = await prisma.kennelAlias.findFirst({
    where: { alias: { equals: tag, mode: "insensitive" } },
  });
  if (existing) return { error: `Alias "${tag}" already exists` };

  await prisma.kennelAlias.create({
    data: { kennelId, alias: tag },
  });

  // Auto-resolve any matching UNMATCHED_TAGS alert
  const matchingAlerts = await prisma.alert.findMany({
    where: {
      sourceId,
      type: "UNMATCHED_TAGS",
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });
  for (const alert of matchingAlerts) {
    const ctx = alert.context as { tags?: string[] } | null;
    if (ctx?.tags) {
      clearResolverCache();
      const remaining: string[] = [];
      for (const t of ctx.tags) {
        const result = await resolveKennelTag(t);
        if (!result.matched) remaining.push(t);
      }
      if (remaining.length === 0) {
        await prisma.alert.update({
          where: { id: alert.id },
          data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: admin.id },
        });
      }
    }
  }

  // Re-scrape to pick up previously skipped events
  clearResolverCache();
  await scrapeSource(sourceId, { force: true });

  revalidatePath("/admin/sources");
  revalidatePath(`/admin/sources/${sourceId}`);
  revalidatePath("/admin/alerts");
  revalidatePath("/admin/kennels");
  return { success: true };
}

/**
 * Create a new kennel from an unmatched tag (for UNMATCHED_TAG).
 */
export async function createKennelForSource(
  sourceId: string,
  tag: string,
  kennelData: { shortName: string; fullName: string; region: string },
) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const slug = kennelData.shortName
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const kennelCode = kennelData.shortName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Check uniqueness
  const existingKennel = await prisma.kennel.findFirst({
    where: {
      OR: [
        { kennelCode },
        { slug },
        { shortName: kennelData.shortName, region: kennelData.region || "Unknown" },
      ],
    },
  });
  if (existingKennel) return { error: `Kennel "${kennelData.shortName}" already exists` };

  // Create kennel
  const newKennel = await prisma.kennel.create({
    data: {
      kennelCode,
      shortName: kennelData.shortName,
      fullName: kennelData.fullName || kennelData.shortName,
      slug,
      region: kennelData.region || "Unknown",
      aliases: {
        create: tag !== kennelData.shortName ? [{ alias: tag }] : [],
      },
    },
  });

  // Link to source
  await prisma.sourceKennel.create({
    data: { sourceId, kennelId: newKennel.id },
  });

  // Auto-resolve any matching UNMATCHED_TAGS alert
  const matchingAlerts = await prisma.alert.findMany({
    where: {
      sourceId,
      type: "UNMATCHED_TAGS",
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });
  for (const alert of matchingAlerts) {
    const ctx = alert.context as { tags?: string[] } | null;
    if (ctx?.tags) {
      clearResolverCache();
      const remaining: string[] = [];
      for (const t of ctx.tags) {
        const result = await resolveKennelTag(t);
        if (!result.matched) remaining.push(t);
      }
      if (remaining.length === 0) {
        await prisma.alert.update({
          where: { id: alert.id },
          data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: admin.id },
        });
      }
    }
  }

  // Re-scrape to pick up previously skipped events
  clearResolverCache();
  await scrapeSource(sourceId, { force: true });

  revalidatePath("/admin/sources");
  revalidatePath(`/admin/sources/${sourceId}`);
  revalidatePath("/admin/alerts");
  revalidatePath("/admin/kennels");
  return { success: true };
}
