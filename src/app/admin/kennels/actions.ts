"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { fuzzyMatch } from "@/lib/fuzzy";

function toSlug(shortName: string): string {
  return shortName
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

interface SimilarKennel {
  id: string;
  shortName: string;
  slug: string;
  fullName: string;
  score: number;
}

/**
 * Find kennels with similar names using fuzzy matching.
 * Returns top 3 matches with score > 0.6 (60% similarity threshold).
 */
export async function findSimilarKennels(shortName: string): Promise<SimilarKennel[]> {
  const allKennels = await prisma.kennel.findMany({
    select: { id: true, shortName: true, slug: true, fullName: true },
  });

  const matches = fuzzyMatch(
    shortName,
    allKennels.map((k) => ({ id: k.id, shortName: k.shortName, fullName: k.fullName })),
    3, // Top 3 matches
  );

  // Filter to only high-confidence matches (score > 0.6 = 60% similarity)
  const similar = matches
    .filter((m) => m.score > 0.6)
    .map((m) => {
      const kennel = allKennels.find((k) => k.id === m.id)!;
      return {
        id: kennel.id,
        shortName: kennel.shortName,
        slug: kennel.slug,
        fullName: kennel.fullName,
        score: m.score,
      };
    });

  return similar;
}

export async function createKennel(formData: FormData, force: boolean = false) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const shortName = (formData.get("shortName") as string)?.trim();
  const fullName = (formData.get("fullName") as string)?.trim();
  const region = (formData.get("region") as string)?.trim();
  const country = (formData.get("country") as string)?.trim() || "USA";
  const description = (formData.get("description") as string)?.trim() || null;
  const website = (formData.get("website") as string)?.trim() || null;
  const aliasesRaw = (formData.get("aliases") as string)?.trim() || "";

  if (!shortName || !fullName || !region) {
    return { error: "Short name, full name, and region are required" };
  }

  const slug = toSlug(shortName);

  // Check uniqueness
  const existing = await prisma.kennel.findFirst({
    where: { OR: [{ shortName }, { slug }] },
  });
  if (existing) {
    return { error: "A kennel with that short name already exists" };
  }

  // Check for similar kennels (fuzzy matching) unless force=true
  if (!force) {
    const similar = await findSimilarKennels(shortName);
    if (similar.length > 0) {
      return {
        warning: "Similar kennel(s) found",
        similarKennels: similar,
      };
    }
  }

  const aliases = aliasesRaw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  await prisma.kennel.create({
    data: {
      shortName,
      slug,
      fullName,
      region,
      country,
      description,
      website,
      aliases: {
        create: aliases.map((alias) => ({ alias })),
      },
    },
  });

  revalidatePath("/admin/kennels");
  revalidatePath("/kennels");
  return { success: true };
}

export async function updateKennel(kennelId: string, formData: FormData) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const shortName = (formData.get("shortName") as string)?.trim();
  const fullName = (formData.get("fullName") as string)?.trim();
  const region = (formData.get("region") as string)?.trim();
  const country = (formData.get("country") as string)?.trim() || "USA";
  const description = (formData.get("description") as string)?.trim() || null;
  const website = (formData.get("website") as string)?.trim() || null;
  const aliasesRaw = (formData.get("aliases") as string)?.trim() || "";

  if (!shortName || !fullName || !region) {
    return { error: "Short name, full name, and region are required" };
  }

  const slug = toSlug(shortName);

  // Check uniqueness (exclude current kennel)
  const existing = await prisma.kennel.findFirst({
    where: {
      OR: [{ shortName }, { slug }],
      NOT: { id: kennelId },
    },
  });
  if (existing) {
    return { error: "A kennel with that short name already exists" };
  }

  // If shortName changed, auto-add the old name as an alias so the resolver can still match it
  const current = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { shortName: true },
  });

  const newAliases = aliasesRaw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  if (current && current.shortName !== shortName) {
    const oldNameLower = current.shortName.toLowerCase();
    const alreadyIncluded = newAliases.some((a) => a.toLowerCase() === oldNameLower);
    if (!alreadyIncluded) {
      newAliases.push(current.shortName);
    }
  }

  // Replace all aliases: delete existing, create new
  await prisma.$transaction([
    prisma.kennelAlias.deleteMany({ where: { kennelId } }),
    prisma.kennel.update({
      where: { id: kennelId },
      data: {
        shortName,
        slug,
        fullName,
        region,
        country,
        description,
        website,
        aliases: {
          create: newAliases.map((alias) => ({ alias })),
        },
      },
    }),
  ]);

  revalidatePath("/admin/kennels");
  revalidatePath("/kennels");
  return { success: true };
}

export async function deleteKennel(kennelId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  // Check for events or members
  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    include: {
      _count: { select: { events: true, members: true } },
    },
  });

  if (!kennel) return { error: "Kennel not found" };

  if (kennel._count.events > 0) {
    return {
      error: `Cannot delete: kennel has ${kennel._count.events} event(s). Remove events first.`,
    };
  }

  if (kennel._count.members > 0) {
    return {
      error: `Cannot delete: kennel has ${kennel._count.members} subscriber(s). Remove subscribers first.`,
    };
  }

  // Delete aliases, source links, then kennel
  await prisma.$transaction([
    prisma.kennelAlias.deleteMany({ where: { kennelId } }),
    prisma.sourceKennel.deleteMany({ where: { kennelId } }),
    prisma.kennel.delete({ where: { id: kennelId } }),
  ]);

  revalidatePath("/admin/kennels");
  revalidatePath("/kennels");
  return { success: true };
}

/**
 * Assign misman role to a user for a kennel (site admin only).
 */
export async function assignMismanRole(kennelId: string, userId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { slug: true },
  });
  if (!kennel) return { error: "Kennel not found" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return { error: "User not found" };

  await prisma.userKennel.upsert({
    where: { userId_kennelId: { userId, kennelId } },
    update: { role: "MISMAN" },
    create: { userId, kennelId, role: "MISMAN" },
  });

  revalidatePath("/admin/kennels");
  revalidatePath(`/kennels/${kennel.slug}`);
  revalidatePath("/misman");
  return { success: true };
}

/**
 * Revoke misman role from a user (downgrade to MEMBER). Site admin only.
 */
export async function revokeMismanRole(kennelId: string, userId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const membership = await prisma.userKennel.findUnique({
    where: { userId_kennelId: { userId, kennelId } },
  });
  if (!membership) return { error: "User is not a member of this kennel" };

  if (membership.role === "MEMBER") {
    return { error: "User does not have misman access" };
  }

  await prisma.userKennel.update({
    where: { userId_kennelId: { userId, kennelId } },
    data: { role: "MEMBER" },
  });

  revalidatePath("/admin/kennels");
  revalidatePath("/misman");
  return { success: true };
}

interface MergePreviewCounts {
  events: number;
  subscriptions: number;
  rosterEntries: number;
  mismanRequests: number;
  sourceLinks: number;
  aliases: number;
}

interface MergeConflict {
  type: "event_date" | "other";
  message: string;
  details?: string[];
}

interface MergeResult {
  success?: boolean;
  error?: string;
  preview?: {
    source: { id: string; shortName: string; slug: string };
    target: { id: string; shortName: string; slug: string };
    counts: MergePreviewCounts;
    conflicts: MergeConflict[];
  };
}

/**
 * Merge two kennels: move all records from source to target, then delete source.
 * @param sourceKennelId - Kennel to merge FROM (will be deleted)
 * @param targetKennelId - Kennel to merge TO (will keep)
 * @param preview - If true, only returns preview without executing merge
 */
export async function mergeKennels(
  sourceKennelId: string,
  targetKennelId: string,
  preview: boolean = true
): Promise<MergeResult> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  // 1. Load both kennels with counts
  const sourceKennel = await prisma.kennel.findUnique({
    where: { id: sourceKennelId },
    include: {
      _count: {
        select: {
          events: true,
          members: true,
          kennelHashers: true,
          mismanRequests: true,
          sources: true,
          aliases: true,
        },
      },
    },
  });

  const targetKennel = await prisma.kennel.findUnique({
    where: { id: targetKennelId },
    select: { id: true, shortName: true, slug: true },
  });

  if (!sourceKennel) return { error: "Source kennel not found" };
  if (!targetKennel) return { error: "Target kennel not found" };

  if (sourceKennel.id === targetKennel.id) {
    return { error: "Cannot merge a kennel with itself" };
  }

  // 2. Detect conflicts
  const conflicts: MergeConflict[] = [];

  // Check for Event date conflicts
  const eventDates = await prisma.event.findMany({
    where: { kennelId: sourceKennel.id },
    select: { date: true },
  });

  const existingEventDates = await prisma.event.findMany({
    where: {
      kennelId: targetKennel.id,
      date: { in: eventDates.map((e) => e.date) },
    },
    select: { date: true },
  });

  if (existingEventDates.length > 0) {
    conflicts.push({
      type: "event_date",
      message: `${existingEventDates.length} event(s) have conflicting dates`,
      details: existingEventDates.map((e) => e.date.toISOString().split("T")[0]),
    });
  }

  // 3. If preview mode, return counts + conflicts
  if (preview) {
    return {
      success: true,
      preview: {
        source: {
          id: sourceKennel.id,
          shortName: sourceKennel.shortName,
          slug: sourceKennel.slug,
        },
        target: {
          id: targetKennel.id,
          shortName: targetKennel.shortName,
          slug: targetKennel.slug,
        },
        counts: {
          events: sourceKennel._count.events,
          subscriptions: sourceKennel._count.members,
          rosterEntries: sourceKennel._count.kennelHashers,
          mismanRequests: sourceKennel._count.mismanRequests,
          sourceLinks: sourceKennel._count.sources,
          aliases: sourceKennel._count.aliases,
        },
        conflicts,
      },
    };
  }

  // 4. Execute merge (block if conflicts exist)
  if (conflicts.length > 0) {
    return { error: "Cannot proceed with merge due to conflicts. Please resolve manually." };
  }

  // 5. Handle UserKennel duplicates
  const userKennelDuplicates = await prisma.userKennel.findMany({
    where: { kennelId: sourceKennel.id },
    select: { id: true, role: true, userId: true },
  });

  const roleRank: Record<string, number> = { ADMIN: 3, MISMAN: 2, MEMBER: 1 };

  for (const uk of userKennelDuplicates) {
    const existingSubscription = await prisma.userKennel.findUnique({
      where: {
        userId_kennelId: { userId: uk.userId, kennelId: targetKennel.id },
      },
      select: { id: true, role: true },
    });

    if (existingSubscription) {
      const sourceRank = roleRank[uk.role] || 0;
      const targetRank = roleRank[existingSubscription.role] || 0;

      if (sourceRank > targetRank) {
        await prisma.userKennel.update({
          where: { id: existingSubscription.id },
          data: { role: uk.role },
        });
      }

      await prisma.userKennel.delete({ where: { id: uk.id } });
    }
  }

  // 6. Handle KennelHasher duplicates (by hashName, case-insensitive)
  const hashers = await prisma.kennelHasher.findMany({
    where: { kennelId: sourceKennel.id },
    select: {
      id: true,
      hashName: true,
      nerdName: true,
      email: true,
      phone: true,
      notes: true,
    },
  });

  for (const hasher of hashers) {
    const existing = await prisma.kennelHasher.findFirst({
      where: {
        kennelId: targetKennel.id,
        hashName: { equals: hasher.hashName, mode: "insensitive" },
      },
    });

    if (existing) {
      const sourceComplete = [hasher.email, hasher.phone, hasher.notes].filter(
        Boolean,
      ).length;
      const targetComplete = [
        existing.email,
        existing.phone,
        existing.notes,
      ].filter(Boolean).length;

      if (sourceComplete > targetComplete) {
        await prisma.kennelHasher.update({
          where: { id: existing.id },
          data: {
            nerdName: hasher.nerdName || existing.nerdName,
            email: hasher.email || existing.email,
            phone: hasher.phone || existing.phone,
            notes: hasher.notes || existing.notes,
          },
        });
      }

      await prisma.kennelHasher.delete({ where: { id: hasher.id } });
    }
  }

  // 7. Handle SourceKennel duplicates
  const sourceLinks = await prisma.sourceKennel.findMany({
    where: { kennelId: sourceKennel.id },
    select: { sourceId: true },
  });

  for (const link of sourceLinks) {
    const existingLink = await prisma.sourceKennel.findUnique({
      where: {
        sourceId_kennelId: {
          sourceId: link.sourceId,
          kennelId: targetKennel.id,
        },
      },
    });

    if (existingLink) {
      await prisma.sourceKennel.delete({
        where: {
          sourceId_kennelId: {
            sourceId: link.sourceId,
            kennelId: sourceKennel.id,
          },
        },
      });
    }
  }

  // 8. Execute transaction for remaining reassignments
  await prisma.$transaction([
    prisma.event.updateMany({
      where: { kennelId: sourceKennel.id },
      data: { kennelId: targetKennel.id },
    }),
    prisma.userKennel.updateMany({
      where: { kennelId: sourceKennel.id },
      data: { kennelId: targetKennel.id },
    }),
    prisma.kennelHasher.updateMany({
      where: { kennelId: sourceKennel.id },
      data: { kennelId: targetKennel.id },
    }),
    prisma.mismanRequest.updateMany({
      where: { kennelId: sourceKennel.id },
      data: { kennelId: targetKennel.id },
    }),
    prisma.sourceKennel.updateMany({
      where: { kennelId: sourceKennel.id },
      data: { kennelId: targetKennel.id },
    }),
    prisma.kennelAlias.deleteMany({
      where: { kennelId: sourceKennel.id },
    }),
    prisma.rosterGroupKennel.deleteMany({
      where: { kennelId: sourceKennel.id },
    }),
    prisma.kennel.delete({
      where: { id: sourceKennel.id },
    }),
  ]);

  revalidatePath("/admin/kennels");
  revalidatePath("/kennels");
  revalidatePath(`/kennels/${targetKennel.slug}`);
  return { success: true };
}
