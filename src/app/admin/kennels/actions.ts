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
