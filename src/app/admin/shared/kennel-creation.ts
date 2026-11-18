import { prisma } from "@/lib/db";
import type { DiscoveryStatus, Prisma as PrismaTypes } from "@/generated/prisma/client";
import { toSlug, toKennelCode } from "@/lib/kennel-utils";
import { generateAliases, dedupeAliases } from "@/lib/auto-aliases";
import { safeUrl } from "@/lib/safe-url";

export interface KennelFromDiscoveryData {
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
  // Half-Mind listing-only kennels: the other three are written only with `listingOnly`.
  listingOnly?: boolean;
  halfMindListingId?: string;
  facebookUrl?: string | null;
  scheduleNotes?: string | null;
}

export interface CreateFromDiscoveryOptions {
  /**
   * Mark the row ADDED only while it still has this status, inside the creating
   * transaction. Another admin's dismiss or link that lands first rolls the kennel back.
   */
  claimFromStatus?: DiscoveryStatus;
  /** The error returned when that claim fails. */
  claimRefusal?: string;
}

/**
 * Shared kennel creation from a KennelDiscovery record.
 * Used by the research, Hash Rego and Half-Mind discovery flows.
 *
 * @param discoveryId - KennelDiscovery record to mark as ADDED
 * @param adminId - ID of the admin user performing the action
 * @param data - Kennel fields
 * @param extraAliases - Additional aliases (e.g., Hash Rego slug)
 * @param opts - Optional conditional claim of the discovery row
 * @returns Created kennel ID or error string
 */
export async function createKennelFromDiscovery(
  discoveryId: string,
  adminId: string,
  data: KennelFromDiscoveryData,
  extraAliases: string[] = [],
  opts: CreateFromDiscoveryOptions = {},
): Promise<{ kennelId: string } | { error: string }> {
  const discovery = await prisma.kennelDiscovery.findUnique({ where: { id: discoveryId } });
  if (!discovery) return { error: "Discovery not found" };

  const slug = toSlug(data.shortName);
  const kennelCode = toKennelCode(data.shortName);

  const autoAliases = generateAliases(data.shortName, data.fullName);
  const allAliases = dedupeAliases([...autoAliases, ...extraAliases]);

  try {
    const kennel = await prisma.$transaction(async (tx: PrismaTypes.TransactionClient) => {
      const existing = await tx.kennel.findFirst({
        where: {
          OR: [{ kennelCode }, { slug }, { shortName: data.shortName, regionId: data.regionId }],
        },
      });
      if (existing) throw new Error(`Kennel "${data.shortName}" already exists`);

      const region = await tx.region.findUnique({
        where: { id: data.regionId },
        select: { name: true, country: true },
      });
      if (!region) throw new Error("Region not found");

      const created = await tx.kennel.create({
        data: {
          kennelCode,
          shortName: data.shortName,
          slug,
          fullName: data.fullName,
          region: region.name,
          regionRef: { connect: { id: data.regionId } },
          country: data.country || region.country || "USA",
          website: safeUrl(data.website),
          contactEmail: data.contactEmail || null,
          foundedYear: data.foundedYear || null,
          hashCash: data.hashCash || null,
          scheduleDayOfWeek: data.scheduleDayOfWeek || null,
          scheduleFrequency: data.scheduleFrequency || null,
          paymentLink: safeUrl(data.paymentLink),
          // Copy coordinates from discovery record (Hash Rego, research pipeline)
          latitude: discovery.latitude,
          longitude: discovery.longitude,
          ...(data.listingOnly && {
            listingOnly: true,
            halfMindListingId: data.halfMindListingId,
            facebookUrl: safeUrl(data.facebookUrl),
            scheduleNotes: data.scheduleNotes,
          }),
          aliases: {
            create: allAliases.map((alias) => ({ alias })),
          },
        },
      });

      const marked = {
        status: "ADDED" as const,
        matchedKennelId: created.id,
        processedBy: adminId,
        processedAt: new Date(),
      };
      if (opts.claimFromStatus) {
        const { count } = await tx.kennelDiscovery.updateMany({
          where: { id: discoveryId, status: opts.claimFromStatus },
          data: marked,
        });
        // Throwing rolls back the kennel created above.
        if (count === 0) throw new Error(opts.claimRefusal ?? "This discovery was already reviewed.");
      } else {
        await tx.kennelDiscovery.update({ where: { id: discoveryId }, data: marked });
      }

      return created;
    });

    return { kennelId: kennel.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
