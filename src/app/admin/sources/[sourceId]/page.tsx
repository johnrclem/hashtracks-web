import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { SourceDetailActions } from "@/components/admin/SourceDetailActions";

const healthColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  HEALTHY: "default",
  DEGRADED: "secondary",
  FAILING: "destructive",
  STALE: "outline",
  UNKNOWN: "outline",
};

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  RUNNING: "secondary",
  SUCCESS: "default",
  FAILED: "destructive",
};

function formatNYC(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }) + " ET";
}

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}) {
  const admin = await getAdminUser();
  if (!admin) notFound();

  const { sourceId } = await params;

  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    include: {
      kennels: {
        include: { kennel: { select: { shortName: true, fullName: true, slug: true } } },
      },
    },
  });

  if (!source) notFound();

  // Get scrape logs (most recent first)
  const [scrapeLogs, rawEventCount, linkedEventCount, allKennels] =
    await Promise.all([
      prisma.scrapeLog.findMany({
        where: { sourceId },
        orderBy: { startedAt: "desc" },
        take: 25,
      }),
      prisma.rawEvent.count({
        where: { sourceId },
      }),
      prisma.rawEvent.count({
        where: { sourceId, processed: true },
      }),
      prisma.kennel.findMany({
        orderBy: { shortName: "asc" },
        select: { id: true, shortName: true },
      }),
    ]);

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/sources" className="hover:text-foreground">
          Sources
        </Link>
        <span>/</span>
        <span className="text-foreground">{source.name}</span>
      </nav>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{source.name}</h1>
          <Badge variant={healthColors[source.healthStatus]}>
            {source.healthStatus}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{source.url}</p>
      </div>

      {/* Actions */}
      <SourceDetailActions
        source={{
          id: source.id,
          name: source.name,
          url: source.url,
          type: source.type,
          trustLevel: source.trustLevel,
          scrapeFreq: source.scrapeFreq,
          linkedKennelIds: source.kennels.map((sk) => sk.kennelId),
        }}
        allKennels={allKennels}
      />

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Type" value={source.type} />
        <StatCard label="Trust Level" value={`${source.trustLevel}/10`} />
        <StatCard label="Raw Events" value={rawEventCount.toString()} />
        <StatCard label="Linked Events" value={linkedEventCount.toString()} />
      </div>

      {/* Linked Kennels */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Linked Kennels</h2>
        <div className="flex flex-wrap gap-2">
          {source.kennels.map((sk) => (
            <Tooltip key={sk.id}>
              <TooltipTrigger asChild>
                <Link href={`/kennels/${sk.kennel.slug}`}>
                  <Badge variant="outline" className="hover:bg-accent">
                    {sk.kennel.shortName}
                  </Badge>
                </Link>
              </TooltipTrigger>
              <TooltipContent>{sk.kennel.fullName}</TooltipContent>
            </Tooltip>
          ))}
          {source.kennels.length === 0 && (
            <p className="text-sm text-muted-foreground">No linked kennels</p>
          )}
        </div>
      </div>

      {/* Scrape History */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Scrape History</h2>
        {scrapeLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No scrape runs recorded yet. Trigger a scrape from the{" "}
            <Link href="/admin/sources" className="underline">
              sources page
            </Link>
            .
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Found</TableHead>
                <TableHead className="text-center">Created</TableHead>
                <TableHead className="text-center">Updated</TableHead>
                <TableHead className="text-center">Skipped</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scrapeLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatNYC(log.startedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Badge variant={statusColors[log.status]}>
                        {log.status}
                      </Badge>
                      {log.forced && (
                        <Badge variant="outline" className="text-xs">
                          Forced
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">{log.eventsFound}</TableCell>
                  <TableCell className="text-center">{log.eventsCreated}</TableCell>
                  <TableCell className="text-center">{log.eventsUpdated}</TableCell>
                  <TableCell className="text-center">{log.eventsSkipped}</TableCell>
                  <TableCell className="text-xs">
                    {log.durationMs != null
                      ? `${(log.durationMs / 1000).toFixed(1)}s`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {log.errors.length > 0 ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-destructive">
                          {log.errors.length} error{log.errors.length !== 1 ? "s" : ""}
                        </summary>
                        <ul className="mt-1 space-y-1">
                          {log.errors.map((err, i) => (
                            <li key={i} className="text-muted-foreground break-all">
                              {err}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                    {log.unmatchedTags.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Unmatched: {log.unmatchedTags.join(", ")}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Last scrape info */}
      <div className="text-xs text-muted-foreground">
        <p>Last scrape: {source.lastScrapeAt ? formatNYC(source.lastScrapeAt) : "Never"}</p>
        <p>Last success: {source.lastSuccessAt ? formatNYC(source.lastSuccessAt) : "Never"}</p>
        <p>Scrape frequency: {source.scrapeFreq}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
