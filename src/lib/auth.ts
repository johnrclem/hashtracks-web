import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Prisma, type User } from "@/generated/prisma/client";

/**
 * Safe wrapper around Clerk's currentUser(). Returns null instead of throwing
 * when middleware didn't run (e.g., bot hitting a non-existent .js path that
 * 404s — the matcher skips static extensions, but the not-found page still
 * renders through RootLayout).
 */
async function safeCurrentUser() {
  try {
    return await currentUser();
  } catch {
    return null;
  }
}

/** Get the current user from DB, creating a record on first sign-in (Clerk → DB sync). */
export async function getOrCreateUser(): Promise<User | null> {
  const clerkUser = await safeCurrentUser();
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
  const clerkUser = await safeCurrentUser();
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
  const clerkUser = await safeCurrentUser();
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
 * Authorization result for an event-scoped misman check.
 * `kennelSlug` is the slug of an authorized kennel — useful for routing the
 * caller to a misman page they actually have access to (e.g. the
 * "Take Attendance" button on the event detail page must link to a kennel
 * the user manages, not necessarily the event's primary kennel).
 */
export interface EventMismanResult {
  user: User;
  kennelId: string;
  kennelSlug: string;
}

/**
 * Get user (+ an authorized kennel slug) if they have MISMAN or ADMIN role
 * for ANY kennel on the given event (#1023 step 5). Co-hosted events have
 * multiple kennels via EventKennel; a misman of any one of them should be
 * able to record attendance / view misman UI on the event detail page —
 * and the misman link must point at one of THEIR kennels' slugs, not the
 * event's primary kennel.
 *
 * Falls back to the legacy `Event.kennelId` denormalized primary pointer
 * if the event has no EventKennel rows (shouldn't happen post-step-1
 * backfill, but defensive).
 *
 * For site admins, returns the event's primary kennel slug (admins have
 * access to every misman route, so any slug works).
 */
export async function getMismanUserForEvent(eventId: string): Promise<EventMismanResult | null> {
  const clerkUser = await safeCurrentUser();
  if (!clerkUser) return null;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      kennelId: true,
      kennel: { select: { slug: true } },
      eventKennels: {
        select: {
          kennelId: true,
          kennel: { select: { slug: true } },
        },
      },
    },
  });
  if (!event) return null;

  const eventKennels = event.eventKennels.length > 0
    ? event.eventKennels.map((ek) => ({ kennelId: ek.kennelId, kennelSlug: ek.kennel.slug }))
    : [{ kennelId: event.kennelId, kennelSlug: event.kennel?.slug ?? "" }];

  // Site admins have access to every misman route — return the event's
  // primary kennel slug for the link.
  const metadata = clerkUser.publicMetadata as { role?: string } | null;
  if (metadata?.role === "admin") {
    const user = await getOrCreateUser();
    if (!user) return null;
    return { user, kennelId: event.kennelId, kennelSlug: event.kennel?.slug ?? "" };
  }

  const user = await getOrCreateUser();
  if (!user) return null;

  const membership = await prisma.userKennel.findFirst({
    where: {
      userId: user.id,
      kennelId: { in: eventKennels.map((k) => k.kennelId) },
      role: { in: ["MISMAN", "ADMIN"] },
    },
    select: { kennelId: true },
  });
  if (!membership) return null;

  // Resolve the matching kennel's slug from the event's set so the link
  // routes to a kennel the user actually manages.
  const matched = eventKennels.find((k) => k.kennelId === membership.kennelId);
  if (!matched) return null;
  return { user, kennelId: matched.kennelId, kennelSlug: matched.kennelSlug };
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
