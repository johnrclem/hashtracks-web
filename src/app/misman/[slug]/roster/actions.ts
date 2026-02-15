"use server";

import { getMismanUser, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fuzzyNameMatch } from "@/lib/fuzzy";
import { revalidatePath } from "next/cache";

const USER_LINK_MATCH_THRESHOLD = 0.7;

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

  const hasher = await prisma.kennelHasher.create({
    data: {
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
    include: { kennel: { select: { slug: true } } },
  });
  if (!hasher) return { error: "Hasher not found" };

  // Check authorization via roster group scope
  const rosterKennelIds = await getRosterKennelIds(hasher.kennelId);
  let authorized = false;
  for (const kid of rosterKennelIds) {
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

  revalidatePath(`/misman/${hasher.kennel.slug}/roster`);
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
      _count: { select: { attendances: true } },
    },
  });
  if (!hasher) return { error: "Hasher not found" };

  const user = await getMismanUser(hasher.kennelId);
  if (!user) return { error: "Not authorized" };

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

  revalidatePath(`/misman/${hasher.kennel.slug}/roster`);
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

  const rosterKennelIds = await getRosterKennelIds(kennelId);
  const trimmed = query.trim();

  const hashers = await prisma.kennelHasher.findMany({
    where: {
      kennelId: { in: rosterKennelIds },
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

  const rosterKennelIds = await getRosterKennelIds(kennelId);

  // Get unlinked hashers (no link, or link is DISMISSED)
  const hashers = await prisma.kennelHasher.findMany({
    where: {
      kennelId: { in: rosterKennelIds },
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
      let score = 0;
      let matchField = "";

      // Compare hash names
      if (hasher.hashName && u.hashName) {
        const s = fuzzyNameMatch(hasher.hashName, u.hashName);
        if (s > score) {
          score = s;
          matchField = "hashName";
        }
      }

      // Compare nerd names
      if (hasher.nerdName && u.nerdName) {
        const s = fuzzyNameMatch(hasher.nerdName, u.nerdName);
        if (s > score) {
          score = s;
          matchField = "nerdName";
        }
      }

      // Cross-compare: hasher hashName vs user nerdName
      if (hasher.hashName && u.nerdName) {
        const s = fuzzyNameMatch(hasher.hashName, u.nerdName);
        if (s > score) {
          score = s;
          matchField = "hashName↔nerdName";
        }
      }

      // Cross-compare: hasher nerdName vs user hashName
      if (hasher.nerdName && u.hashName) {
        const s = fuzzyNameMatch(hasher.nerdName, u.hashName);
        if (s > score) {
          score = s;
          matchField = "nerdName↔hashName";
        }
      }

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
  const hasher = await prisma.kennelHasher.findUnique({
    where: { id: kennelHasherId },
    include: { userLink: true, kennel: { select: { slug: true } } },
  });
  if (!hasher) return { error: "Hasher not found" };

  const rosterKennelIds = await getRosterKennelIds(kennelId);
  if (!rosterKennelIds.includes(hasher.kennelId)) {
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
      kennelHasher: { kennelId: { in: rosterKennelIds } },
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

  revalidatePath(`/misman/${hasher.kennel.slug}/roster`);
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

  revalidatePath(`/misman/${link.kennelHasher.kennel.slug}/roster`);
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

  revalidatePath(`/misman/${link.kennelHasher.kennel.slug}/roster`);
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

  revalidatePath(`/misman/${link.kennelHasher.kennel.slug}/roster`);
  revalidatePath("/logbook");
  return { success: true };
}
