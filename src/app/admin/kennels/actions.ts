"use server";

import type { Prisma } from "@/generated/prisma/client";
import { getAdminUser, getRosterGroupId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { HARELINE_EVENTS_TAG } from "@/lib/cache-tags";
import { fuzzyMatch } from "@/lib/fuzzy";
import { toSlug, toKennelCode } from "@/lib/kennel-utils";
import { generateAliases } from "@/lib/auto-aliases";
import { ensureKennelLabel, deleteKennelLabel } from "@/pipeline/kennel-label-sync";

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
  // #1415: Profile fields surfaced from chrome-kennel audits.
  str("gm");
  str("hareRaiser");
  str("signatureEvent");
  str("founder");
  // Normalize to the canonical lowercase-hyphenated kennelCode shape. Lookup
  // on the public profile is exact-match, so short names like "Memphis H3"
  // (whose real code is "mh3-tn") still fall back to plain text.
  str("parentKennelCode");
  if (typeof result.parentKennelCode === "string") {
    result.parentKennelCode = toKennelCode(result.parentKennelCode) || null;
  }
  str("hashCash");
  str("paymentLink");
  int("foundedYear");
  str("logoUrl");
  triState("dogFriendly");
  triState("walkersWelcome");

  result.isHidden = formData.get("isHidden") === "true";

  return result;
}

/** Resolve region name from regionId, falling back to the raw form value. */
async function resolveRegionName(regionId: string | null, formRegion: string): Promise<string> {
  if (regionId) {
    const record = await prisma.region.findUnique({ where: { id: regionId }, select: { name: true } });
    if (record) return record.name;
  }
  return formRegion;
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

  const manualAliases = aliasesRaw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  // Merge manual aliases with auto-generated ones (case-insensitive dedup)
  const autoAliases = generateAliases(shortName, fullName);
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const a of [...manualAliases, ...autoAliases]) {
    const key = a.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      aliases.push(a);
    }
  }

  const profileFields = extractProfileFields(formData);

  // Parse kennel coordinates
  const latRaw = (formData.get("latitude") as string)?.trim();
  const lngRaw = (formData.get("longitude") as string)?.trim();
  const latitude = latRaw ? Number.parseFloat(latRaw) : null;
  const longitude = lngRaw ? Number.parseFloat(lngRaw) : null;

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
      ...(latitude != null && !Number.isNaN(latitude) ? { latitude } : {}),
      ...(longitude != null && !Number.isNaN(longitude) ? { longitude } : {}),
      ...profileFields,
      aliases: {
        create: aliases.map((alias) => ({ alias })),
      },
    },
  });

  // Fast-path canonicalize the `kennel:<code>` GitHub label so audit issues
  // filed before the next daily sync get correct color/description. Failures
  // are non-fatal — the daily cron reconciles drift.
  const labelOutcome = await ensureKennelLabel(kennelCode, shortName);
  if (!labelOutcome.ok) {
    console.warn("[createKennel] label sync failed", {
      kennelCode,
      error: labelOutcome.error,
    });
  }

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
    where: {
      shortName,
      ...(regionId ? { regionId } : { region }),
      NOT: { id: kennelId },
    },
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

  // Parse kennel coordinates (only update if form provided values)
  const latRaw = (formData.get("latitude") as string)?.trim();
  const lngRaw = (formData.get("longitude") as string)?.trim();
  const latParsed = latRaw ? Number.parseFloat(latRaw) : undefined;
  const lngParsed = lngRaw ? Number.parseFloat(lngRaw) : undefined;

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
        ...(latParsed !== undefined ? { latitude: Number.isNaN(latParsed) ? null : latParsed } : {}),
        ...(lngParsed !== undefined ? { longitude: Number.isNaN(lngParsed) ? null : lngParsed } : {}),
        ...profileFields,
        aliases: {
          create: newAliases.map((alias) => ({ alias })),
        },
      },
    }),
  ]);

  revalidatePath("/admin/kennels");
  revalidatePath("/kennels");
  // Kennel display fields (shortName/fullName/slug/region/country) are
  // denormalized into the cached Hareline event list via a nested
  // `kennel` select, so any mutation here can leave stale labels/routes
  // in the cache until TTL.
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
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

  // _count.events covers events where this kennel is the primary
  // (Event.kennelId). Co-host EventKennel rows aren't covered by that count
  // — guard against them separately so the FK RESTRICT on EventKennel.kennelId
  // doesn't surface as a confusing 'foreign key violation' deep in the cascade.
  const coHostCount = await prisma.eventKennel.count({
    where: { kennelId },
  });
  if (coHostCount > 0) {
    return {
      error: `Cannot delete: kennel is a co-host on ${coHostCount} event(s). Remove from those events first.`,
    };
  }

  // Check for attendance records via events. #1023 step 5: scope by
  // EventKennel set so co-hosted events are also covered (the prior
  // co-host guard already short-circuits when any exist, but using the
  // join here keeps semantics consistent).
  const attendanceCount = await prisma.kennelAttendance.count({
    where: { event: { eventKennels: { some: { kennelId } } } },
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

  // Clean up orphaned `kennel:<code>` GitHub label. Non-fatal — an orphan
  // label is cosmetic only.
  const delOutcome = await deleteKennelLabel(kennel.kennelCode);
  if (!delOutcome.ok) {
    console.warn("[deleteKennel] label cleanup failed", {
      kennelCode: kennel.kennelCode,
      error: delOutcome.error,
    });
  }

  console.log("[admin-audit] deleteKennel", JSON.stringify({
    adminId: admin.id,
    action: "delete_kennel",
    kennelId,
    kennelName: kennel.shortName,
    timestamp: new Date().toISOString(),
  }));

  revalidatePath("/admin/kennels");
  revalidatePath("/kennels");
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
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

/**
 * Handle EventKennel deduplication during kennel merge (#1023 step 2).
 * Runs inside the merge's interactive transaction so it shares a snapshot
 * with the subsequent reassignment + delete steps.
 *
 * For each source EventKennel row:
 *   - Target already has a row on the same event: collapse to one row.
 *     If source was primary and target wasn't, the source row must be
 *     deleted *first* — the partial unique index `(eventId) WHERE
 *     isPrimary = true` rejects two-primaries-at-once states even
 *     transiently. Then promote target.
 *   - Target has no row on the event: re-point sourceRow.kennelId → target.
 */
export async function deduplicateEventKennels(
  tx: Prisma.TransactionClient,
  sourceKennelId: string,
  targetKennelId: string,
): Promise<void> {
  const sourceRows = await tx.eventKennel.findMany({
    where: { kennelId: sourceKennelId },
    select: { eventId: true, isPrimary: true },
  });

  for (const sourceRow of sourceRows) {
    const targetRow = await tx.eventKennel.findUnique({
      where: { eventId_kennelId: { eventId: sourceRow.eventId, kennelId: targetKennelId } },
      select: { isPrimary: true },
    });

    if (targetRow) {
      const needsPromotion = sourceRow.isPrimary && !targetRow.isPrimary;
      // Always delete source first — promoting target while source is still
      // primary would briefly violate the partial unique index and raise P2002.
      await tx.eventKennel.delete({
        where: { eventId_kennelId: { eventId: sourceRow.eventId, kennelId: sourceKennelId } },
      });
      if (needsPromotion) {
        await tx.eventKennel.update({
          where: { eventId_kennelId: { eventId: sourceRow.eventId, kennelId: targetKennelId } },
          data: { isPrimary: true },
        });
      }
    } else {
      await tx.eventKennel.update({
        where: { eventId_kennelId: { eventId: sourceRow.eventId, kennelId: sourceKennelId } },
        data: { kennelId: targetKennelId },
      });
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

  // 5-7. Pre-merge dedup for UserKennel/Hasher/SourceKennel runs outside
  //      the merge transaction (pre-existing pattern; #1023 spec doesn't
  //      change these). EventKennel dedup runs INSIDE the transaction below
  //      so it shares a snapshot with the reassignment + delete steps and
  //      no concurrent EventKennel insert can leave us with a stale primary
  //      pointing at the now-deleted source kennel.
  await deduplicateUserKennels(sourceKennel.id, targetKennel.id);
  await deduplicateHashers(sourceKennel.id, targetKennel.id);
  await deduplicateSourceKennels(sourceKennel.id, targetKennel.id);

  // 8. Execute reassignment + delete in one interactive transaction. Any
  //    concurrent Event/EventKennel insert that races us either commits
  //    before our snapshot (we see it and re-point it correctly) or after
  //    our delete (its FK to the deleted source kennel fails cleanly via
  //    RESTRICT, rolling back just the racing tx). Either way, the merge
  //    leaves the DB consistent.
  const targetRosterGroupId = await getRosterGroupId(targetKennel.id);
  // Prisma's default interactive-tx timeout is 5s. The per-row dedup loop
  // for a kennel with thousands of EventKennel rows can blow past that and
  // roll back the whole merge — bump the timeout. Admin-triggered, infrequent.
  await prisma.$transaction(
    async (tx) => {
      await deduplicateEventKennels(tx, sourceKennel.id, targetKennel.id);
      await tx.event.updateMany({
        where: { kennelId: sourceKennel.id },
        data: { kennelId: targetKennel.id },
      });
      await tx.userKennel.updateMany({
        where: { kennelId: sourceKennel.id },
        data: { kennelId: targetKennel.id },
      });
      await tx.kennelHasher.updateMany({
        where: { kennelId: sourceKennel.id },
        data: { kennelId: targetKennel.id, rosterGroupId: targetRosterGroupId },
      });
      await tx.mismanRequest.updateMany({
        where: { kennelId: sourceKennel.id },
        data: { kennelId: targetKennel.id },
      });
      await tx.sourceKennel.updateMany({
        where: { kennelId: sourceKennel.id },
        data: { kennelId: targetKennel.id },
      });
      await tx.kennelAlias.deleteMany({
        where: { kennelId: sourceKennel.id },
      });
      await tx.rosterGroupKennel.deleteMany({
        where: { kennelId: sourceKennel.id },
      });
      await tx.kennel.delete({
        where: { id: sourceKennel.id },
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

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
  // Merge reassigns events to the target kennel, so their cached kennel
  // display fields (shortName/slug/region) go stale until tag bust.
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
  return { success: true };
}

/**
 * Toggle kennel visibility (isHidden flag). Admin only.
 */
export async function toggleKennelVisibility(kennelId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { isHidden: true, shortName: true, slug: true },
  });
  if (!kennel) return { error: "Kennel not found" };

  const newValue = !kennel.isHidden;
  await prisma.kennel.update({
    where: { id: kennelId },
    data: { isHidden: newValue },
  });

  console.log("[admin-audit] toggleKennelVisibility", JSON.stringify({
    adminId: admin.id,
    action: newValue ? "hide_kennel" : "show_kennel",
    kennelId,
    kennelName: kennel.shortName,
    timestamp: new Date().toISOString(),
  }));

  revalidatePath("/admin/kennels");
  revalidatePath("/admin/sources/coverage");
  revalidatePath("/kennels");
  revalidatePath(`/kennels/${kennel.slug}`);
  revalidatePath("/hareline");
  revalidatePath("/misman");
  // Hareline's cached event list filters on `kennel.isHidden`; without a
  // tag bust the cache would continue to include (or exclude) this kennel's
  // events until the 3600s revalidate window expired.
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
  return { success: true, isHidden: newValue };
}

