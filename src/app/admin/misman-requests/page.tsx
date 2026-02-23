import { prisma } from "@/lib/db";
import { MismanAdminTabs } from "@/components/admin/MismanRequestQueue";

export default async function AdminMismanRequestsPage() {
  const [requests, kennels, invites, activeMismans, approvedRequests, acceptedInvites] =
    await Promise.all([
      // Pending requests (Tab 1)
      prisma.mismanRequest.findMany({
        where: { status: "PENDING" },
        include: {
          user: {
            select: { id: true, email: true, hashName: true, nerdName: true },
          },
          kennel: { select: { shortName: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      // All kennels for invite dialog
      prisma.kennel.findMany({
        select: { id: true, shortName: true, fullName: true, region: true },
        orderBy: { shortName: "asc" },
      }),
      // All invites (Tab 2)
      prisma.mismanInvite.findMany({
        include: {
          kennel: { select: { shortName: true, slug: true } },
          inviter: { select: { hashName: true, email: true } },
          acceptor: { select: { hashName: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      // Active mismans (Tab 3)
      prisma.userKennel.findMany({
        where: { role: { in: ["MISMAN", "ADMIN"] } },
        include: {
          user: {
            select: { id: true, email: true, hashName: true, nerdName: true },
          },
          kennel: { select: { id: true, shortName: true, slug: true } },
        },
        orderBy: [{ kennel: { shortName: "asc" } }, { createdAt: "asc" }],
      }),
      // Approved requests — for grant source cross-ref
      prisma.mismanRequest.findMany({
        where: { status: "APPROVED" },
        select: { userId: true, kennelId: true },
      }),
      // Accepted invites — for grant source cross-ref
      prisma.mismanInvite.findMany({
        where: { status: "ACCEPTED" },
        select: { acceptedBy: true, kennelId: true },
      }),
    ]);

  // Serialize requests
  const serializedRequests = requests.map((r) => ({
    id: r.id,
    user: r.user,
    kennel: r.kennel,
    message: r.message,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));

  // Serialize invites with effective status
  const now = new Date();
  const serializedInvites = invites.map((inv) => {
    const effectiveStatus =
      inv.status === "PENDING" && inv.expiresAt <= now ? "EXPIRED" : inv.status;
    return {
      id: inv.id,
      kennelShortName: inv.kennel.shortName,
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

  // Build grant source lookup: "userId:kennelId" → source
  const grantSourceMap = new Map<string, "request" | "invite">();
  for (const req of approvedRequests) {
    grantSourceMap.set(`${req.userId}:${req.kennelId}`, "request");
  }
  for (const inv of acceptedInvites) {
    if (inv.acceptedBy) {
      grantSourceMap.set(`${inv.acceptedBy}:${inv.kennelId}`, "invite");
    }
  }

  // Serialize active mismans
  const serializedMismans = activeMismans.map((m) => ({
    id: m.id,
    user: m.user,
    kennel: m.kennel,
    role: m.role,
    since: m.createdAt.toISOString(),
    grantSource:
      grantSourceMap.get(`${m.userId}:${m.kennelId}`) ?? ("manual" as const),
  }));

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Misman Management</h2>
      <MismanAdminTabs
        requests={serializedRequests}
        invites={serializedInvites}
        mismans={serializedMismans}
        kennels={kennels}
      />
    </div>
  );
}
