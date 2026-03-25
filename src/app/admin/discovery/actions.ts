"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { syncKennelDiscovery } from "@/pipeline/kennel-discovery";
import { clearResolverCache } from "@/pipeline/kennel-resolver";
import { normalizeTrailDay } from "@/adapters/hashrego/kennel-api";
import { createKennelFromDiscovery } from "@/app/admin/shared/kennel-creation";

/**
 * Create an alias for a kennel if it doesn't already exist.
 * Uses create-with-catch to handle concurrent requests safely (P2002 = unique violation).
 * Clears the resolver cache so the merge pipeline recognizes new aliases immediately.
 */
async function ensureAlias(kennelId: string, alias: string): Promise<void> {
  try {
    await prisma.kennelAlias.create({
      data: { kennelId, alias },
    });
    clearResolverCache();
  } catch (e: unknown) {
    // P2002 = unique constraint violation — alias already exists, safe to ignore
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }
}

/**
 * Link a kennel to the Hash Rego event source so its events flow into the hareline.
 * Creates a SourceKennel join record with the externalSlug for kennel routing.
 * No-op if no HASHREGO source exists. Idempotent (upsert handles duplicates).
 */
async function linkKennelToHashRegoSource(
  kennelId: string,
  externalSlug: string,
): Promise<void> {
  const source = await prisma.source.findFirst({
    where: { type: "HASHREGO" },
    select: { id: true },
  });
  if (!source) return;

  await prisma.sourceKennel.upsert({
    where: { sourceId_kennelId: { sourceId: source.id, kennelId } },
    update: { externalSlug },
    create: { sourceId: source.id, kennelId, externalSlug },
  });
}

/** Run a full discovery sync: parse directory → enrich via API → fuzzy match → upsert. */
export async function runDiscoverySync() {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  try {
    const result = await syncKennelDiscovery();
    revalidatePath("/admin/discovery");
    const sanitizedErrors = (result.errors ?? []).map((e: string) => {
      const match = e.match(/^Error processing ([^:]+)/);
      return match ? `Failed to enrich ${match[1]}` : "Enrichment error";
    });
    return { success: true, ...result, errors: sanitizedErrors };
  } catch (err) {
    return { error: `Sync failed: ${err}` };
  }
}

/** Link a discovery to an existing kennel. Creates alias if slug differs from shortName. */
export async function linkDiscoveryToKennel(discoveryId: string, kennelId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const discovery = await prisma.kennelDiscovery.findUnique({
    where: { id: discoveryId },
  });
  if (!discovery) return { error: "Discovery not found" };

  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { id: true, shortName: true },
  });
  if (!kennel) return { error: "Kennel not found" };

  // Create alias if the Hash Rego slug differs from the kennel's shortName
  if (discovery.externalSlug.toLowerCase() !== kennel.shortName.toLowerCase()) {
    await ensureAlias(kennelId, discovery.externalSlug);
  }

  await linkKennelToHashRegoSource(kennelId, discovery.externalSlug);

  await prisma.kennelDiscovery.update({
    where: { id: discoveryId },
    data: {
      status: "LINKED",
      matchedKennelId: kennelId,
      processedBy: admin.id,
      processedAt: new Date(),
    },
  });

  revalidatePath("/admin/discovery");
  revalidatePath("/admin/sources");
  return { success: true };
}

/** Create a new kennel from discovery data with profile pre-fill. */
export async function addKennelFromDiscovery(
  discoveryId: string,
  data: {
    shortName: string;
    fullName: string;
    regionId: string;
    country?: string;
    website?: string;
    contactEmail?: string;
    foundedYear?: number;
    hashCash?: string;
    scheduleDayOfWeek?: string;
    scheduleFrequency?: string;
    paymentLink?: string;
  },
) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const discovery = await prisma.kennelDiscovery.findUnique({
    where: { id: discoveryId },
  });
  if (!discovery) return { error: "Discovery not found" };

  // Add the Hash Rego slug as an extra alias if it differs from shortName
  const extraAliases: string[] = [];
  if (discovery.externalSlug.toLowerCase() !== data.shortName.toLowerCase()) {
    extraAliases.push(discovery.externalSlug);
  }

  const result = await createKennelFromDiscovery(discoveryId, admin.id, data, extraAliases);
  if ("error" in result) return result;

  clearResolverCache();

  try {
    await linkKennelToHashRegoSource(result.kennelId, discovery.externalSlug);
  } catch (err) {
    console.error("[discovery] Failed to link kennel to Hash Rego source:", err);
  }

  revalidatePath("/admin/discovery");
  revalidatePath("/admin/kennels");
  revalidatePath("/admin/sources");
  revalidatePath("/kennels");
  return { success: true, kennelId: result.kennelId };
}

/** Dismiss a discovery (mark as not relevant). */
export async function dismissDiscovery(id: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  await prisma.kennelDiscovery.update({
    where: { id },
    data: {
      status: "DISMISSED",
      processedBy: admin.id,
      processedAt: new Date(),
    },
  });

  revalidatePath("/admin/discovery");
  return { success: true };
}

/** Bulk dismiss multiple discoveries. */
export async function bulkDismissDiscoveries(ids: string[]) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  await prisma.kennelDiscovery.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "DISMISSED",
      processedBy: admin.id,
      processedAt: new Date(),
    },
  });

  revalidatePath("/admin/discovery");
  return { success: true };
}

/** Undo a dismissal — reset to NEW for re-evaluation. */
export async function undismissDiscovery(id: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const discovery = await prisma.kennelDiscovery.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!discovery) return { error: "Discovery not found" };
  if (discovery.status !== "DISMISSED") return { error: "Can only undo dismissed discoveries" };

  await prisma.kennelDiscovery.update({
    where: { id },
    data: {
      status: "NEW",
      processedBy: null,
      processedAt: null,
    },
  });

  revalidatePath("/admin/discovery");
  return { success: true };
}

/** Confirm an auto-matched discovery (MATCHED → LINKED). */
export async function confirmMatch(id: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const discovery = await prisma.kennelDiscovery.findUnique({
    where: { id },
  });
  if (!discovery) return { error: "Discovery not found" };
  if (discovery.status !== "MATCHED") return { error: "Can only confirm MATCHED discoveries" };
  if (!discovery.matchedKennelId) return { error: "No matched kennel" };

  // Create alias if slug differs
  const kennel = await prisma.kennel.findUnique({
    where: { id: discovery.matchedKennelId },
    select: { shortName: true },
  });
  if (kennel && discovery.externalSlug.toLowerCase() !== kennel.shortName.toLowerCase()) {
    await ensureAlias(discovery.matchedKennelId, discovery.externalSlug);
  }

  await linkKennelToHashRegoSource(discovery.matchedKennelId, discovery.externalSlug);

  await prisma.kennelDiscovery.update({
    where: { id },
    data: {
      status: "LINKED",
      processedBy: admin.id,
      processedAt: new Date(),
    },
  });

  revalidatePath("/admin/discovery");
  revalidatePath("/admin/sources");
  return { success: true };
}

/** Get pre-filled kennel data from a discovery record for the "Add Kennel" dialog. */
export async function getDiscoveryPrefill(discoveryId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const [discovery, allRegions] = await Promise.all([
    prisma.kennelDiscovery.findUnique({
      where: { id: discoveryId },
      select: {
        externalSlug: true, name: true, website: true, contactEmail: true,
        yearStarted: true, trailPrice: true, schedule: true, location: true,
        paymentInfo: true,
      },
    }),
    prisma.region.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!discovery) return { error: "Discovery not found" };

  // Try to find a matching region by location string (in-memory match)
  let suggestedRegionId: string | null = null;
  if (discovery.location) {
    const locationParts = discovery.location.split(",").map((s) => s.trim());
    for (const part of locationParts) {
      const match = allRegions.find((r) =>
        r.name.toLowerCase().includes(part.toLowerCase()),
      );
      if (match) {
        suggestedRegionId = match.id;
        break;
      }
    }
  }

  // Parse schedule "Weekly, Saturdays" into separate fields
  let scheduleFrequency: string | null = null;
  let scheduleDayOfWeek: string | null = null;
  if (discovery.schedule) {
    const parts = discovery.schedule.split(",").map((s) => s.trim());
    if (parts.length >= 2) {
      scheduleFrequency = parts[0];
      scheduleDayOfWeek = normalizeTrailDay(parts[1]) || parts[1];
    } else if (parts.length === 1) {
      scheduleFrequency = parts[0];
    }
  }

  // Construct payment link from paymentInfo JSON (validate shape before string ops)
  let paymentLink: string | null = null;
  const raw = discovery.paymentInfo;
  const pi =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  const venmo = typeof pi?.venmo === "string" ? pi.venmo : null;
  const paypal = typeof pi?.paypal === "string" ? pi.paypal : null;
  const squareCash = typeof pi?.squareCash === "string" ? pi.squareCash : null;

  if (venmo) {
    paymentLink = `https://venmo.com/${venmo.replace("@", "")}`;
  } else if (paypal) {
    paymentLink = `https://paypal.me/${paypal}`;
  } else if (squareCash) {
    paymentLink = `https://cash.app/${squareCash}`;
  }

  return {
    success: true,
    prefill: {
      shortName: discovery.externalSlug,
      fullName: discovery.name,
      website: discovery.website,
      contactEmail: discovery.contactEmail,
      foundedYear: discovery.yearStarted,
      hashCash: discovery.trailPrice != null ? `$${discovery.trailPrice}` : null,
      scheduleFrequency,
      scheduleDayOfWeek,
      location: discovery.location,
      suggestedRegionId,
      paymentLink,
    },
  };
}
