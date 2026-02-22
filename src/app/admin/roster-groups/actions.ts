"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAdminAudit } from "@/lib/admin-audit";
import { revalidatePath } from "next/cache";

/**
 * List all roster groups with their member kennels and hasher counts.
 */
export async function getRosterGroups() {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const groups = await prisma.rosterGroup.findMany({
    include: {
      kennels: {
        include: {
          kennel: { select: { id: true, shortName: true, fullName: true, region: true, slug: true } },
        },
      },
      _count: { select: { kennelHashers: true } },
    },
    orderBy: { name: "asc" },
  });

  return {
    data: groups.map((g) => ({
      id: g.id,
      name: g.name,
      kennels: g.kennels.map((k) => ({
        id: k.kennel.id,
        shortName: k.kennel.shortName,
        fullName: k.kennel.fullName,
        region: k.kennel.region,
        slug: k.kennel.slug,
      })),
      hasherCount: g._count.kennelHashers,
    })),
  };
}

/**
 * Create a new roster group with specified kennels.
 * Moves kennels from their current standalone groups.
 */
export async function createRosterGroup(name: string, kennelIds: string[]) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  if (!name.trim()) return { error: "Name is required" };
  if (kennelIds.length < 2) return { error: "At least 2 kennels are required" };

  // Create the group
  const group = await prisma.rosterGroup.create({
    data: { name: name.trim() },
  });

  // Move each kennel to the new group
  for (const kennelId of kennelIds) {
    // Remove from current group
    const existing = await prisma.rosterGroupKennel.findUnique({
      where: { kennelId },
      select: { id: true, groupId: true },
    });

    if (existing) {
      await prisma.rosterGroupKennel.delete({
        where: { id: existing.id },
      });

      // Update hashers from old group to new group
      await prisma.kennelHasher.updateMany({
        where: { rosterGroupId: existing.groupId, kennelId },
        data: { rosterGroupId: group.id },
      });

      // Clean up old group if empty
      const remainingKennels = await prisma.rosterGroupKennel.count({
        where: { groupId: existing.groupId },
      });
      if (remainingKennels === 0) {
        // Move any orphaned hashers (no kennelId) to the new group
        await prisma.kennelHasher.updateMany({
          where: { rosterGroupId: existing.groupId },
          data: { rosterGroupId: group.id },
        });
        await prisma.rosterGroup.delete({ where: { id: existing.groupId } });
      }
    }

    // Add to new group
    await prisma.rosterGroupKennel.create({
      data: { groupId: group.id, kennelId },
    });
  }

  logAdminAudit("create_roster_group", admin.id, {
    groupId: group.id,
    name: name.trim(),
    kennelIds,
  });

  revalidatePath("/admin/roster-groups");
  return { success: true, groupId: group.id };
}

/**
 * Add a kennel to an existing roster group.
 */
export async function addKennelToGroup(groupId: string, kennelId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  // Remove from current group
  const existing = await prisma.rosterGroupKennel.findUnique({
    where: { kennelId },
    select: { id: true, groupId: true },
  });

  if (existing) {
    await prisma.rosterGroupKennel.delete({ where: { id: existing.id } });

    // Move hashers from old group
    await prisma.kennelHasher.updateMany({
      where: { rosterGroupId: existing.groupId, kennelId },
      data: { rosterGroupId: groupId },
    });

    // Clean up old group if empty
    const remainingKennels = await prisma.rosterGroupKennel.count({
      where: { groupId: existing.groupId },
    });
    if (remainingKennels === 0) {
      await prisma.kennelHasher.updateMany({
        where: { rosterGroupId: existing.groupId },
        data: { rosterGroupId: groupId },
      });
      await prisma.rosterGroup.delete({ where: { id: existing.groupId } });
    }
  }

  // Add to target group
  await prisma.rosterGroupKennel.create({
    data: { groupId, kennelId },
  });

  logAdminAudit("add_kennel_to_group", admin.id, {
    groupId,
    kennelId,
  });

  revalidatePath("/admin/roster-groups");
  return { success: true };
}

/**
 * Remove a kennel from a group. Creates a new standalone group for it.
 */
export async function removeKennelFromGroup(groupId: string, kennelId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  // Create a new standalone group
  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { shortName: true },
  });
  if (!kennel) return { error: "Kennel not found" };

  const standaloneGroup = await prisma.rosterGroup.create({
    data: { name: kennel.shortName },
  });

  // Move kennel to standalone group
  await prisma.rosterGroupKennel.update({
    where: { kennelId },
    data: { groupId: standaloneGroup.id },
  });

  // Move hashers with this kennelId to the standalone group
  await prisma.kennelHasher.updateMany({
    where: { rosterGroupId: groupId, kennelId },
    data: { rosterGroupId: standaloneGroup.id },
  });

  logAdminAudit("remove_kennel_from_group", admin.id, {
    groupId,
    kennelId,
  });

  revalidatePath("/admin/roster-groups");
  return { success: true };
}

/**
 * Rename a roster group.
 */
export async function renameRosterGroup(groupId: string, name: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  if (!name.trim()) return { error: "Name is required" };

  await prisma.rosterGroup.update({
    where: { id: groupId },
    data: { name: name.trim() },
  });

  revalidatePath("/admin/roster-groups");
  return { success: true };
}

/**
 * Delete a roster group. Converts each member kennel to a standalone group.
 */
export async function deleteRosterGroup(groupId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const group = await prisma.rosterGroup.findUnique({
    where: { id: groupId },
    include: {
      kennels: {
        include: { kennel: { select: { shortName: true } } },
      },
    },
  });
  if (!group) return { error: "Roster group not found" };

  // Convert each kennel to a standalone group
  for (const rgk of group.kennels) {
    const standaloneGroup = await prisma.rosterGroup.create({
      data: { name: rgk.kennel.shortName },
    });

    await prisma.rosterGroupKennel.update({
      where: { id: rgk.id },
      data: { groupId: standaloneGroup.id },
    });

    await prisma.kennelHasher.updateMany({
      where: { rosterGroupId: groupId, kennelId: rgk.kennelId },
      data: { rosterGroupId: standaloneGroup.id },
    });
  }

  // Move orphaned hashers (no kennelId) — shouldn't exist but be safe
  const orphanedCount = await prisma.kennelHasher.count({
    where: { rosterGroupId: groupId },
  });
  if (orphanedCount > 0) {
    // Assign to first kennel's standalone group as fallback
    const firstStandaloneKennel = await prisma.rosterGroupKennel.findFirst({
      where: { kennelId: { in: group.kennels.map((k) => k.kennelId) } },
      select: { groupId: true },
    });
    if (firstStandaloneKennel) {
      await prisma.kennelHasher.updateMany({
        where: { rosterGroupId: groupId },
        data: { rosterGroupId: firstStandaloneKennel.groupId },
      });
    }
  }

  // Delete the original group
  await prisma.rosterGroup.delete({ where: { id: groupId } });

  logAdminAudit("delete_roster_group", admin.id, {
    groupId,
    groupName: group.name,
    kennelCount: group.kennels.length,
  });

  revalidatePath("/admin/roster-groups");
  return { success: true };
}

/**
 * Fetch pending roster group requests for admin review.
 */
export async function getRosterGroupRequests() {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const requests = await prisma.rosterGroupRequest.findMany({
    where: { status: "PENDING" },
    include: {
      user: { select: { id: true, email: true, hashName: true, nerdName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Resolve kennel names from IDs stored in JSON
  const allKennelIds = requests.flatMap((r) => r.kennelIds as string[]);
  const kennels = await prisma.kennel.findMany({
    where: { id: { in: allKennelIds } },
    select: { id: true, shortName: true },
  });
  const kennelMap = new Map(kennels.map((k) => [k.id, k.shortName]));

  return {
    data: requests.map((r) => ({
      id: r.id,
      user: r.user,
      proposedName: r.proposedName,
      kennelIds: r.kennelIds as string[],
      kennelNames: (r.kennelIds as string[]).map(
        (id) => kennelMap.get(id) ?? "Unknown",
      ),
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/**
 * Approve a roster group request — creates the group with the proposed name and kennels.
 */
export async function approveRosterGroupRequest(requestId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const request = await prisma.rosterGroupRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) return { error: "Request not found" };
  if (request.status !== "PENDING") return { error: "Request is no longer pending" };

  // Create the group using the existing function (without admin re-check since we already checked)
  const kennelIds = request.kennelIds as string[];
  const result = await createRosterGroup(request.proposedName, kennelIds);
  if (result.error) return { error: result.error };

  // Mark request as approved
  await prisma.rosterGroupRequest.update({
    where: { id: requestId },
    data: {
      status: "APPROVED",
      resolvedBy: admin.id,
      resolvedAt: new Date(),
    },
  });

  logAdminAudit("approve_roster_group_request", admin.id, {
    requestId,
    proposedName: request.proposedName,
    kennelIds,
  });

  revalidatePath("/admin/roster-groups");
  return { success: true };
}

/**
 * Reject a roster group request.
 */
export async function rejectRosterGroupRequest(requestId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const request = await prisma.rosterGroupRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) return { error: "Request not found" };
  if (request.status !== "PENDING") return { error: "Request is no longer pending" };

  await prisma.rosterGroupRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      resolvedBy: admin.id,
      resolvedAt: new Date(),
    },
  });

  logAdminAudit("reject_roster_group_request", admin.id, {
    requestId,
  });

  revalidatePath("/admin/roster-groups");
  return { success: true };
}
