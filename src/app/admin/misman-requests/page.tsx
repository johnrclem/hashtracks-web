import { prisma } from "@/lib/db";
import { MismanRequestQueue } from "@/components/admin/MismanRequestQueue";

export default async function AdminMismanRequestsPage() {
  const requests = await prisma.mismanRequest.findMany({
    include: {
      user: {
        select: { id: true, email: true, hashName: true, nerdName: true },
      },
      kennel: { select: { shortName: true, slug: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const serialized = requests.map((r) => ({
    id: r.id,
    user: r.user,
    kennel: r.kennel,
    message: r.message,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Misman Requests</h2>
      <MismanRequestQueue requests={serialized} />
    </div>
  );
}
