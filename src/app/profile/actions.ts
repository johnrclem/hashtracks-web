"use server";

import { head } from "@vercel/blob";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isOptimizableLogo } from "@/lib/image-remote-patterns";
import { revalidatePath } from "next/cache";

// Mirrors the limits enforced by /api/user/avatar/upload's onBeforeGenerateToken.
const AVATAR_ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
// Blob URLs are well under this; bound the input before any URL parse / head().
const AVATAR_URL_MAX_LEN = 1024;

export async function updateProfile(
  _prevState: { success?: boolean; error?: string } | null,
  formData: FormData,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const hashName = formData.get("hashName") as string | null;
  const nerdName = formData.get("nerdName") as string | null;
  const bio = formData.get("bio") as string | null;
  const avatarRaw = ((formData.get("avatarUrl") as string | null) ?? "").trim();
  const hideClerkImage = formData.get("hideClerkImage") === "true";
  const attendanceVisibility =
    formData.get("attendanceVisibility") === "PUBLIC" ? "PUBLIC" : "PRIVATE";

  // Input length validation
  if (hashName && hashName.trim().length > 100) return { error: "Hash name is too long (max 100 characters)" };
  if (nerdName && nerdName.trim().length > 100) return { error: "Nerd name is too long (max 100 characters)" };
  if (bio && bio.trim().length > 500) return { error: "Bio is too long (max 500 characters)" };

  // Avatar URL: it must be a blob in OUR store, under this user's own
  // `avatars/<id>/` namespace, within the image-type/size caps. `isOptimizableLogo`
  // alone is insufficient — it matches ANY `*.public.blob.vercel-storage.com`
  // host, so a user could POST a URL from their own Blob store and bypass the
  // upload route's caps. `head()` is token-scoped: a foreign or forged URL throws,
  // and it returns the real size/contentType so the caps are re-enforced
  // server-side regardless of how the URL was obtained. Empty clears the photo.
  let avatarUrl: string | null = null;
  if (avatarRaw) {
    if (avatarRaw.length > AVATAR_URL_MAX_LEN || !isOptimizableLogo(avatarRaw)) {
      return { error: "Profile photo must be uploaded through HashTracks" };
    }
    try {
      const meta = await head(avatarRaw);
      if (
        !meta.pathname.startsWith(`avatars/${user.id}/`) ||
        meta.size > AVATAR_MAX_BYTES ||
        !AVATAR_ALLOWED_TYPES.has(meta.contentType)
      ) {
        return { error: "Profile photo must be uploaded through HashTracks" };
      }
    } catch {
      // Not found in our store (foreign/forged URL) or a transient Blob error.
      return { error: "Profile photo must be uploaded through HashTracks" };
    }
    avatarUrl = avatarRaw;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      hashName: hashName?.trim() || null,
      nerdName: nerdName?.trim() || null,
      bio: bio?.trim() || null,
      avatarUrl,
      hideClerkImage,
      attendanceVisibility,
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
