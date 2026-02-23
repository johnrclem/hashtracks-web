"use server";

import { getMismanUser, getRosterGroupId, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fuzzyNameMatch } from "@/lib/fuzzy";
import { generateInviteToken, computeExpiresAt } from "@/lib/invite";
import { revalidatePath } from "next/cache";

const USER_LINK_MATCH_THRESHOLD = 0.7;

interface NameHolder {
  hashName: string | null;
  nerdName: string | null;
}

/**
 * Compute the best fuzzy match score between two name holders.
 * Compares all combinations: hashName↔hashName, nerdName↔nerdName, and cross-comparisons.
 */
function bestFuzzyScore(
  a: NameHolder,
  b: NameHolder,
): { score: number; matchField: string } {
  const pairs: [string | null, string | null, string][] = [
    [a.hashName, b.hashName, "hashName"],
    [a.nerdName, b.nerdName, "nerdName"],
    [a.hashName, b.nerdName, "hashName↔nerdName"],
    [a.nerdName, b.hashName, "nerdName↔hashName"],
  ];

  let best = { score: 0, matchField: "" };
  for (const [nameA, nameB, field] of pairs) {
    if (nameA && nameB) {
      const s = fuzzyNameMatch(nameA, nameB);
      if (s > best.score) best = { score: s, matchField: field };
    }
  }
  return best;
}

/**
 * Prepare attendance merge operations: OR-merge overlaps and reassign non-overlapping records.
 */
function buildAttendanceMergeOps(
  allAttendances: Array<{ id: string; kennelHasherId: string; eventId: string; paid: boolean; haredThisTrail: boolean; isVirgin: boolean; isVisitor: boolean; visitorLocation: string | null }>,
  primaryId: string,
) {
  const primaryAttendanceByEvent = new Map(
    allAttendances
      .filter((a) => a.kennelHasherId === primaryId)
      .map((a) => [a.eventId, a]),
  );

  const updateOps: Array<ReturnType<typeof prisma.kennelAttendance.update>> = [];
  const reassignOps: Array<ReturnType<typeof prisma.kennelAttendance.update>> = [];
  const deleteAttendanceIds: string[] = [];

  for (const att of allAttendances) {
    if (att.kennelHasherId === primaryId) continue;

    const existing = primaryAttendanceByEvent.get(att.eventId);
    if (existing) {
      updateOps.push(
        prisma.kennelAttendance.update({
          where: { id: existing.id },
          data: {
            paid: existing.paid || att.paid,
            haredThisTrail: existing.haredThisTrail || att.haredThisTrail,
            isVirgin: existing.isVirgin || att.isVirgin,
            isVisitor: existing.isVisitor || att.isVisitor,
            visitorLocation: existing.visitorLocation || att.visitorLocation,
          },
        }),
      );
      deleteAttendanceIds.push(att.id);
    } else {
      reassignOps.push(
        prisma.kennelAttendance.update({
          where: { id: att.id },
          data: { kennelHasherId: primaryId },
        }),
      );
    }
  }

  return { updateOps, reassignOps, deleteAttendanceIds };
}

/**
 * Create a new kennel hasher on the roster.
 */
export async function createKennelHasher(
  kennelId: string,
  data: {
    hashName?: string;
    nerdName?: string;
    email?: string;
    phone?: string;
    notes?: string;
  },
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const hashName = data.hashName?.trim() || null;
  const nerdName = data.nerdName?.trim() || null;

  if (!hashName && !nerdName) {
    return { error: "Either hash name or nerd name is required" };
  }

  const rosterGroupId = await getRosterGroupId(kennelId);

  const hasher = await prisma.kennelHasher.create({
    data: {
      rosterGroupId,
      kennelId,
      hashName,
      nerdName,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      notes: data.notes?.trim() || null,
    },
  });

  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { slug: true },
  });
  if (kennel) revalidatePath(`/misman/${kennel.slug}/roster`);

  return { success: true, hasherId: hasher.id };
}

/**
 * Update an existing kennel hasher.
 * Misman of the hasher's kennel or any kennel in the same roster group can edit.
 */
export async function updateKennelHasher(
  hasherId: string,
  data: {
    hashName?: string;
    nerdName?: string;
    email?: string;
    phone?: string;
    notes?: string;
  },
) {
  const hasher = await prisma.kennelHasher.findUnique({
    where: { id: hasherId },
    include: {
      kennel: { select: { slug: true } },
      rosterGroup: { include: { kennels: { select: { kennelId: true } } } },
    },
  });
  if (!hasher) return { error: "Hasher not found" };

  // Check authorization via roster group scope
  const groupKennelIds = hasher.rosterGroup.kennels.map((k) => k.kennelId);
  let authorized = false;
  for (const kid of groupKennelIds) {
    const u = await getMismanUser(kid);
    if (u) { authorized = true; break; }
  }
  if (!authorized) return { error: "Not authorized" };

  const hashName = data.hashName?.trim() || null;
  const nerdName = data.nerdName?.trim() || null;

  if (!hashName && !nerdName) {
    return { error: "Either hash name or nerd name is required" };
  }

  await prisma.kennelHasher.update({
    where: { id: hasherId },
    data: {
      hashName,
      nerdName,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      notes: data.notes?.trim() || null,
    },
  });

  if (hasher.kennel) revalidatePath(`/misman/${hasher.kennel.slug}/roster`);
  return { success: true };
}

/**
 * Delete a kennel hasher. Blocks if the hasher has attendance records.
 */
export async function deleteKennelHasher(hasherId: string) {
  const hasher = await prisma.kennelHasher.findUnique({
    where: { id: hasherId },
    include: {
      kennel: { select: { slug: true } },
      rosterGroup: { include: { kennels: { select: { kennelId: true } } } },
      _count: { select: { attendances: true } },
    },
  });
  if (!hasher) return { error: "Hasher not found" };

  // Check authorization via roster group scope
  const groupKennelIds = hasher.rosterGroup.kennels.map((k) => k.kennelId);
  let authorized = false;
  for (const kid of groupKennelIds) {
    const u = await getMismanUser(kid);
    if (u) { authorized = true; break; }
  }
  if (!authorized) return { error: "Not authorized" };

  if (hasher._count.attendances > 0) {
    return {
      error: `Cannot delete: this hasher has ${hasher._count.attendances} attendance record(s). Merge with another entry or delete attendance records first.`,
    };
  }

  // Delete link if exists, then the hasher
  await prisma.$transaction([
    prisma.kennelHasherLink.deleteMany({ where: { kennelHasherId: hasherId } }),
    prisma.kennelHasher.delete({ where: { id: hasherId } }),
  ]);

  if (hasher.kennel) revalidatePath(`/misman/${hasher.kennel.slug}/roster`);
  return { success: true };
}

/**
 * Search the roster for a kennel (expanded to roster group scope).
 * Returns matching KennelHashers sorted by hash name.
 */
export async function searchRoster(
  kennelId: string,
  query: string,
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const rosterGroupId = await getRosterGroupId(kennelId);
  const trimmed = query.trim();

  const hashers = await prisma.kennelHasher.findMany({
    where: {
      rosterGroupId,
      ...(trimmed
        ? {
            OR: [
              { hashName: { contains: trimmed, mode: "insensitive" as const } },
              { nerdName: { contains: trimmed, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: {
      _count: { select: { attendances: true } },
    },
    orderBy: [{ hashName: "asc" }, { nerdName: "asc" }],
    take: 50,
  });

  return {
    data: hashers.map((h) => ({
      id: h.id,
      kennelId: h.kennelId,
      hashName: h.hashName,
      nerdName: h.nerdName,
      email: h.email,
      phone: h.phone,
      notes: h.notes,
      attendanceCount: h._count.attendances,
    })),
  };
}

// ── USER LINKING ──

/**
 * Find potential user matches for unlinked KennelHashers.
 * Fuzzy matches hashName/nerdName against User records.
 */
export async function suggestUserLinks(kennelId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const rosterGroupId = await getRosterGroupId(kennelId);
  const rosterKennelIds = await getRosterKennelIds(kennelId);

  // Get unlinked hashers (no link, or link is DISMISSED)
  const hashers = await prisma.kennelHasher.findMany({
    where: {
      rosterGroupId,
      OR: [
        { userLink: null },
        { userLink: { status: "DISMISSED" } },
      ],
    },
    select: { id: true, hashName: true, nerdName: true },
  });

  if (hashers.length === 0) return { data: [] };

  // Get all users who are members of any kennel in the roster scope
  const userKennels = await prisma.userKennel.findMany({
    where: { kennelId: { in: rosterKennelIds } },
    select: {
      user: { select: { id: true, hashName: true, nerdName: true, email: true } },
    },
  });

  // Deduplicate users
  const usersMap = new Map<string, { id: string; hashName: string | null; nerdName: string | null; email: string }>();
  for (const uk of userKennels) {
    usersMap.set(uk.user.id, uk.user);
  }
  const users = Array.from(usersMap.values());

  if (users.length === 0) return { data: [] };

  // Fuzzy match each hasher against each user
  const suggestions: Array<{
    kennelHasherId: string;
    kennelHasherName: string;
    userId: string;
    userHashName: string | null;
    userEmail: string;
    matchScore: number;
    matchField: string;
  }> = [];

  for (const hasher of hashers) {
    let bestMatch: (typeof suggestions)[0] | null = null;

    for (const u of users) {
      const { score, matchField } = bestFuzzyScore(hasher, u);

      if (score >= USER_LINK_MATCH_THRESHOLD && (!bestMatch || score > bestMatch.matchScore)) {
        bestMatch = {
          kennelHasherId: hasher.id,
          kennelHasherName: hasher.hashName || hasher.nerdName || "",
          userId: u.id,
          userHashName: u.hashName,
          userEmail: u.email,
          matchScore: Math.round(score * 1000) / 1000,
          matchField,
        };
      }
    }

    if (bestMatch) suggestions.push(bestMatch);
  }

  return {
    data: suggestions.sort((a, b) => b.matchScore - a.matchScore),
  };
}

/**
 * Create a SUGGESTED link between a KennelHasher and a User.
 */
export async function createUserLink(
  kennelId: string,
  kennelHasherId: string,
  userId: string,
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  // Verify hasher is in roster scope
  const rosterGroupId = await getRosterGroupId(kennelId);
  const hasher = await prisma.kennelHasher.findUnique({
    where: { id: kennelHasherId },
    include: { userLink: true, kennel: { select: { slug: true } } },
  });
  if (!hasher) return { error: "Hasher not found" };

  if (hasher.rosterGroupId !== rosterGroupId) {
    return { error: "Hasher is not in this kennel's roster scope" };
  }

  // Check if already linked (SUGGESTED or CONFIRMED)
  if (hasher.userLink && hasher.userLink.status !== "DISMISSED") {
    return { error: "This hasher already has an active link" };
  }

  // Check if user is already linked to another hasher in roster scope
  const existingLink = await prisma.kennelHasherLink.findFirst({
    where: {
      userId,
      status: "CONFIRMED",
      kennelHasher: { rosterGroupId },
    },
  });
  if (existingLink) {
    return {
      error: "This user is already linked to another hasher in this roster group. Consider merging the roster entries instead.",
    };
  }

  // Upsert: if DISMISSED link exists, update it; otherwise create new
  if (hasher.userLink) {
    await prisma.kennelHasherLink.update({
      where: { id: hasher.userLink.id },
      data: { userId, status: "SUGGESTED", suggestedBy: user.id, dismissedBy: null },
    });
  } else {
    await prisma.kennelHasherLink.create({
      data: {
        kennelHasherId,
        userId,
        status: "SUGGESTED",
        suggestedBy: user.id,
      },
    });
  }

  if (hasher.kennel) revalidatePath(`/misman/${hasher.kennel.slug}/roster`);
  return { success: true };
}

/**
 * User confirms a suggested link (called from logbook side).
 */
export async function confirmUserLink(linkId: string, userId: string) {
  const link = await prisma.kennelHasherLink.findUnique({
    where: { id: linkId },
    include: { kennelHasher: { include: { kennel: { select: { slug: true } } } } },
  });
  if (!link) return { error: "Link not found" };
  if (link.userId !== userId) return { error: "Not authorized" };
  if (link.status !== "SUGGESTED") return { error: "Link is not in SUGGESTED status" };

  await prisma.kennelHasherLink.update({
    where: { id: linkId },
    data: { status: "CONFIRMED", confirmedBy: userId },
  });

  if (link.kennelHasher.kennel) {
    revalidatePath(`/misman/${link.kennelHasher.kennel.slug}/roster`);
  }
  revalidatePath("/logbook");
  return { success: true };
}

/**
 * Dismiss a suggested link (misman-side dismissal).
 */
export async function dismissUserLink(kennelId: string, linkId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const link = await prisma.kennelHasherLink.findUnique({
    where: { id: linkId },
    include: { kennelHasher: { include: { kennel: { select: { slug: true } } } } },
  });
  if (!link) return { error: "Link not found" };

  await prisma.kennelHasherLink.update({
    where: { id: linkId },
    data: { status: "DISMISSED", dismissedBy: user.id },
  });

  if (link.kennelHasher.kennel) {
    revalidatePath(`/misman/${link.kennelHasher.kennel.slug}/roster`);
  }
  return { success: true };
}

/**
 * Revoke a confirmed link (misman-side revocation).
 * Does not delete attendance records — just unlinks the user.
 */
export async function revokeUserLink(kennelId: string, linkId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const link = await prisma.kennelHasherLink.findUnique({
    where: { id: linkId },
    include: { kennelHasher: { include: { kennel: { select: { slug: true } } } } },
  });
  if (!link) return { error: "Link not found" };

  if (link.status !== "CONFIRMED") {
    return { error: "Can only revoke confirmed links" };
  }

  await prisma.kennelHasherLink.update({
    where: { id: linkId },
    data: { status: "DISMISSED", dismissedBy: user.id },
  });

  if (link.kennelHasher.kennel) {
    revalidatePath(`/misman/${link.kennelHasher.kennel.slug}/roster`);
  }
  revalidatePath("/logbook");
  return { success: true };
}

// ── MERGE DUPLICATES ──

const DUPLICATE_MATCH_THRESHOLD = 0.7;

/**
 * Scan the roster for potential duplicate entries.
 * Uses pairwise fuzzy matching across all hashers in the roster group.
 */
export async function scanDuplicates(kennelId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const rosterGroupId = await getRosterGroupId(kennelId);

  const hashers = await prisma.kennelHasher.findMany({
    where: { rosterGroupId },
    select: { id: true, hashName: true, nerdName: true },
  });

  const pairs: Array<{
    hasherId1: string;
    name1: string;
    hasherId2: string;
    name2: string;
    score: number;
    matchField: string;
  }> = [];

  for (let i = 0; i < hashers.length; i++) {
    for (let j = i + 1; j < hashers.length; j++) {
      const a = hashers[i];
      const b = hashers[j];

      const { score: bestScore, matchField } = bestFuzzyScore(a, b);

      if (bestScore >= DUPLICATE_MATCH_THRESHOLD) {
        pairs.push({
          hasherId1: a.id,
          name1: a.hashName || a.nerdName || "",
          hasherId2: b.id,
          name2: b.hashName || b.nerdName || "",
          score: Math.round(bestScore * 1000) / 1000,
          matchField,
        });
      }
    }
  }

  return { data: pairs.sort((a, b) => b.score - a.score) };
}

/**
 * Preview a merge operation: show combined attendance stats and potential conflicts.
 */
export async function previewMerge(
  kennelId: string,
  primaryId: string,
  secondaryIds: string[],
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const rosterGroupId = await getRosterGroupId(kennelId);
  const allIds = [primaryId, ...secondaryIds];

  const hashers = await prisma.kennelHasher.findMany({
    where: { id: { in: allIds } },
    include: {
      userLink: { select: { id: true, userId: true, status: true } },
      _count: { select: { attendances: true } },
    },
  });

  if (hashers.length !== allIds.length) {
    return { error: "One or more hashers not found" };
  }

  // Verify all are in same roster group
  for (const h of hashers) {
    if (h.rosterGroupId !== rosterGroupId) {
      return { error: "All hashers must be in the same roster group" };
    }
  }

  // Check for conflicting user links (different users)
  const activeLinks = hashers
    .map((h) => h.userLink)
    .filter((l) => l && l.status !== "DISMISSED");
  const linkedUserIds = new Set(activeLinks.map((l) => l!.userId));
  const hasConflictingLinks = linkedUserIds.size > 1;

  // Count total and overlapping attendance
  const attendances = await prisma.kennelAttendance.findMany({
    where: { kennelHasherId: { in: allIds } },
    select: { kennelHasherId: true, eventId: true },
  });

  const eventSets = new Map<string, Set<string>>();
  for (const a of attendances) {
    if (!eventSets.has(a.kennelHasherId)) {
      eventSets.set(a.kennelHasherId, new Set());
    }
    eventSets.get(a.kennelHasherId)!.add(a.eventId);
  }

  const allEventIds = new Set(attendances.map((a) => a.eventId));
  let overlapCount = 0;
  for (const eventId of allEventIds) {
    const hashersWithEvent = allIds.filter((id) =>
      eventSets.get(id)?.has(eventId),
    );
    if (hashersWithEvent.length > 1) overlapCount++;
  }

  const primary = hashers.find((h) => h.id === primaryId)!;
  const secondaries = hashers.filter((h) => h.id !== primaryId);

  // Recommend the linked hasher as primary (prefer preserving user links)
  const linkedHashers = hashers.filter(
    (h) => h.userLink && h.userLink.status !== "DISMISSED",
  );
  let recommendedPrimaryId = primaryId;
  if (linkedHashers.length === 1) {
    // Exactly one is linked → recommend it
    recommendedPrimaryId = linkedHashers[0].id;
  } else if (linkedHashers.length === 0) {
    // Neither linked → prefer the one with more attendance
    const sorted = [...hashers].sort(
      (a, b) => b._count.attendances - a._count.attendances,
    );
    recommendedPrimaryId = sorted[0].id;
  }
  // If both are linked (same user), keep the caller's choice

  return {
    data: {
      primary: {
        id: primary.id,
        hashName: primary.hashName,
        nerdName: primary.nerdName,
        email: primary.email,
        phone: primary.phone,
        notes: primary.notes,
        attendanceCount: primary._count.attendances,
        hasLink: !!primary.userLink && primary.userLink.status !== "DISMISSED",
      },
      secondaries: secondaries.map((s) => ({
        id: s.id,
        hashName: s.hashName,
        nerdName: s.nerdName,
        email: s.email,
        phone: s.phone,
        notes: s.notes,
        attendanceCount: s._count.attendances,
        hasLink: !!s.userLink && s.userLink.status !== "DISMISSED",
      })),
      totalAttendance: allEventIds.size,
      overlapCount,
      hasConflictingLinks,
      recommendedPrimaryId,
    },
  };
}

/**
 * Execute a merge: consolidate secondary hashers into the primary.
 *
 * - Overlapping attendance: OR-merge boolean flags.
 * - Non-overlapping attendance: reassign to primary.
 * - User links: transfer from secondary if primary has none (blocked if different users).
 * - Deletes secondary hasher records.
 * - Writes mergeLog on surviving entry.
 */
export async function executeMerge(
  kennelId: string,
  primaryId: string,
  secondaryIds: string[],
  choices: {
    hashName?: string;
    nerdName?: string;
    email?: string;
    phone?: string;
    notes?: string;
  },
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const rosterGroupId = await getRosterGroupId(kennelId);
  const allIds = [primaryId, ...secondaryIds];

  const hashers = await prisma.kennelHasher.findMany({
    where: { id: { in: allIds } },
    include: {
      userLink: true,
      kennel: { select: { slug: true } },
    },
  });

  if (hashers.length !== allIds.length) {
    return { error: "One or more hashers not found" };
  }

  for (const h of hashers) {
    if (h.rosterGroupId !== rosterGroupId) {
      return { error: "All hashers must be in the same roster group" };
    }
  }

  // Check for conflicting user links
  const activeLinks = hashers
    .map((h) => ({ hasherId: h.id, link: h.userLink }))
    .filter((x) => x.link && x.link.status !== "DISMISSED");
  const linkedUserIds = new Set(activeLinks.map((x) => x.link!.userId));
  if (linkedUserIds.size > 1) {
    return {
      error: "Cannot merge: hashers are linked to different users. Revoke one link first.",
    };
  }

  const primary = hashers.find((h) => h.id === primaryId)!;

  // Build merge log
  const mergeLog = {
    mergedAt: new Date().toISOString(),
    mergedBy: user.id,
    merged: hashers
      .filter((h) => h.id !== primaryId)
      .map((h) => ({
        id: h.id,
        hashName: h.hashName,
        nerdName: h.nerdName,
      })),
  };

  // Get all attendance for all hashers
  const allAttendances = await prisma.kennelAttendance.findMany({
    where: { kennelHasherId: { in: allIds } },
  });

  const { updateOps, reassignOps, deleteAttendanceIds } =
    buildAttendanceMergeOps(allAttendances, primaryId);

  // Transfer user link if primary has none but a secondary does
  const primaryHasLink =
    primary.userLink && primary.userLink.status !== "DISMISSED";
  const secondaryLink = !primaryHasLink
    ? activeLinks.find((x) => x.hasherId !== primaryId)?.link
    : null;

  // Execute everything in a transaction
  await prisma.$transaction([
    // OR-merge overlapping attendance
    ...updateOps,
    // Reassign non-overlapping attendance
    ...reassignOps,
    // Delete duplicate attendance records
    ...(deleteAttendanceIds.length > 0
      ? [
          prisma.kennelAttendance.deleteMany({
            where: { id: { in: deleteAttendanceIds } },
          }),
        ]
      : []),
    // Transfer user link
    ...(secondaryLink
      ? [
          prisma.kennelHasherLink.update({
            where: { id: secondaryLink.id },
            data: { kennelHasherId: primaryId },
          }),
        ]
      : []),
    // Delete secondary user links (non-transferred)
    prisma.kennelHasherLink.deleteMany({
      where: {
        kennelHasherId: { in: secondaryIds },
        ...(secondaryLink ? { id: { not: secondaryLink.id } } : {}),
      },
    }),
    // Delete secondary hashers
    prisma.kennelHasher.deleteMany({
      where: { id: { in: secondaryIds } },
    }),
    // Update primary with chosen fields + mergeLog
    prisma.kennelHasher.update({
      where: { id: primaryId },
      data: {
        hashName: choices.hashName?.trim() || primary.hashName,
        nerdName: choices.nerdName?.trim() || primary.nerdName,
        email: choices.email?.trim() || primary.email,
        phone: choices.phone?.trim() || primary.phone,
        notes: choices.notes?.trim() || primary.notes,
        mergeLog: JSON.parse(JSON.stringify(
          primary.mergeLog
            ? [...(primary.mergeLog as unknown[]), mergeLog]
            : [mergeLog],
        )),
      },
    }),
  ]);

  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { slug: true },
  });
  if (kennel) revalidatePath(`/misman/${kennel.slug}/roster`);

  return { success: true, mergedCount: secondaryIds.length };
}

// ── PROFILE LINK INVITES ──

const PROFILE_INVITE_EXPIRY_DAYS = 30;

/**
 * Generate a profile link invite for a KennelHasher.
 * Returns a token-based URL that the hasher can use to link their account.
 */
export async function createProfileInvite(
  kennelId: string,
  kennelHasherId: string,
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const rosterGroupId = await getRosterGroupId(kennelId);
  const hasher = await prisma.kennelHasher.findUnique({
    where: { id: kennelHasherId },
    include: {
      userLink: true,
      kennel: { select: { slug: true } },
    },
  });
  if (!hasher) return { error: "Hasher not found" };
  if (hasher.rosterGroupId !== rosterGroupId) {
    return { error: "Hasher is not in this kennel's roster scope" };
  }

  // Block if already linked
  if (hasher.userLink && hasher.userLink.status === "CONFIRMED") {
    return { error: "This hasher is already linked to a user account" };
  }

  // Block if invite already pending
  if (
    hasher.profileInviteToken &&
    hasher.profileInviteExpiresAt &&
    hasher.profileInviteExpiresAt > new Date()
  ) {
    return { error: "An invite is already pending for this hasher" };
  }

  const token = generateInviteToken();
  const expiresAt = computeExpiresAt(PROFILE_INVITE_EXPIRY_DAYS);

  await prisma.kennelHasher.update({
    where: { id: kennelHasherId },
    data: {
      profileInviteToken: token,
      profileInviteExpiresAt: expiresAt,
      profileInvitedBy: user.id,
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.com";
  const inviteUrl = `${baseUrl}/invite/link?token=${token}`;

  if (hasher.kennel) {
    revalidatePath(`/misman/${hasher.kennel.slug}/roster`);
  }

  return {
    success: true,
    data: {
      token,
      inviteUrl,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/**
 * Revoke a pending profile link invite.
 */
export async function revokeProfileInvite(
  kennelId: string,
  kennelHasherId: string,
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const rosterGroupId = await getRosterGroupId(kennelId);
  const hasher = await prisma.kennelHasher.findUnique({
    where: { id: kennelHasherId },
    include: { kennel: { select: { slug: true } } },
  });
  if (!hasher) return { error: "Hasher not found" };
  if (hasher.rosterGroupId !== rosterGroupId) {
    return { error: "Hasher is not in this kennel's roster scope" };
  }

  if (!hasher.profileInviteToken) {
    return { error: "No pending invite to revoke" };
  }

  await prisma.kennelHasher.update({
    where: { id: kennelHasherId },
    data: {
      profileInviteToken: null,
      profileInviteExpiresAt: null,
      profileInvitedBy: null,
    },
  });

  if (hasher.kennel) {
    revalidatePath(`/misman/${hasher.kennel.slug}/roster`);
  }

  return { success: true };
}
