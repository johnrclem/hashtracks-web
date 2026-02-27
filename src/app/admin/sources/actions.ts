"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { SourceType } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { resolveKennelTag, clearResolverCache } from "@/pipeline/kennel-resolver";
import { scrapeSource } from "@/pipeline/scrape";
import { validateSourceConfig } from "./config-validation";
import { buildKennelIdentifiers, resolveRegionByName, createKennelRecord } from "@/lib/kennel-utils";

/** Parse and validate config JSON from form input. Returns the parsed value or an error. */
function parseConfigJson(
  configRaw: string,
  type: string,
  clearOnEmpty: boolean,
): { config: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined; error?: string } {
  if (!configRaw) {
    return { config: clearOnEmpty ? Prisma.DbNull : undefined };
  }
  try {
    const config = JSON.parse(configRaw) as Prisma.InputJsonValue;
    const configErrors = validateSourceConfig(type, config);
    if (configErrors.length > 0) {
      return { config: undefined, error: `Config validation failed: ${configErrors.join("; ")}` };
    }
    return { config };
  } catch {
    return { config: undefined, error: "Invalid JSON in config field" };
  }
}

/**
 * Auto-resolve UNMATCHED_TAGS alerts for a source when all tags are now resolvable.
 */
async function autoResolveUnmatchedAlerts(sourceId: string, adminId: string): Promise<void> {
  const matchingAlerts = await prisma.alert.findMany({
    where: {
      sourceId,
      type: "UNMATCHED_TAGS",
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });
  for (const alert of matchingAlerts) {
    const ctx = alert.context as { tags?: string[] } | null;
    if (!ctx?.tags) continue;

    clearResolverCache();
    const remaining: string[] = [];
    for (const t of ctx.tags) {
      const result = await resolveKennelTag(t);
      if (!result.matched) remaining.push(t);
    }
    if (remaining.length === 0) {
      await prisma.alert.update({
        where: { id: alert.id },
        data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: adminId },
      });
    }
  }
}


function parseSourceFormData(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const url = (formData.get("url") as string)?.trim();
  const type = (formData.get("type") as string)?.trim();
  const trustLevel = parseInt((formData.get("trustLevel") as string) || "5", 10);
  const scrapeFreq = (formData.get("scrapeFreq") as string)?.trim() || "daily";
  const scrapeDays = parseInt((formData.get("scrapeDays") as string) || "90", 10);
  const configRaw = (formData.get("config") as string)?.trim() || "";
  const kennelIds = (formData.get("kennelIds") as string)?.trim() || "";
  if (!name || !url || !type) return { error: "Name, URL, and type are required" as const };
  return { name, url, type, trustLevel, scrapeFreq, scrapeDays, configRaw, kennelIds };
}

export async function createSource(formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const parsed = parseSourceFormData(formData);
  if ("error" in parsed) return parsed;
  const { name, url, type, trustLevel, scrapeFreq, scrapeDays, configRaw, kennelIds } = parsed;

  const { config, error: configError } = parseConfigJson(configRaw, type, false);
  if (configError) return { error: configError };

  // Also validate if config was empty but type requires it
  if (config === undefined) {
    const emptyConfigErrors = validateSourceConfig(type, null);
    if (emptyConfigErrors.length > 0) {
      return { error: `Config validation failed: ${emptyConfigErrors.join("; ")}` };
    }
  }

  const source = await prisma.source.create({
    data: {
      name,
      url,
      type: type as SourceType,
      trustLevel,
      scrapeFreq,
      scrapeDays: isNaN(scrapeDays) ? 90 : scrapeDays,
      ...(config !== undefined ? { config } : {}),
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

  const parsed = parseSourceFormData(formData);
  if ("error" in parsed) return parsed;
  const { name, url, type, trustLevel, scrapeFreq, scrapeDays, configRaw, kennelIds } = parsed;

  const { config, error: configError } = parseConfigJson(configRaw, type, true);
  if (configError) return { error: configError };

  // Validate that types requiring config aren't saved with empty config
  if (config === Prisma.DbNull) {
    const emptyConfigErrors = validateSourceConfig(type, null);
    if (emptyConfigErrors.length > 0) {
      return { error: `Config validation failed: ${emptyConfigErrors.join("; ")}` };
    }
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
        type: type as SourceType,
        trustLevel,
        scrapeFreq,
        scrapeDays: isNaN(scrapeDays) ? 90 : scrapeDays,
        config,
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

  await autoResolveUnmatchedAlerts(sourceId, admin.id);

  clearResolverCache();
  await scrapeSource(sourceId, { force: true });

  revalidatePath("/admin/sources");
  revalidatePath(`/admin/sources/${sourceId}`);
  revalidatePath("/admin/alerts");
  revalidatePath("/admin/kennels");
  return { success: true };
}

/**
 * Toggle a source's enabled state. Disabled sources are skipped by cron.
 */
export async function toggleSourceEnabled(sourceId: string, enabled: boolean) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  await prisma.source.update({
    where: { id: sourceId },
    data: { enabled },
  });

  revalidatePath("/admin/sources");
  return { success: true };
}

/**
 * Quick-create a kennel from the source form (no aliases or profile fields).
 * Returns the new kennel id + display fields so the caller can auto-link it.
 */
export async function createQuickKennel(data: {
  shortName: string;
  fullName: string;
  region: string;
}): Promise<
  | { success: true; id: string; shortName: string; fullName: string; region: string }
  | { success?: false; error: string }
> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const { shortName, fullName, region } = data;
  if (!shortName || !fullName || !region) {
    return { error: "shortName, fullName, and region are required" };
  }

  const regionRecord = await resolveRegionByName(region);
  if (!regionRecord) return { error: `Region "${region}" not found — create it first in Admin → Regions` };

  const { slug, kennelCode } = buildKennelIdentifiers(shortName);

  const [existingCode, existingSlug] = await Promise.all([
    prisma.kennel.findUnique({ where: { kennelCode } }),
    prisma.kennel.findUnique({ where: { slug } }),
  ]);
  if (existingCode || existingSlug) {
    return { error: `Kennel "${shortName}" already exists` };
  }

  const kennel = await prisma.kennel.create({
    data: { kennelCode, shortName, fullName, slug, region, regionRef: { connect: { id: regionRecord.id } } },
  });

  revalidatePath("/admin/kennels");
  return {
    success: true,
    id: kennel.id,
    shortName: kennel.shortName,
    fullName: kennel.fullName,
    region: kennel.region,
  };
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

  const result = await createKennelRecord(kennelData, tag);
  if ("error" in result) return result;

  // Link to source
  await prisma.sourceKennel.create({
    data: { sourceId, kennelId: result.kennelId },
  });

  await autoResolveUnmatchedAlerts(sourceId, admin.id);

  clearResolverCache();
  await scrapeSource(sourceId, { force: true });

  revalidatePath("/admin/sources");
  revalidatePath(`/admin/sources/${sourceId}`);
  revalidatePath("/admin/alerts");
  revalidatePath("/admin/kennels");
  return { success: true };
}
