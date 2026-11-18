import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { RunControls } from "./controls";

export const dynamic = "force-dynamic";

export default async function BackfillRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await prisma.backfillRun.findUnique({
    where: { id: runId },
    include: { kennel: { select: { id: true, kennelCode: true, shortName: true, archiveCutoffDate: true, archiveCutoffRunId: true } } },
  });
  if (!run) notFound();
  const items = await prisma.backfillRunItem.groupBy({ by: ["outcome", "undoOutcome"], where: { runId }, _count: true });
  const facts: Array<[string, string]> = [
    ["PR", `#${run.prNumber}`],
    ["Kennel", run.kennel ? `${run.kennel.shortName} (${run.kennel.kennelCode})` : "—"],
    ["Manifest", run.manifestPath],
    ["Split point C", run.splitDate?.toISOString().slice(0, 10) ?? "—"],
    ["Merge S / stamp H / head M", [run.mergeSha, run.stampedSha, run.mergedHeadSha].map((s) => s?.slice(0, 8) ?? "—").join(" / ")],
    ["Cutoff", run.kennel?.archiveCutoffDate ? `${run.kennel.archiveCutoffDate.toISOString().slice(0, 10)}${run.kennel.archiveCutoffRunId === run.id ? " (this run)" : ""}` : "none"],
    ["Cursor", String(run.cursor)],
    ["Lease", run.leaseExpiresAt ? `held until ${run.leaseExpiresAt.toISOString()}` : "free"],
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Backfill run <Badge variant="outline">{run.status}</Badge></h1>
      <dl className="grid grid-cols-[12rem_1fr] gap-1 text-sm">
        {facts.map(([k, v]) => [<dt key={`${k}-k`} className="text-muted-foreground">{k}</dt>, <dd key={`${k}-v`} className="font-mono">{v}</dd>])}
      </dl>
      {run.reasonCodes.length > 0 && (
        <section><h2 className="font-semibold">Reasons</h2><ul className="list-disc pl-5 text-sm">{run.reasonCodes.map((r) => <li key={r}>{r}</li>)}</ul></section>
      )}
      <section>
        <h2 className="font-semibold">Items</h2>
        <ul className="text-sm">{items.map((i) => <li key={`${i.outcome}-${i.undoOutcome}`}>{i.outcome}{i.undoOutcome ? ` → ${i.undoOutcome}` : ""}: {i._count}</li>)}</ul>
      </section>
      <section>
        <h2 className="font-semibold">Counts, status lines and verification</h2>
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify({ counts: run.counts, statusLines: run.statusLines, verification: run.verification, batchLog: run.batchLog, stepLog: run.stepLog }, null, 2)}</pre>
      </section>
      <RunControls runId={run.id} status={run.status} kennelId={run.kennel?.id ?? null} hasCutoff={!!run.kennel?.archiveCutoffDate} />
    </div>
  );
}
