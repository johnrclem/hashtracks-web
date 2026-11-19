"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { syncKennelDiscovery } from "@/pipeline/kennel-discovery";
import { normalizeTrailDay } from "@/adapters/hashrego/kennel-api";
import { createKennelFromDiscovery } from "@/app/admin/shared/kennel-creation";
import { HALF_MIND_EXTERNAL_SOURCE } from "@/lib/half-mind";
import { dismissHalfMindListing } from "@/app/admin/discovery/half-mind-actions";

/**
 * These actions record identity only: "this Hash Rego account is that kennel".
 * They never write a SourceKennel (what the HASHREGO scraper fetches is set by
 * the seed's `kennelSlugMap` or a data migration) and never turn a Hash Rego
 * slug into a global alias. Half-Mind rows have their own actions
 * (half-mind-actions.ts); Gemini rows come from Source Research.
 */
const HASH_REGO_SOURCE = "HASHREGO";
const HALF_MIND_ROW_ERROR = "Use the Half-Mind actions for Half-Mind rows.";
const NOT_HASH_REGO_ERROR = "This action is for Hash Rego rows only. Add research suggestions from Source Research.";

function isHalfMindRow(discovery: { externalSource: string }): boolean {
  return discovery.externalSource === HALF_MIND_EXTERNAL_SOURCE;
}

/** Why a Hash Rego-only action refuses this row, or null when it may proceed. */
function hashRegoOnlyRefusal(discovery: { externalSource: string }): string | null {
  if (isHalfMindRow(discovery)) return HALF_MIND_ROW_ERROR;
  if (discovery.externalSource !== HASH_REGO_SOURCE) return NOT_HASH_REGO_ERROR;
  return null;
}

/**
 * Stop scraping dismissed Hash Rego accounts: delete the HASHREGO SourceKennel
 * rows whose slug is one of `slugs` (case-insensitive). A kennel's link to a
 * different account is left alone.
 */
async function unlinkScrapedSlugs(slugs: string[]): Promise<void> {
  if (slugs.length === 0) return;
  const source = await prisma.source.findFirst({ where: { type: "HASHREGO" }, select: { id: true } });
  if (!source) return;
  await prisma.sourceKennel.deleteMany({
    where: {
      sourceId: source.id,
      OR: slugs.map((slug) => ({ externalSlug: { equals: slug, mode: "insensitive" as const } })),
    },
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

/** Record that a Hash Rego account is an existing kennel (identity only; doesn't start scraping). */
export async function linkDiscoveryToKennel(discoveryId: string, kennelId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const discovery = await prisma.kennelDiscovery.findUnique({
    where: { id: discoveryId },
  });
  if (!discovery) return { error: "Discovery not found" };
  const refusal = hashRegoOnlyRefusal(discovery);
  if (refusal) return { error: refusal };

  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { id: true },
  });
  if (!kennel) return { error: "Kennel not found" };

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
  return { success: true };
}

/** Create a new kennel from discovery data with profile pre-fill (doesn't start scraping). */
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
  const refusal = hashRegoOnlyRefusal(discovery);
  if (refusal) return { error: refusal };

  // No alias from the Hash Rego slug: slugs like "CH3" collide across regions.
  const result = await createKennelFromDiscovery(discoveryId, admin.id, data);
  if ("error" in result) return result;

  revalidatePath("/admin/discovery");
  revalidatePath("/admin/kennels");
  revalidatePath("/kennels");
  return { success: true, kennelId: result.kennelId };
}

/** Dismiss a discovery (mark as not relevant). */
export async function dismissDiscovery(id: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  // A dismissed Hash Rego account is no longer scraped. Only a link that holds
  // this row's own slug is removed, never a kennel's link to another account.
  const existing = await prisma.kennelDiscovery.findUnique({
    where: { id },
    select: { externalSource: true, externalSlug: true },
  });
  if (!existing) return { error: "Discovery not found" };
  if (isHalfMindRow(existing)) return dismissHalfMindListing(id);
  if (existing.externalSource === HASH_REGO_SOURCE) await unlinkScrapedSlugs([existing.externalSlug]);

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

  // Same rule as dismissDiscovery: stop scraping exactly the dismissed accounts.
  const existing = await prisma.kennelDiscovery.findMany({
    where: { id: { in: ids }, externalSource: HASH_REGO_SOURCE },
    select: { externalSlug: true },
  });
  await unlinkScrapedSlugs(existing.map((d) => d.externalSlug));

  // Linked and added Half-Mind rows are undone through their own actions.
  await prisma.kennelDiscovery.updateMany({
    where: {
      id: { in: ids },
      OR: [{ externalSource: { not: HALF_MIND_EXTERNAL_SOURCE } }, { status: "NEW" }],
    },
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

/** Confirm a suggested match (MATCHED → LINKED). Identity only; doesn't start scraping. */
export async function confirmMatch(id: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const discovery = await prisma.kennelDiscovery.findUnique({
    where: { id },
  });
  if (!discovery) return { error: "Discovery not found" };
  const refusal = hashRegoOnlyRefusal(discovery);
  if (refusal) return { error: refusal };
  if (discovery.status !== "MATCHED") return { error: "Can only confirm MATCHED discoveries" };
  if (!discovery.matchedKennelId) return { error: "No matched kennel" };

  await prisma.kennelDiscovery.update({
    where: { id },
    data: {
      status: "LINKED",
      processedBy: admin.id,
      processedAt: new Date(),
    },
  });

  revalidatePath("/admin/discovery");
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
        paymentInfo: true, externalSource: true,
      },
    }),
    prisma.region.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!discovery) return { error: "Discovery not found" };
  const refusal = hashRegoOnlyRefusal(discovery);
  if (refusal) return { error: refusal };

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
