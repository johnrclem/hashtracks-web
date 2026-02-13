"use server";

import { getOrCreateUser, getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

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
