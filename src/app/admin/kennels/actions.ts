"use server";

import { getAdminUser, getRosterGroupId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { fuzzyMatch } from "@/lib/fuzzy";

function extractProfileFields(formData: FormData) {
  const result: Record<string, string | number | boolean | null> = {};
  const str = (name: string) => {
    if (!formData.has(name)) return;
    result[name] = (formData.get(name) as string)?.trim() || null;
  };
  const triState = (name: string) => {
    if (!formData.has(name)) return;
    const val = (formData.get(name) as string)?.trim();
    if (val === "true") result[name] = true;
    else if (val === "false") result[name] = false;
    else result[name] = null;
  };
  const int = (name: string) => {
    if (!formData.has(name)) return;
    const val = (formData.get(name) as string)?.trim();
    if (!val) { result[name] = null; return; }
    const parsed = parseInt(val, 10);
    result[name] = isNaN(parsed) ? null : parsed;
  };

  str("scheduleDayOfWeek");
  str("scheduleTime");
  str("scheduleFrequency");
  str("scheduleNotes");
  str("facebookUrl");
  str("instagramHandle");
  str("twitterHandle");
  str("discordUrl");
  str("mailingListUrl");
  str("contactEmail");
  str("contactName");
  str("hashCash");
  str("paymentLink");
  int("foundedYear");
  str("logoUrl");
  triState("dogFriendly");
  triState("walkersWelcome");

  return result;
}

function toSlug(shortName: string): string {
  return shortName
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Resolve region name from regionId, falling back to the raw form value. */
async function resolveRegionName(regionId: string | null, formRegion: string): Promise<string> {
  if (regionId) {
    const record = await prisma.region.findUnique({ where: { id: regionId }, select: { name: true } });
    if (record) return record.name;
  }
  return formRegion;
}

/** Generate a permanent kennelCode from a shortName. Lowercase, alphanumeric + hyphens only. */
function toKennelCode(shortName: string): string {
  return shortName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
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
  const regionId = (formData.get("regionId") as string)?.trim() || null;
  const country = (formData.get("country") as string)?.trim() || "USA";
  const description = (formData.get("description") as string)?.trim() || null;
  const website = (formData.get("website") as string)?.trim() || null;
  const aliasesRaw = (formData.get("aliases") as string)?.trim() || "";

  // Resolve region name from regionId (dual-write: regionId FK + denormalized region string)
  const formRegion = (formData.get("region") as string)?.trim() || "";
  const region = await resolveRegionName(regionId, formRegion);

  if (!shortName || !fullName || !region || !regionId) {
    return { error: "Short name, full name, and region are required" };
  }

  const slug = toSlug(shortName);
  const kennelCode = toKennelCode(shortName);

  // Check uniqueness: kennelCode must be globally unique
  const existingCode = await prisma.kennel.findUnique({ where: { kennelCode } });
  if (existingCode) {
    return { error: `A kennel with code "${kennelCode}" already exists` };
  }

  // Check uniqueness: slug must be globally unique
  const existingSlug = await prisma.kennel.findUnique({ where: { slug } });
  if (existingSlug) {
    return { error: `A kennel with slug "${slug}" already exists` };
  }

  // Check uniqueness: (shortName, regionId) must be unique
  const existingInRegion = await prisma.kennel.findFirst({
    where: { shortName, regionId },
  });
  if (existingInRegion) {
    return { error: `A kennel named "${shortName}" already exists in ${region}` };
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

  const profileFields = extractProfileFields(formData);

  await prisma.kennel.create({
    data: {
      kennelCode,
      shortName,
      slug,
      fullName,
      region,
      regionRef: { connect: { id: regionId } },
      country,
      description,
      website,
      ...profileFields,
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
  const regionId = (formData.get("regionId") as string)?.trim() || null;
  const country = (formData.get("country") as string)?.trim() || "USA";
  const description = (formData.get("description") as string)?.trim() || null;
  const website = (formData.get("website") as string)?.trim() || null;
  const aliasesRaw = (formData.get("aliases") as string)?.trim() || "";

  // Resolve region name from regionId (dual-write: regionId FK + denormalized region string)
  const formRegion = (formData.get("region") as string)?.trim() || "";
  const region = await resolveRegionName(regionId, formRegion);

  if (!shortName || !fullName || !region) {
    return { error: "Short name, full name, and region are required" };
  }

  const slug = toSlug(shortName);

  // Check slug uniqueness (exclude current kennel)
  const existingSlug = await prisma.kennel.findFirst({
    where: { slug, NOT: { id: kennelId } },
  });
  if (existingSlug) {
    return { error: `A kennel with slug "${slug}" already exists` };
  }

  // Check (shortName, region) uniqueness (exclude current kennel)
  const existingInRegion = await prisma.kennel.findFirst({
    where: { shortName, region, NOT: { id: kennelId } },
  });
  if (existingInRegion) {
    return { error: `A kennel named "${shortName}" already exists in ${region}` };
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

  const profileFields = extractProfileFields(formData);

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
        ...(regionId ? { regionRef: { connect: { id: regionId } } } : {}),
        country,
        description,
        website,
        ...profileFields,
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

  // Check for events, members, or attendance
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

  // Check for attendance records via events (events belong to kennels)
  const attendanceCount = await prisma.kennelAttendance.count({
    where: { event: { kennelId } },
  });
  if (attendanceCount > 0) {
    return {
      error: `Cannot delete: kennel has ${attendanceCount} attendance record(s). Remove attendance first.`,
    };
  }

  // Clean up misman-related records, then delete kennel
  await prisma.$transaction([
    // Delete hasher links for hashers created via this kennel
    prisma.kennelHasherLink.deleteMany({
      where: { kennelHasher: { kennelId } },
    }),
    // Delete hashers created via this kennel
    prisma.kennelHasher.deleteMany({ where: { kennelId } }),
    // Delete roster group membership
    prisma.rosterGroupKennel.deleteMany({ where: { kennelId } }),
    // Delete misman requests
    prisma.mismanRequest.deleteMany({ where: { kennelId } }),
    // Delete aliases and source links
    prisma.kennelAlias.deleteMany({ where: { kennelId } }),
    prisma.sourceKennel.deleteMany({ where: { kennelId } }),
    prisma.kennel.delete({ where: { id: kennelId } }),
  ]);

  console.log("[admin-audit] deleteKennel", JSON.stringify({
    adminId: admin.id,
    action: "delete_kennel",
    kennelId,
    kennelName: kennel.shortName,
    timestamp: new Date().toISOString(),
  }));

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

/** Handle UserKennel deduplication: keep the higher role when both exist. */
async function deduplicateUserKennels(sourceKennelId: string, targetKennelId: string): Promise<void> {
  const roleRank: Record<string, number> = { ADMIN: 3, MISMAN: 2, MEMBER: 1 };

  const userKennelDuplicates = await prisma.userKennel.findMany({
    where: { kennelId: sourceKennelId },
    select: { id: true, role: true, userId: true },
  });

  for (const uk of userKennelDuplicates) {
    const existing = await prisma.userKennel.findUnique({
      where: { userId_kennelId: { userId: uk.userId, kennelId: targetKennelId } },
      select: { id: true, role: true },
    });

    if (existing) {
      if ((roleRank[uk.role] || 0) > (roleRank[existing.role] || 0)) {
        await prisma.userKennel.update({ where: { id: existing.id }, data: { role: uk.role } });
      }
      await prisma.userKennel.delete({ where: { id: uk.id } });
    }
  }
}

/** Handle KennelHasher deduplication: merge more-complete source data into target. */
async function deduplicateHashers(sourceKennelId: string, targetKennelId: string): Promise<void> {
  const hashers = await prisma.kennelHasher.findMany({
    where: { kennelId: sourceKennelId },
    select: { id: true, hashName: true, nerdName: true, email: true, phone: true, notes: true },
  });

  for (const hasher of hashers) {
    const existing = await prisma.kennelHasher.findFirst({
      where: {
        kennelId: targetKennelId,
        hashName: { equals: hasher.hashName, mode: "insensitive" },
      },
    });

    if (existing) {
      const sourceComplete = [hasher.email, hasher.phone, hasher.notes].filter(Boolean).length;
      const targetComplete = [existing.email, existing.phone, existing.notes].filter(Boolean).length;

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
}

/** Handle SourceKennel deduplication: delete source links that already exist on target. */
async function deduplicateSourceKennels(sourceKennelId: string, targetKennelId: string): Promise<void> {
  const sourceLinks = await prisma.sourceKennel.findMany({
    where: { kennelId: sourceKennelId },
    select: { sourceId: true },
  });

  for (const link of sourceLinks) {
    const existingLink = await prisma.sourceKennel.findUnique({
      where: { sourceId_kennelId: { sourceId: link.sourceId, kennelId: targetKennelId } },
    });

    if (existingLink) {
      await prisma.sourceKennel.delete({
        where: { sourceId_kennelId: { sourceId: link.sourceId, kennelId: sourceKennelId } },
      });
    }
  }
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

  // 5-7. Handle duplicates for UserKennel, KennelHasher, SourceKennel
  await deduplicateUserKennels(sourceKennel.id, targetKennel.id);
  await deduplicateHashers(sourceKennel.id, targetKennel.id);
  await deduplicateSourceKennels(sourceKennel.id, targetKennel.id);

  // 8. Execute transaction for remaining reassignments
  const targetRosterGroupId = await getRosterGroupId(targetKennel.id);
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
      data: { kennelId: targetKennel.id, rosterGroupId: targetRosterGroupId },
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

  console.log("[admin-audit] mergeKennels", JSON.stringify({
    adminId: admin.id,
    action: "merge_kennels",
    sourceKennelId: sourceKennel.id,
    sourceKennelName: sourceKennel.shortName,
    targetKennelId: targetKennel.id,
    targetKennelName: targetKennel.shortName,
    eventsMoved: sourceKennel._count.events,
    timestamp: new Date().toISOString(),
  }));

  revalidatePath("/admin/kennels");
  revalidatePath("/kennels");
  revalidatePath(`/kennels/${targetKennel.slug}`);
  return { success: true };
}
