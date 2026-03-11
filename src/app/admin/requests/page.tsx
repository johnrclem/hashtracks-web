import { prisma } from "@/lib/db";
import { RequestQueue } from "@/components/admin/RequestQueue";

export default async function AdminRequestsPage() {
  const requests = await prisma.kennelRequest.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  // Serialize dates for client component
  const serialized = requests.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  }));

  return (
    <div>
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Requests</h2>
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <RequestQueue requests={serialized} />
      </div>
    </div>
  );
}
