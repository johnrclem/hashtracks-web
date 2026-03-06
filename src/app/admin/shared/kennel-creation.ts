import { prisma } from "@/lib/db";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
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
}

/**
 * Shared kennel creation from a KennelDiscovery record.
 * Used by both research and Hash Rego discovery flows.
 *
 * @param discoveryId - KennelDiscovery record to mark as ADDED
 * @param adminId - ID of the admin user performing the action
 * @param data - Kennel fields
 * @param extraAliases - Additional aliases (e.g., Hash Rego slug)
 * @returns Created kennel ID or error string
 */
export async function createKennelFromDiscovery(
  discoveryId: string,
  adminId: string,
  data: KennelFromDiscoveryData,
  extraAliases: string[] = [],
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
          aliases: {
            create: allAliases.map((alias) => ({ alias })),
          },
        },
      });

      await tx.kennelDiscovery.update({
        where: { id: discoveryId },
        data: {
          status: "ADDED",
          matchedKennelId: created.id,
          processedBy: adminId,
          processedAt: new Date(),
        },
      });

      return created;
    });

    return { kennelId: kennel.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
