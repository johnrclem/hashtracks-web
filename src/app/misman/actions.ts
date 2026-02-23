"use server";

import { getOrCreateUser, getMismanUser, getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";

/**
 * Request misman access from the misman dashboard.
 * Caller must already be misman of at least one kennel.
 * Auto-subscribes (creates MEMBER UserKennel) if not already subscribed.
 */
export async function requestMismanAccessFromDashboard(
  kennelId: string,
  message?: string,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Must already be misman of at least one kennel
  const existingMismanRole = await prisma.userKennel.findFirst({
    where: {
      userId: user.id,
      role: { in: ["MISMAN", "ADMIN"] },
    },
  });
  if (!existingMismanRole) {
    return { error: "You must be misman of at least one kennel" };
  }

  // Already has misman/admin role for this kennel?
  const membership = await prisma.userKennel.findUnique({
    where: { userId_kennelId: { userId: user.id, kennelId } },
  });
  if (membership?.role === "MISMAN" || membership?.role === "ADMIN") {
    return { error: "You already have misman access for this kennel" };
  }

  // Check for existing PENDING request
  const existing = await prisma.mismanRequest.findFirst({
    where: { userId: user.id, kennelId, status: "PENDING" },
  });
  if (existing) return { error: "You already have a pending request for this kennel" };

  // Auto-subscribe as MEMBER if not already subscribed
  if (!membership) {
    await prisma.userKennel.create({
      data: { userId: user.id, kennelId, role: "MEMBER" },
    });
  }

  await prisma.mismanRequest.create({
    data: {
      userId: user.id,
      kennelId,
      message: message?.trim() || null,
    },
  });

  revalidatePath("/misman");
  return { success: true };
}

/**
 * Request misman access for a kennel.
 * Any authenticated user can request; must be a MEMBER (subscribed).
 */
export async function requestMismanAccess(
  kennelId: string,
  message?: string,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Must be subscribed to the kennel
  const membership = await prisma.userKennel.findUnique({
    where: { userId_kennelId: { userId: user.id, kennelId } },
  });
  if (!membership) return { error: "You must subscribe to this kennel first" };

  // Already has misman/admin role
  if (membership.role === "MISMAN" || membership.role === "ADMIN") {
    return { error: "You already have misman access for this kennel" };
  }

  // Check for existing PENDING request
  const existing = await prisma.mismanRequest.findFirst({
    where: { userId: user.id, kennelId, status: "PENDING" },
  });
  if (existing) return { error: "You already have a pending request" };

  await prisma.mismanRequest.create({
    data: {
      userId: user.id,
      kennelId,
      message: message?.trim() || null,
    },
  });

  revalidatePath(`/misman`);
  return { success: true };
}

/**
 * Approve a misman access request.
 * Callable by existing mismans of the kennel or site admins.
 */
export async function approveMismanRequest(requestId: string) {
  const request = await prisma.mismanRequest.findUnique({
    where: { id: requestId },
    include: { kennel: { select: { slug: true } } },
  });
  if (!request) return { error: "Request not found" };
  if (request.status !== "PENDING") return { error: "Request is not pending" };

  // Auth: must be misman of this kennel or site admin
  const mismanUser = await getMismanUser(request.kennelId);
  if (!mismanUser) return { error: "Not authorized" };

  // Upsert UserKennel with MISMAN role
  await prisma.userKennel.upsert({
    where: {
      userId_kennelId: { userId: request.userId, kennelId: request.kennelId },
    },
    update: { role: "MISMAN" },
    create: {
      userId: request.userId,
      kennelId: request.kennelId,
      role: "MISMAN",
    },
  });

  // Mark request as approved
  await prisma.mismanRequest.update({
    where: { id: requestId },
    data: {
      status: "APPROVED",
      resolvedBy: mismanUser.id,
      resolvedAt: new Date(),
    },
  });

  revalidatePath("/misman");
  revalidatePath(`/kennels/${request.kennel.slug}`);
  return { success: true };
}

/**
 * Reject a misman access request.
 * Callable by existing mismans of the kennel or site admins.
 */
export async function rejectMismanRequest(requestId: string) {
  const request = await prisma.mismanRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) return { error: "Request not found" };
  if (request.status !== "PENDING") return { error: "Request is not pending" };

  const mismanUser = await getMismanUser(request.kennelId);
  if (!mismanUser) return { error: "Not authorized" };

  await prisma.mismanRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      resolvedBy: mismanUser.id,
      resolvedAt: new Date(),
    },
  });

  revalidatePath("/misman");
  return { success: true };
}

/**
 * Request a new shared roster group.
 * Misman must have access to all specified kennels.
 */
export async function requestRosterGroup(
  proposedName: string,
  kennelIds: string[],
  message?: string,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  if (!proposedName.trim()) return { error: "Group name is required" };
  if (kennelIds.length < 2) return { error: "At least 2 kennels are required" };

  // Verify misman access to all specified kennels
  const mismanRoles = await prisma.userKennel.findMany({
    where: {
      userId: user.id,
      kennelId: { in: kennelIds },
      role: { in: ["MISMAN", "ADMIN"] },
    },
    select: { kennelId: true },
  });
  const accessibleIds = new Set(mismanRoles.map((r) => r.kennelId));
  const unauthorized = kennelIds.filter((id) => !accessibleIds.has(id));
  if (unauthorized.length > 0) {
    return { error: "You don't have misman access to all selected kennels" };
  }

  // Check for existing pending request from this user
  const existing = await prisma.rosterGroupRequest.findFirst({
    where: { userId: user.id, status: "PENDING" },
  });
  if (existing) return { error: "You already have a pending roster group request" };

  await prisma.rosterGroupRequest.create({
    data: {
      userId: user.id,
      proposedName: proposedName.trim(),
      kennelIds: kennelIds as unknown as Prisma.InputJsonValue,
      message: message?.trim() || null,
    },
  });

  revalidatePath("/misman");
  return { success: true };
}

/**
 * Request a new shared roster group by kennel names (free-form).
 * Any misman can request — they don't need to manage all kennels in the group.
 * Kennel names are stored in the message for admin resolution.
 */
export async function requestRosterGroupByName(
  kennelId: string,
  proposedName: string,
  kennelNamesText: string,
  message?: string,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  if (!proposedName.trim()) return { error: "Group name is required" };
  if (!kennelNamesText.trim()) return { error: "Kennel names are required" };

  // Verify misman access to at least the current kennel
  const mismanUser = await getMismanUser(kennelId);
  if (!mismanUser) return { error: "Not authorized" };

  // Check for existing pending request from this user
  const existing = await prisma.rosterGroupRequest.findFirst({
    where: { userId: user.id, status: "PENDING" },
  });
  if (existing) return { error: "You already have a pending roster group request" };

  // Store the kennel names in the message for admin to resolve
  const fullMessage = [
    `Kennels: ${kennelNamesText.trim()}`,
    message?.trim() ? message.trim() : null,
  ]
    .filter(Boolean)
    .join("\n");

  await prisma.rosterGroupRequest.create({
    data: {
      userId: user.id,
      proposedName: proposedName.trim(),
      kennelIds: [kennelId] as unknown as Prisma.InputJsonValue,
      message: fullMessage,
    },
  });

  revalidatePath("/misman", "layout");
  return { success: true };
}

/**
 * Fetch all kennels with their roster group membership for the picker UI.
 */
export async function getKennelsForRosterPicker() {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" as const };

  const kennels = await prisma.kennel.findMany({
    select: {
      id: true,
      shortName: true,
      fullName: true,
      region: true,
      rosterGroups: {
        select: {
          group: { select: { name: true } },
        },
      },
    },
    orderBy: [{ region: "asc" }, { shortName: "asc" }],
  });

  return {
    data: kennels.map((k) => ({
      id: k.id,
      shortName: k.shortName,
      fullName: k.fullName,
      region: k.region,
      rosterGroupName: k.rosterGroups[0]?.group.name ?? null,
    })),
  };
}

/**
 * Request a new shared roster group with specific kennel IDs.
 * Any misman can request — they don't need to manage all kennels in the group.
 */
export async function requestRosterGroupWithIds(
  kennelId: string,
  proposedName: string,
  kennelIds: string[],
  message?: string,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  // Input validation
  if (!proposedName.trim()) return { error: "Group name is required" };
  if (proposedName.length > 100) return { error: "Group name is too long" };
  if (!Array.isArray(kennelIds)) return { error: "Invalid kennel list" };
  if (kennelIds.length < 2) return { error: "At least 2 kennels are required" };
  if (kennelIds.length > 100) return { error: "Too many kennels selected" };
  if (
    !kennelIds.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 30,
    )
  ) {
    return { error: "Invalid kennel list" };
  }
  if (message && message.length > 500) return { error: "Message is too long" };

  // Verify misman access to at least the current kennel
  const mismanUser = await getMismanUser(kennelId);
  if (!mismanUser) return { error: "Not authorized" };

  // Check for existing pending request from this user
  const existing = await prisma.rosterGroupRequest.findFirst({
    where: { userId: user.id, status: "PENDING" },
  });
  if (existing) return { error: "You already have a pending roster group request" };

  await prisma.rosterGroupRequest.create({
    data: {
      userId: user.id,
      proposedName: proposedName.trim(),
      kennelIds: kennelIds as unknown as Prisma.InputJsonValue,
      message: message?.trim() || null,
    },
  });

  revalidatePath("/misman", "layout");
  return { success: true };
}

/**
 * Request a change to an existing roster group.
 * Uses the same RosterGroupRequest model with the current group name
 * and kennel IDs, plus a message describing the desired change.
 */
export async function requestRosterGroupChange(
  rosterGroupId: string,
  kennelId: string,
  message: string,
) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  if (!message.trim()) return { error: "Please describe the change you need" };

  // Verify misman access to the kennel
  const mismanUser = await getMismanUser(kennelId);
  if (!mismanUser) return { error: "Not authorized" };

  // Fetch the roster group
  const group = await prisma.rosterGroup.findUnique({
    where: { id: rosterGroupId },
    include: {
      kennels: { select: { kennelId: true } },
    },
  });
  if (!group) return { error: "Roster group not found" };

  // Verify the kennel belongs to this roster group
  const groupKennelIds = group.kennels.map((k) => k.kennelId);
  if (!groupKennelIds.includes(kennelId)) {
    return { error: "This kennel is not part of the specified roster group" };
  }

  // Check for existing pending request from this user
  const existing = await prisma.rosterGroupRequest.findFirst({
    where: { userId: user.id, status: "PENDING" },
  });
  if (existing) return { error: "You already have a pending roster group request" };

  await prisma.rosterGroupRequest.create({
    data: {
      userId: user.id,
      proposedName: group.name,
      kennelIds: group.kennels.map((k) => k.kennelId) as unknown as Prisma.InputJsonValue,
      message: `[Change request for "${group.name}"] ${message.trim()}`,
    },
  });

  revalidatePath("/misman", "layout");
  return { success: true };
}

/**
 * Revoke misman access for a user on a kennel.
 * Downgrades UserKennel role from MISMAN → MEMBER.
 *
 * Auth:
 * - Site admins can revoke any MISMAN
 * - Mismans can revoke users they personally invited (via MismanInvite)
 *
 * Guards:
 * - Cannot revoke ADMIN role
 * - Cannot self-revoke
 */
export async function revokeMismanAccess(userKennelId: string) {
  const caller = await getOrCreateUser();
  if (!caller) return { error: "Not authenticated" };

  const target = await prisma.userKennel.findUnique({
    where: { id: userKennelId },
    include: {
      user: { select: { id: true, hashName: true, email: true } },
      kennel: { select: { id: true, slug: true, shortName: true } },
    },
  });
  if (!target) return { error: "Membership not found" };

  if (target.role === "ADMIN") {
    return { error: "Cannot revoke admin access" };
  }
  if (target.role !== "MISMAN") {
    return { error: "User is not a misman" };
  }
  if (target.userId === caller.id) {
    return { error: "Cannot revoke your own access" };
  }

  // Auth check: site admin or original inviter
  const isAdmin = await getAdminUser();
  if (!isAdmin) {
    // Check if caller invited this user via MismanInvite
    const invite = await prisma.mismanInvite.findFirst({
      where: {
        kennelId: target.kennel.id,
        inviterId: caller.id,
        acceptedBy: target.userId,
        status: "ACCEPTED",
      },
    });
    if (!invite) {
      return { error: "Not authorized — only admins or the original inviter can revoke access" };
    }
  }

  await prisma.userKennel.update({
    where: { id: userKennelId },
    data: { role: "MEMBER" },
  });

  revalidatePath("/misman");
  revalidatePath("/admin/misman");
  revalidatePath(`/kennels/${target.kennel.slug}`);
  return { success: true };
}
