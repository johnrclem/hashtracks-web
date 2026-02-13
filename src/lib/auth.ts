import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import type { User } from "@/generated/prisma/client";

export async function getOrCreateUser(): Promise<User | null> {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const existingUser = await prisma.user.findUnique({
    where: { clerkId: clerkUser.id },
  });

  if (existingUser) return existingUser;

  // First sign-in: create User record
  return prisma.user.create({
    data: {
      clerkId: clerkUser.id,
      email: clerkUser.emailAddresses[0]?.emailAddress ?? "",
      hashName: null,
      nerdName: clerkUser.firstName
        ? `${clerkUser.firstName} ${clerkUser.lastName ?? ""}`.trim()
        : null,
    },
  });
}

export async function getAdminUser(): Promise<User | null> {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  const metadata = clerkUser.publicMetadata as { role?: string } | null;
  if (metadata?.role !== "admin") return null;

  // Admin is authenticated and has the role — ensure DB user exists
  return getOrCreateUser();
}

/**
 * Get user if they have MISMAN or ADMIN role for the specified kennel,
 * or if they are a site admin.
 */
export async function getMismanUser(kennelId: string): Promise<User | null> {
  const clerkUser = await currentUser();
  if (!clerkUser) return null;

  // Site admins always have misman access
  const metadata = clerkUser.publicMetadata as { role?: string } | null;
  if (metadata?.role === "admin") {
    return getOrCreateUser();
  }

  const user = await getOrCreateUser();
  if (!user) return null;

  const membership = await prisma.userKennel.findUnique({
    where: { userId_kennelId: { userId: user.id, kennelId } },
  });

  if (
    membership &&
    (membership.role === "MISMAN" || membership.role === "ADMIN")
  ) {
    return user;
  }

  return null;
}

/**
 * Get all kennel IDs in the same Roster Group as the given kennel.
 * Returns [kennelId] if the kennel is not in any group (standalone).
 */
export async function getRosterKennelIds(
  kennelId: string,
): Promise<string[]> {
  const groupKennel = await prisma.rosterGroupKennel.findUnique({
    where: { kennelId },
    include: {
      group: {
        include: { kennels: { select: { kennelId: true } } },
      },
    },
  });

  if (!groupKennel) return [kennelId];
  return groupKennel.group.kennels.map((k) => k.kennelId);
}
