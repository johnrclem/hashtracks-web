import { redirect } from "next/navigation";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MismanDashboard } from "@/components/misman/MismanDashboard";

export default async function MismanPage() {
  const user = await getOrCreateUser();
  if (!user) redirect("/sign-in");

  // Get kennels where user is MISMAN or ADMIN
  const mismanKennels = await prisma.userKennel.findMany({
    where: {
      userId: user.id,
      role: { in: ["MISMAN", "ADMIN"] },
    },
    include: {
      kennel: {
        select: {
          id: true,
          shortName: true,
          fullName: true,
          slug: true,
          region: true,
        },
      },
    },
    orderBy: { kennel: { shortName: "asc" } },
  });

  // Check if site admin (they can see all kennels' requests even without MISMAN role)
  const clerkUser = await (
    await import("@clerk/nextjs/server")
  ).currentUser();
  const isSiteAdmin =
    (clerkUser?.publicMetadata as { role?: string } | null)?.role === "admin";

  // Get pending requests — site admins see all, mismans see their kennels
  const managedKennelIds = mismanKennels.map((mk) => mk.kennel.id);
  const pendingRequests = await prisma.mismanRequest.findMany({
    where: {
      status: "PENDING",
      ...(isSiteAdmin ? {} : { kennelId: { in: managedKennelIds } }),
    },
    include: {
      user: { select: { id: true, email: true, hashName: true, nerdName: true } },
      kennel: { select: { shortName: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Get user's own pending requests
  const myPendingRequests = await prisma.mismanRequest.findMany({
    where: { userId: user.id, status: "PENDING" },
    include: {
      kennel: { select: { shortName: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Get user's pending roster group requests
  const myPendingRosterGroupRequests = await prisma.rosterGroupRequest.findMany({
    where: { userId: user.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });

  // Fetch all kennels for the "request another kennel" picker (exclude hidden)
  const allKennels = await prisma.kennel.findMany({
    where: { isHidden: false },
    select: { id: true, shortName: true, fullName: true, region: true },
    orderBy: { shortName: "asc" },
  });

  const serializedKennels = mismanKennels.map((mk) => ({
    ...mk.kennel,
    role: mk.role,
  }));

  const serializedRequests = pendingRequests.map((r) => ({
    id: r.id,
    user: r.user,
    kennel: r.kennel,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
  }));

  const serializedMyRequests = myPendingRequests.map((r) => ({
    id: r.id,
    kennelId: r.kennelId,
    kennel: r.kennel,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
  }));

  // Resolve kennel names for roster group requests
  const rosterGroupKennelIds = myPendingRosterGroupRequests.flatMap(
    (r) => r.kennelIds as string[],
  );
  const rosterGroupKennels = rosterGroupKennelIds.length > 0
    ? await prisma.kennel.findMany({
        where: { id: { in: rosterGroupKennelIds } },
        select: { id: true, shortName: true },
      })
    : [];
  const rosterGroupKennelMap = new Map(rosterGroupKennels.map((k) => [k.id, k.shortName]));

  const serializedRosterGroupRequests = myPendingRosterGroupRequests.map((r) => ({
    id: r.id,
    proposedName: r.proposedName,
    kennelNames: (r.kennelIds as string[]).map(
      (id) => rosterGroupKennelMap.get(id) ?? "Unknown",
    ),
    message: r.message,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <MismanDashboard
      kennels={serializedKennels}
      pendingRequests={serializedRequests}
      myPendingRequests={serializedMyRequests}
      myPendingRosterGroupRequests={serializedRosterGroupRequests}
      isSiteAdmin={isSiteAdmin}
      allKennels={allKennels}
    />
  );
}
