"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

function toSlug(shortName: string): string {
  return shortName
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function createKennel(formData: FormData) {
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
