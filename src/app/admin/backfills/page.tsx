import Link from "next/link";
import { prisma } from "@/lib/db";
import { backfillMode } from "@/lib/backfill/agent";
import { Badge } from "@/components/ui/badge";
import { BackfillProbe } from "./probe";

export const dynamic = "force-dynamic";

export default async function BackfillsPage() {
  const [runs, cutoffs] = await Promise.all([
    prisma.backfillRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, prNumber: true, status: true, binding: true, reasonCodes: true, counts: true, createdAt: true, kennel: { select: { kennelCode: true, shortName: true } } },
    }),
    prisma.kennel.findMany({ where: { archiveCutoffDate: { not: null } }, select: { id: true, kennelCode: true, archiveCutoffDate: true, archiveCutoffRunId: true } }),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Backfills</h1>
        <p className="text-sm text-muted-foreground">
          Onboarding backfill runs (design: docs/onboarding-backfill-automation-design.md). BACKFILL_AUTOMATION is <strong>{backfillMode()}</strong>.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th>PR</th><th>Kennel</th><th>Status</th><th>Counts</th><th>Reasons</th><th>Created</th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-t">
              <td><Link className="underline" href={`/admin/backfills/${r.id}`}>#{r.prNumber}</Link></td>
              <td>{r.kennel?.shortName ?? "—"}</td>
              <td><Badge variant="outline">{r.status}</Badge> {r.binding === "ADOPT_ONLY" ? "adopt" : ""}</td>
              <td className="font-mono text-xs">{JSON.stringify(r.counts ?? {})}</td>
              <td className="text-xs">{r.reasonCodes.join("; ")}</td>
              <td>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
            </tr>
          ))}
          {runs.length === 0 && <tr><td colSpan={6} className="py-4 text-muted-foreground">No runs yet.</td></tr>}
        </tbody>
      </table>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Archive cutoffs</h2>
        {cutoffs.length === 0 ? <p className="text-sm text-muted-foreground">No kennel has a cutoff.</p> : (
          <ul className="text-sm">
            {cutoffs.map((k) => <li key={k.id}>{k.kennelCode}: {k.archiveCutoffDate?.toISOString().slice(0, 10)} {k.archiveCutoffRunId ? `(run ${k.archiveCutoffRunId})` : "(set by hand)"}</li>)}
          </ul>
        )}
      </section>
      <BackfillProbe />
    </div>
  );
}
