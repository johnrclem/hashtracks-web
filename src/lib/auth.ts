import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Prisma, type User } from "@/generated/prisma/client";

/** Get the current user from DB, creating a record on first sign-in (Clerk → DB sync). */
export async function getOrCreateUser(): Promise<User | null> {
  let clerkUser;
  try {
    clerkUser = await currentUser();
  } catch {
    // Middleware didn't run for this request (e.g., bot hitting a non-existent
    // .js path that 404s — the matcher skips static extensions, but the
    // not-found page still renders through RootLayout). Treat as unauthenticated.
    return null;
  }
  if (!clerkUser) return null;

  // Step 1: look up by clerkId (fast path)
  const existingUser = await prisma.user.findUnique({
    where: { clerkId: clerkUser.id },
  });

  if (existingUser) return existingUser;

  // Step 2: email-based lookup (handles Clerk instance migration — same
  // person, same email, new clerkId from production instance)
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
  const nerdName = clerkUser.firstName
    ? `${clerkUser.firstName} ${clerkUser.lastName ?? ""}`.trim()
    : null;

  if (email) {
    const emailMatch = await prisma.user.findUnique({
      where: { email },
    });
    if (emailMatch) {
      return prisma.user.update({
        where: { id: emailMatch.id },
        data: { clerkId: clerkUser.id, nerdName: emailMatch.nerdName ?? nerdName },
      });
    }
  }

  // Step 3: create new user
  try {
    const newUser = await prisma.user.create({
      data: {
        clerkId: clerkUser.id,
        email,
        hashName: null,
        nerdName,
      },
    });

    // Server-side analytics: track new signup
    const { captureServerEvent, identifyServerUser } = await import("@/lib/analytics-server");
    await captureServerEvent(newUser.id, "signup_completed", {
      method: clerkUser.externalAccounts?.length ? "google" : "email",
    });
    await identifyServerUser(newUser.id, { email });

    return newUser;
  } catch (err: unknown) {
    // Step 4: race-condition guard — another request may have created the
    // record between our lookups and this create. P2002 could be on clerkId
    // or email unique constraint, so try both.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const user = await prisma.user.findUnique({ where: { clerkId: clerkUser.id } });
      if (user) return user;
      return email ? prisma.user.findUnique({ where: { email } }) : null;
    }
    throw err;
  }
}

/** Get the current user if they have the "admin" role in Clerk metadata. Returns null otherwise. */
export async function getAdminUser(): Promise<User | null> {
  let clerkUser;
  try {
    clerkUser = await currentUser();
  } catch {
    return null;
  }
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
  let clerkUser;
  try {
    clerkUser = await currentUser();
  } catch {
    return null;
  }
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
 * Still needed for event validation (events belong to kennels, not groups).
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

/**
 * Get the rosterGroupId for a kennel.
 * Every kennel has exactly one RosterGroup (standalone or shared).
 * Self-healing: auto-creates a standalone group if none exists.
 */
export async function getRosterGroupId(kennelId: string): Promise<string> {
  const groupKennel = await prisma.rosterGroupKennel.findUnique({
    where: { kennelId },
    select: { groupId: true },
  });
  if (groupKennel) return groupKennel.groupId;

  // Auto-create standalone group (self-healing for missing entries)
  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { shortName: true },
  });
  const group = await prisma.rosterGroup.create({
    data: { name: kennel?.shortName ?? "Unknown" },
  });
  await prisma.rosterGroupKennel.create({
    data: { groupId: group.id, kennelId },
  });
  return group.id;
}
