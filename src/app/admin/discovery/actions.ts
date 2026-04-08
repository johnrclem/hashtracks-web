"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  syncKennelDiscovery,
  linkDiscoveryKennelToHashRego,
} from "@/pipeline/kennel-discovery";
import { clearResolverCache } from "@/pipeline/kennel-resolver";
import { normalizeTrailDay } from "@/adapters/hashrego/kennel-api";
import { createKennelFromDiscovery } from "@/app/admin/shared/kennel-creation";

/** Look up the HASHREGO source id (null if none configured). */
async function getHashRegoSourceId(): Promise<string | null> {
  const source = await prisma.source.findFirst({
    where: { type: "HASHREGO" },
    select: { id: true },
  });
  return source?.id ?? null;
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

  const hashRegoSourceId = await getHashRegoSourceId();
  await linkDiscoveryKennelToHashRego(kennelId, discovery.externalSlug, hashRegoSourceId);
  clearResolverCache();

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

  try {
    const hashRegoSourceId = await getHashRegoSourceId();
    await linkDiscoveryKennelToHashRego(result.kennelId, discovery.externalSlug, hashRegoSourceId);
  } catch (err) {
    console.error("[discovery] Failed to link kennel to Hash Rego source:", err);
  }
  clearResolverCache();

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

  // If this discovery was auto-linked (previous status MATCHED), drop the
  // stale SourceKennel row so the scraper stops routing to that kennel.
  // LINKED / ADDED rows are admin-confirmed and intentionally untouched.
  const existing = await prisma.kennelDiscovery.findUnique({
    where: { id },
    select: { status: true, matchedKennelId: true },
  });
  if (existing?.status === "MATCHED" && existing.matchedKennelId) {
    const hashRegoSourceId = await getHashRegoSourceId();
    if (hashRegoSourceId) {
      await prisma.sourceKennel.deleteMany({
        where: { sourceId: hashRegoSourceId, kennelId: existing.matchedKennelId },
      });
    }
  }

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

  // Same guardrail as dismissDiscovery — only strip auto-link SourceKennel
  // rows for rows whose previous status was MATCHED.
  const existing = await prisma.kennelDiscovery.findMany({
    where: { id: { in: ids } },
    select: { status: true, matchedKennelId: true },
  });
  const autoLinkedKennelIds = existing
    .filter((d) => d.status === "MATCHED" && d.matchedKennelId !== null)
    .map((d) => d.matchedKennelId as string);
  if (autoLinkedKennelIds.length > 0) {
    const hashRegoSourceId = await getHashRegoSourceId();
    if (hashRegoSourceId) {
      await prisma.sourceKennel.deleteMany({
        where: { sourceId: hashRegoSourceId, kennelId: { in: autoLinkedKennelIds } },
      });
    }
  }

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

  const hashRegoSourceId = await getHashRegoSourceId();
  await linkDiscoveryKennelToHashRego(
    discovery.matchedKennelId,
    discovery.externalSlug,
    hashRegoSourceId,
  );
  clearResolverCache();

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
