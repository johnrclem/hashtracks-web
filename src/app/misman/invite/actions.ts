"use server";

import { getOrCreateUser, getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  generateInviteToken,
  computeExpiresAt,
  MAX_PENDING_PER_KENNEL,
} from "@/lib/invite";

/**
 * Create a new misman invite link for a kennel.
 * Only existing mismans/admins of the kennel can create invites.
 */
export async function createMismanInvite(
  kennelId: string,
  inviteeEmail?: string,
  expiryDays?: number,
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  // Guard: max pending invites per kennel
  const pendingCount = await prisma.mismanInvite.count({
    where: {
      kennelId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
  });

  if (pendingCount >= MAX_PENDING_PER_KENNEL) {
    return { error: `Maximum of ${MAX_PENDING_PER_KENNEL} pending invites per kennel` };
  }

  // Guard: per-user daily rate limit (max 5 invites per user per day)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const userRecentCount = await prisma.mismanInvite.count({
    where: {
      inviterId: user.id,
      createdAt: { gte: oneDayAgo },
    },
  });

  if (userRecentCount >= 5) {
    return { error: "You have created too many invites recently. Please try again later." };
  }

  const token = generateInviteToken();
  const expiresAt = computeExpiresAt(expiryDays);

  const invite = await prisma.mismanInvite.create({
    data: {
      kennelId,
      inviterId: user.id,
      inviteeEmail: inviteeEmail?.trim() || null,
      token,
      expiresAt,
    },
    include: {
      kennel: { select: { slug: true } },
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
    || "http://localhost:3000";
  const inviteUrl = `${baseUrl}/invite/${token}`;

  revalidatePath(`/kennels/${invite.kennel.slug}`);

  return {
    data: {
      id: invite.id,
      token,
      inviteUrl,
      expiresAt: invite.expiresAt.toISOString(),
    },
  };
}

/**
 * Revoke a pending invite. Only mismans of the kennel can revoke.
 */
export async function revokeMismanInvite(inviteId: string) {
  const invite = await prisma.mismanInvite.findUnique({
    where: { id: inviteId },
    include: { kennel: { select: { slug: true } } },
  });
  if (!invite) return { error: "Invite not found" };

  const user = await getMismanUser(invite.kennelId);
  if (!user) return { error: "Not authorized" };

  if (invite.status !== "PENDING") return { error: "Invite is not pending" };
  if (invite.expiresAt <= new Date()) return { error: "Invite has already expired" };

  await prisma.mismanInvite.update({
    where: { id: inviteId },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
    },
  });

  revalidatePath(`/kennels/${invite.kennel.slug}`);
  return { success: true };
}

/**
 * List invites for a kennel with effective status.
 * PENDING invites past expiresAt are displayed as expired.
 */
export async function listMismanInvites(kennelId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const invites = await prisma.mismanInvite.findMany({
    where: { kennelId },
    include: {
      inviter: { select: { hashName: true, email: true } },
      acceptor: { select: { hashName: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const now = new Date();

  const data = invites.map((inv) => {
    // Compute effective status: PENDING past expiry is "expired"
    const effectiveStatus =
      inv.status === "PENDING" && inv.expiresAt <= now ? "EXPIRED" : inv.status;

    return {
      id: inv.id,
      inviteeEmail: inv.inviteeEmail,
      status: effectiveStatus,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
      acceptedAt: inv.acceptedAt?.toISOString() ?? null,
      revokedAt: inv.revokedAt?.toISOString() ?? null,
      inviterName: inv.inviter.hashName || inv.inviter.email,
      acceptorName: inv.acceptor
        ? inv.acceptor.hashName || inv.acceptor.email
        : null,
    };
  });

  return { data };
}

/**
 * Redeem an invite token. Grants MISMAN role to the authenticated user.
 */
export async function redeemMismanInvite(token: string) {
  const user = await getOrCreateUser();
  if (!user) return { error: "Not authenticated" };

  const invite = await prisma.mismanInvite.findUnique({
    where: { token },
    include: { kennel: { select: { slug: true } } },
  });

  if (!invite) return { error: "Invite not found" };
  if (invite.status !== "PENDING") {
    if (invite.status === "ACCEPTED") return { error: "This invite has already been used" };
    if (invite.status === "REVOKED") return { error: "This invite was cancelled" };
    return { error: "This invite is no longer valid" };
  }
  if (invite.expiresAt <= new Date()) {
    return { error: "This invite has expired" };
  }

  // Upsert UserKennel with MISMAN role (same pattern as approveMismanRequest)
  await prisma.userKennel.upsert({
    where: {
      userId_kennelId: { userId: user.id, kennelId: invite.kennelId },
    },
    update: { role: "MISMAN" },
    create: {
      userId: user.id,
      kennelId: invite.kennelId,
      role: "MISMAN",
    },
  });

  // Mark invite as accepted
  await prisma.mismanInvite.update({
    where: { id: invite.id },
    data: {
      status: "ACCEPTED",
      acceptedBy: user.id,
      acceptedAt: new Date(),
    },
  });

  revalidatePath("/misman");
  revalidatePath(`/kennels/${invite.kennel.slug}`);

  return { success: true, kennelSlug: invite.kennel.slug };
}

/**
 * Get all users with MISMAN or ADMIN role for a kennel.
 */
export async function getKennelMismans(kennelId: string) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const members = await prisma.userKennel.findMany({
    where: {
      kennelId,
      role: { in: ["MISMAN", "ADMIN"] },
    },
    include: {
      user: { select: { id: true, hashName: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const data = members.map((m) => ({
    userId: m.user.id,
    hashName: m.user.hashName,
    email: m.user.email,
    role: m.role,
    since: m.createdAt.toISOString(),
  }));

  return { data };
}
