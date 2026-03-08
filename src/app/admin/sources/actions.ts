"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { SourceType } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { resolveKennelTag, clearResolverCache } from "@/pipeline/kennel-resolver";
import { scrapeSource } from "@/pipeline/scrape";
import { validateSourceConfig } from "./config-validation";
import { buildKennelIdentifiers, createKennelRecord } from "@/lib/kennel-utils";

/** Type guard: is this a HASHREGO source config with an optional kennelSlugs array?
 *  When kennelSlugs is present, validates it is actually an array to guard against malformed JSON. */
function isHashRegoConfig(
  config: unknown,
  type: string,
): config is { kennelSlugs?: string[] } {
  if (type !== "HASHREGO" || !config || typeof config !== "object" || Array.isArray(config)) {
    return false;
  }
  const obj = config as Record<string, unknown>;
  // If kennelSlugs is present, it must be an array
  if ("kennelSlugs" in obj && !Array.isArray(obj.kennelSlugs)) {
    return false;
  }
  return true;
}

/**
 * For HASHREGO sources, resolve each configured kennelSlug to a Kennel record
 * and return their IDs so they can be auto-linked as SourceKennel records.
 */
async function resolveHashRegoSlugsToKennelIds(
  config: unknown,
  type: string,
): Promise<string[]> {
  if (!isHashRegoConfig(config, type)) return [];
  if (!config.kennelSlugs?.length) return [];

  clearResolverCache();
  const results = await Promise.all(
    config.kennelSlugs.map((slug) => resolveKennelTag(slug)),
  );
  return results
    .filter((r) => r.matched && r.kennelId)
    .map((r) => r.kennelId!);
}

/**
 * Combine form-selected kennel IDs with slug-resolved kennel IDs (HASHREGO auto-sync).
 * Returns a deduplicated array of kennel IDs.
 */
async function getCombinedKennelIds(
  kennelIdsStr: string,
  config: unknown,
  type: string,
): Promise<string[]> {
  const ids = kennelIdsStr
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const slugKennelIds = await resolveHashRegoSlugsToKennelIds(config, type);
  const idSet = new Set(ids);
  for (const kid of slugKennelIds) {
    idSet.add(kid);
  }
  return Array.from(idSet);
}

/**
 * For a HASHREGO source, fetch its config and add `slug` to kennelSlugs if missing.
 * No-op for non-HASHREGO sources or if slug already exists.
 * Uses a transaction to prevent TOCTOU races on the config read-modify-write.
 */
async function syncHashRegoSlug(sourceId: string, slug: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const source = await tx.source.findUnique({
      where: { id: sourceId },
      select: { type: true, config: true },
    });
    if (!source || !isHashRegoConfig(source.config, source.type)) return;

    const slugs = source.config.kennelSlugs ?? [];
    const upperSlug = slug.toUpperCase();
    if (slugs.some((s) => s.toUpperCase() === upperSlug)) return;

    await tx.source.update({
      where: { id: sourceId },
      data: { config: { ...source.config, kennelSlugs: [...slugs, upperSlug] } as Prisma.InputJsonValue },
    });
  });
}

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
  const trustLevel = Number.parseInt((formData.get("trustLevel") as string) || "5", 10);
  const scrapeFreq = (formData.get("scrapeFreq") as string)?.trim() || "daily";
  const scrapeDays = Number.parseInt((formData.get("scrapeDays") as string) || "90", 10);
  const configRaw = (formData.get("config") as string)?.trim() || "";
  const kennelIds = (formData.get("kennelIds") as string)?.trim() || "";
  if (!name || !url || !type) return { error: "Name, URL, and type are required" as const };
  if (Number.isNaN(trustLevel) || Number.isNaN(scrapeDays)) {
    return { error: "Trust level and scrape days must be numbers" as const };
  }
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

  // Create SourceKennel links (auto-include slug-resolved kennels for HASHREGO)
  const ids = await getCombinedKennelIds(kennelIds, config, type);
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

  // Auto-include slug-resolved kennels for HASHREGO sources
  const ids = await getCombinedKennelIds(kennelIds, config, type);

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

  // Auto-add slug to HASHREGO config if not already present
  await syncHashRegoSlug(sourceId, kennelTag);

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
  regionId: string;
}): Promise<
  | { success: true; id: string; shortName: string; fullName: string; region: string }
  | { success?: false; error: string }
> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const { shortName, fullName, regionId } = data;
  if (!shortName || !fullName || !regionId) {
    return { error: "shortName, fullName, and region are required" };
  }

  const regionRecord = await prisma.region.findUnique({
    where: { id: regionId },
    select: { id: true, name: true },
  });
  if (!regionRecord) return { error: "Region not found" };

  const { slug, kennelCode } = buildKennelIdentifiers(shortName);

  const [existingCode, existingSlug] = await Promise.all([
    prisma.kennel.findUnique({ where: { kennelCode } }),
    prisma.kennel.findUnique({ where: { slug } }),
  ]);
  if (existingCode || existingSlug) {
    return { error: `Kennel "${shortName}" already exists` };
  }

  const kennel = await prisma.kennel.create({
    data: { kennelCode, shortName, fullName, slug, region: regionRecord.name, regionRef: { connect: { id: regionRecord.id } } },
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

  // Auto-add slug to HASHREGO config if not already present
  await syncHashRegoSlug(sourceId, kennelData.shortName);

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
 * For HASHREGO sources, detect drift between config.kennelSlugs and SourceKennel links.
 * Resolves each slug via the kennel resolver (handles alias resolution) rather than
 * comparing slugs to shortNames directly (which would produce false positives).
 */
export type SlugDrift = {
  slugsWithoutLink: string[];
  linksWithoutSlug: Array<{ kennelId: string; shortName: string }>;
  /** Slug → resolved kennelId (null if unresolvable). Avoids redundant re-resolution. */
  slugToKennelId: Map<string, string | null>;
};

export async function getHashRegoSlugDrift(source: {
  type: string;
  config: unknown;
  kennels: Array<{ kennelId: string; kennel: { shortName: string } }>;
}): Promise<SlugDrift> {
  const empty: SlugDrift = { slugsWithoutLink: [], linksWithoutSlug: [], slugToKennelId: new Map() };
  if (!isHashRegoConfig(source.config, source.type)) return empty;

  const slugs = source.config.kennelSlugs ?? [];
  if (slugs.length === 0 && source.kennels.length === 0) return empty;

  const linkedKennelIds = new Set(source.kennels.map((sk) => sk.kennelId));

  // Resolve each slug to a kennel ID (handles alias resolution, e.g. "BFMH3" → kennel "BFM")
  clearResolverCache();
  const slugToKennelId = new Map<string, string | null>();
  for (const slug of slugs) {
    const result = await resolveKennelTag(slug);
    slugToKennelId.set(slug, result.matched ? result.kennelId : null);
  }

  // Slugs whose resolved kennel is not linked
  const slugsWithoutLink = slugs.filter((slug) => {
    const kennelId = slugToKennelId.get(slug);
    return !kennelId || !linkedKennelIds.has(kennelId);
  });

  // Linked kennels whose ID doesn't appear in any slug resolution
  const resolvedKennelIds = new Set(
    Array.from(slugToKennelId.values()).filter((id): id is string => id != null),
  );
  const linksWithoutSlug = source.kennels
    .filter((sk) => !resolvedKennelIds.has(sk.kennelId))
    .map((sk) => ({ kennelId: sk.kennelId, shortName: sk.kennel.shortName }));

  return { slugsWithoutLink, linksWithoutSlug, slugToKennelId };
}

/**
 * Preview data for the Hash Rego slug drift sync button.
 * For each linked kennel without a slug, looks up KennelDiscovery to find the Hash Rego slug.
 */
export type DriftPreviewRow = {
  kennelId: string;
  shortName: string;
  fullName: string;
  hashRegoSlug: string | null; // null = no discovery match, can't auto-fix
};

export type DriftPreview = {
  /** Slugs in config that don't resolve to a linked kennel */
  slugsWithoutLink: Array<{ slug: string; kennelId: string | null }>;
  /** Linked kennels missing from config.kennelSlugs */
  linksWithoutSlug: DriftPreviewRow[];
};

export async function getHashRegoDriftPreview(sourceId: string): Promise<DriftPreview> {
  const admin = await getAdminUser();
  if (!admin) throw new Error("Unauthorized");

  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: {
      type: true,
      config: true,
      kennels: { select: { kennelId: true, kennel: { select: { shortName: true, fullName: true } } } },
    },
  });
  if (!source) throw new Error("Source not found");

  const drift = await getHashRegoSlugDrift(source);

  // Use resolution results from drift — no need to re-resolve
  const slugsPreview = drift.slugsWithoutLink.map((slug) => ({
    slug,
    kennelId: drift.slugToKennelId.get(slug) ?? null,
  }));

  // For linksWithoutSlug, look up KennelDiscovery records to find Hash Rego slugs
  const missingKennelIds = drift.linksWithoutSlug.map((k) => k.kennelId);

  const fullNameMap = new Map<string, string>(
    source.kennels.map((sk) => [sk.kennelId, sk.kennel.fullName]),
  );

  const discoveries = missingKennelIds.length > 0
    ? await prisma.kennelDiscovery.findMany({
        where: {
          externalSource: "HASHREGO",
          matchedKennelId: { in: missingKennelIds },
        },
        select: { matchedKennelId: true, externalSlug: true },
      })
    : [];

  const discoveryMap = new Map<string, string>(discoveries.map((d) => [d.matchedKennelId!, d.externalSlug]));

  const linksPreview: DriftPreviewRow[] = drift.linksWithoutSlug.map((k) => ({
    kennelId: k.kennelId,
    shortName: k.shortName,
    fullName: fullNameMap.get(k.kennelId) ?? k.shortName,
    hashRegoSlug: discoveryMap.get(k.kennelId) ?? null,
  }));

  return { slugsWithoutLink: slugsPreview, linksWithoutSlug: linksPreview };
}

/**
 * Fix Hash Rego slug/link drift:
 * - slugsWithoutLink: create SourceKennel links for resolvable slugs
 * - linksWithoutSlug with hashRegoSlug: add the Hash Rego slug to config.kennelSlugs
 * - linksWithoutSlug without hashRegoSlug: unlink the SourceKennel (not on Hash Rego)
 */
export async function syncHashRegoDrift(
  sourceId: string,
): Promise<{ linksCreated: number; slugsAdded: number; unlinked: number; unresolved: string[] }> {
  const preview = await getHashRegoDriftPreview(sourceId);

  let linksCreated = 0;
  let unlinked = 0;
  const unresolved: string[] = [];

  // Fix slugsWithoutLink: create SourceKennel links using pre-resolved kennelIds
  for (const { slug, kennelId } of preview.slugsWithoutLink) {
    if (!kennelId) {
      unresolved.push(slug);
      continue;
    }
    try {
      await prisma.sourceKennel.create({
        data: { sourceId, kennelId },
      });
      linksCreated++;
    } catch (e) {
      // Unique constraint violation = already linked (race condition)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        continue;
      }
      throw e;
    }
  }

  // Fix linksWithoutSlug: batch-add Hash Rego slugs to config in one transaction, or unlink orphans
  const slugsToAdd = preview.linksWithoutSlug
    .filter((row) => row.hashRegoSlug)
    .map((row) => row.hashRegoSlug!);

  if (slugsToAdd.length > 0) {
    await prisma.$transaction(async (tx) => {
      const source = await tx.source.findUnique({
        where: { id: sourceId },
        select: { type: true, config: true },
      });
      if (!source || !isHashRegoConfig(source.config, source.type)) return;

      const existing = new Set((source.config.kennelSlugs ?? []).map((s) => s.toUpperCase()));
      const newSlugs = slugsToAdd
        .map((s) => s.toUpperCase())
        .filter((s) => !existing.has(s));

      if (newSlugs.length > 0) {
        await tx.source.update({
          where: { id: sourceId },
          data: {
            config: {
              ...source.config,
              kennelSlugs: [...(source.config.kennelSlugs ?? []), ...newSlugs],
            } as Prisma.InputJsonValue,
          },
        });
      }
    });
  }

  // Unlink orphans (linked kennels with no Hash Rego slug)
  const orphanKennelIds = preview.linksWithoutSlug
    .filter((row) => !row.hashRegoSlug)
    .map((row) => row.kennelId);

  if (orphanKennelIds.length > 0) {
    const { count } = await prisma.sourceKennel.deleteMany({
      where: { sourceId, kennelId: { in: orphanKennelIds } },
    });
    unlinked = count;
  }

  revalidatePath(`/admin/sources/${sourceId}`);
  return { linksCreated, slugsAdded: slugsToAdd.length, unlinked, unresolved };
}
