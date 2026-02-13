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

  // Get pending requests for kennels this user manages
  const managedKennelIds = mismanKennels.map((mk) => mk.kennel.id);
  const pendingRequests = managedKennelIds.length > 0
    ? await prisma.mismanRequest.findMany({
        where: {
          kennelId: { in: managedKennelIds },
          status: "PENDING",
        },
        include: {
          user: { select: { id: true, email: true, hashName: true, nerdName: true } },
          kennel: { select: { shortName: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // Get user's own pending requests
  const myPendingRequests = await prisma.mismanRequest.findMany({
    where: { userId: user.id, status: "PENDING" },
    include: {
      kennel: { select: { shortName: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
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
    kennel: r.kennel,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <MismanDashboard
      kennels={serializedKennels}
      pendingRequests={serializedRequests}
      myPendingRequests={serializedMyRequests}
      isSiteAdmin={isSiteAdmin}
    />
  );
}
