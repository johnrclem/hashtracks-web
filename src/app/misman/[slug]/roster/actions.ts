"use server";

import { getMismanUser, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

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
