import { prisma } from "@/lib/db";
import { MismanAdminTabs } from "@/components/admin/MismanRequestQueue";

const INVITE_HISTORY_LIMIT = 200;

export default async function AdminMismanPage() {
  // Phase 1: fetch the main data sets in parallel
  const [requests, kennels, invites, activeMismans] = await Promise.all([
    // Pending requests (Tab 1)
    prisma.mismanRequest.findMany({
      where: { status: "PENDING" },
      include: {
        user: {
          select: { id: true, email: true, hashName: true, nerdName: true },
        },
        kennel: { select: { shortName: true, fullName: true, slug: true } },
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
        kennel: { select: { shortName: true, fullName: true, slug: true } },
        inviter: { select: { hashName: true, email: true } },
        acceptor: { select: { hashName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: INVITE_HISTORY_LIMIT,
    }),
    // Active mismans (Tab 3)
    prisma.userKennel.findMany({
      where: { role: { in: ["MISMAN", "ADMIN"] } },
      include: {
        user: {
          select: { id: true, email: true, hashName: true, nerdName: true },
        },
        kennel: {
          select: {
            id: true,
            shortName: true,
            fullName: true,
            slug: true,
          },
        },
      },
      orderBy: [{ kennel: { shortName: "asc" } }, { createdAt: "asc" }],
    }),
  ]);

  // Phase 2: fetch grant-source data scoped to active mismans only
  const mismanUserIds = [...new Set(activeMismans.map((m) => m.userId))];
  const mismanKennelIds = [...new Set(activeMismans.map((m) => m.kennelId))];

  const [approvedRequests, acceptedInvites] = await Promise.all([
    prisma.mismanRequest.findMany({
      where: {
        status: "APPROVED",
        userId: { in: mismanUserIds },
        kennelId: { in: mismanKennelIds },
      },
      select: { userId: true, kennelId: true },
    }),
    prisma.mismanInvite.findMany({
      where: {
        status: "ACCEPTED",
        acceptedBy: { in: mismanUserIds },
        kennelId: { in: mismanKennelIds },
      },
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
      kennelFullName: inv.kennel.fullName,
      kennelSlug: inv.kennel.slug,
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
