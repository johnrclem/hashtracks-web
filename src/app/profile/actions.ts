"use server";

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function updateProfile(
  _prevState: { success?: boolean; error?: string } | null,
  formData: FormData,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const hashName = formData.get("hashName") as string | null;
  const nerdName = formData.get("nerdName") as string | null;
  const bio = formData.get("bio") as string | null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      hashName: hashName?.trim() || null,
      nerdName: nerdName?.trim() || null,
      bio: bio?.trim() || null,
    },
  });

  revalidatePath("/profile");
  return { success: true };
}

/**
 * Get all kennel links for the current user.
 * Returns SUGGESTED and CONFIRMED links (excludes DISMISSED).
 */
export async function getMyKennelLinks() {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const links = await prisma.kennelHasherLink.findMany({
    where: {
      userId: user.id,
      status: { in: ["SUGGESTED", "CONFIRMED"] },
    },
    include: {
      kennelHasher: {
        select: {
          id: true,
          hashName: true,
          nerdName: true,
          kennel: { select: { shortName: true, slug: true } },
          rosterGroup: {
            select: {
              name: true,
              kennels: {
                select: { kennel: { select: { shortName: true, slug: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return {
    data: links.map((link) => ({
      id: link.id,
      status: link.status,
      hashName: link.kennelHasher.hashName,
      nerdName: link.kennelHasher.nerdName,
      kennelShortName:
        link.kennelHasher.kennel?.shortName ??
        link.kennelHasher.rosterGroup.name,
      kennelSlug: link.kennelHasher.kennel?.slug ?? null,
      groupKennels: link.kennelHasher.rosterGroup.kennels.map((k) => ({
        shortName: k.kennel.shortName,
        slug: k.kennel.slug,
      })),
      createdAt: link.createdAt.toISOString(),
    })),
  };
}

/**
 * Accept a suggested link request (user-side).
 */
export async function acceptLinkRequest(linkId: string) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const link = await prisma.kennelHasherLink.findUnique({
    where: { id: linkId },
    include: {
      kennelHasher: { include: { kennel: { select: { slug: true } } } },
    },
  });
  if (!link) return { error: "Link not found" };
  if (link.userId !== user.id) return { error: "Not authorized" };
  if (link.status !== "SUGGESTED") {
    return { error: "Link is not in SUGGESTED status" };
  }

  await prisma.kennelHasherLink.update({
    where: { id: linkId },
    data: { status: "CONFIRMED", confirmedBy: user.id },
  });

  if (link.kennelHasher.kennel) {
    revalidatePath(`/misman/${link.kennelHasher.kennel.slug}/roster`);
  }
  revalidatePath("/profile");
  revalidatePath("/logbook");
  return { success: true };
}

/**
 * Decline a suggested link request (user-side).
 */
export async function declineLinkRequest(linkId: string) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const link = await prisma.kennelHasherLink.findUnique({
    where: { id: linkId },
    include: {
      kennelHasher: { include: { kennel: { select: { slug: true } } } },
    },
  });
  if (!link) return { error: "Link not found" };
  if (link.userId !== user.id) return { error: "Not authorized" };
  if (link.status !== "SUGGESTED") {
    return { error: "Link is not in SUGGESTED status" };
  }

  await prisma.kennelHasherLink.update({
    where: { id: linkId },
    data: { status: "DISMISSED", dismissedBy: user.id },
  });

  if (link.kennelHasher.kennel) {
    revalidatePath(`/misman/${link.kennelHasher.kennel.slug}/roster`);
  }
  revalidatePath("/profile");
  return { success: true };
}

/**
 * Revoke a confirmed link (user-side).
 * Does not delete attendance records — just unlinks the user.
 */
export async function revokeMyLink(linkId: string) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const link = await prisma.kennelHasherLink.findUnique({
    where: { id: linkId },
    include: {
      kennelHasher: { include: { kennel: { select: { slug: true } } } },
    },
  });
  if (!link) return { error: "Link not found" };
  if (link.userId !== user.id) return { error: "Not authorized" };
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
  revalidatePath("/profile");
  revalidatePath("/logbook");
  return { success: true };
}
