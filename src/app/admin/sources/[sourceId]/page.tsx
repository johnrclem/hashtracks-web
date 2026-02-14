import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
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
import { TYPE_LABELS } from "@/components/admin/SourceTable";

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

// Phase 1: Color-code fill rates based on thresholds
function FillRateCell({ rate }: { rate: number | null | undefined }) {
  if (rate == null) return <TableCell className="text-center text-xs text-muted-foreground">—</TableCell>;

  let colorClass = "";
  if (rate > 90) {
    colorClass = "text-green-600 dark:text-green-400 font-medium";
  } else if (rate >= 70) {
    colorClass = "text-yellow-600 dark:text-yellow-400 font-medium";
  } else {
    colorClass = "text-red-600 dark:text-red-400 font-medium";
  }

  return (
    <TableCell className={`text-center text-xs ${colorClass}`}>
      {rate}%
    </TableCell>
  );
}

// Phase 1: Categorize errors by type (pattern matching on message content)
function categorizeErrors(errors: string[]): {
  fetch: string[];
  parse: string[];
  merge: string[];
} {
  const fetch: string[] = [];
  const parse: string[] = [];
  const merge: string[] = [];

  for (const err of errors) {
    const lower = err.toLowerCase();
    if (
      lower.includes("fetch") ||
      lower.includes("http") ||
      lower.includes("connection") ||
      lower.includes("timeout") ||
      lower.includes("network")
    ) {
      fetch.push(err);
    } else if (
      lower.includes("parse") ||
      lower.includes("row") ||
      lower.includes("extract") ||
      lower.includes("decode")
    ) {
      parse.push(err);
    } else if (
      lower.includes("merge") ||
      lower.includes("duplicate") ||
      lower.includes("fingerprint") ||
      lower.includes("kennel")
    ) {
      merge.push(err);
    } else {
      // Default to parse for unknown errors
      parse.push(err);
    }
  }

  return { fetch, parse, merge };
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

  // Get scrape logs, counts, alerts (most recent first)
  const [scrapeLogs, rawEventCount, linkedEventCount, allKennels, openAlertCount, recentAlerts, structureHashHistory, recentScrapeWithSamples] =
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
      prisma.alert.count({
        where: { sourceId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      }),
      prisma.alert.findMany({
        where: { sourceId },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      // Phase 1: Structure hash history for HTML sources
      source.type === "HTML_SCRAPER"
        ? prisma.scrapeLog.findMany({
            where: { sourceId, structureHash: { not: null } },
            orderBy: { startedAt: "desc" },
            take: 10,
            select: { id: true, startedAt: true, structureHash: true },
          })
        : Promise.resolve([]),
      // Phase 2B: Most recent scrape with sample events
      prisma.scrapeLog.findFirst({
        where: {
          sourceId,
          OR: [
            { sampleBlocked: { not: Prisma.AnyNull } },
            { sampleSkipped: { not: Prisma.AnyNull } },
          ],
        },
        orderBy: { startedAt: "desc" },
        select: { id: true, startedAt: true, sampleBlocked: true, sampleSkipped: true },
      }),
    ]);

  // Phase 1: Detect hash changes and link to STRUCTURE_CHANGE alerts
  const hashChanges = new Map<string, boolean>();
  let prevHash: string | null = null;
  for (let i = structureHashHistory.length - 1; i >= 0; i--) {
    const curr = structureHashHistory[i];
    if (curr.structureHash && prevHash && curr.structureHash !== prevHash) {
      hashChanges.set(curr.id, true);
    }
    prevHash = curr.structureHash;
  }

  // Get alerts linked to structure hash changes
  const structureAlerts = await prisma.alert.findMany({
    where: {
      sourceId,
      type: "STRUCTURE_CHANGE",
      scrapeLogId: { in: Array.from(hashChanges.keys()) },
    },
    select: { scrapeLogId: true, status: true },
  });

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
          <Badge variant="outline">{TYPE_LABELS[source.type] ?? source.type}</Badge>
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
          scrapeDays: source.scrapeDays,
          linkedKennelIds: source.kennels.map((sk) => sk.kennelId),
        }}
        allKennels={allKennels}
      />

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-5">
        <StatCard label="Trust Level" value={`${source.trustLevel}/10`} />
        <StatCard label="Frequency" value={source.scrapeFreq} />
        <StatCard label="Raw Events" value={rawEventCount.toString()} />
        <StatCard label="Linked Events" value={linkedEventCount.toString()} />
        <StatCard label="Open Alerts" value={openAlertCount.toString()} />
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

      {/* Recent Alerts */}
      {recentAlerts.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Alerts</h2>
            <Link
              href={`/admin/alerts?source=${sourceId}`}
              className="text-sm text-primary hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="space-y-2">
            {recentAlerts.map((alert) => {
              const severityColors: Record<string, string> = {
                CRITICAL: "border-l-red-500",
                WARNING: "border-l-amber-500",
                INFO: "border-l-blue-500",
              };
              const statusBadge: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
                OPEN: "destructive",
                ACKNOWLEDGED: "secondary",
                SNOOZED: "outline",
                RESOLVED: "outline",
              };
              return (
                <div
                  key={alert.id}
                  className={`flex items-center gap-3 rounded-md border border-l-4 px-3 py-2 text-sm ${severityColors[alert.severity] ?? ""}`}
                >
                  <Badge variant={statusBadge[alert.status] ?? "outline"} className="text-xs">
                    {alert.status}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {alert.type.replace(/_/g, " ")}
                  </Badge>
                  <span className="truncate">{alert.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatNYC(alert.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sample Blocked/Skipped Events (Phase 2B) */}
      {recentScrapeWithSamples && (recentScrapeWithSamples.sampleBlocked || recentScrapeWithSamples.sampleSkipped) && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">
            Sample Events from Recent Scrape
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({formatNYC(recentScrapeWithSamples.startedAt)})
            </span>
          </h2>

          {recentScrapeWithSamples.sampleBlocked && Array.isArray(recentScrapeWithSamples.sampleBlocked) && recentScrapeWithSamples.sampleBlocked.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium">
                🚫 Sample Blocked Events ({recentScrapeWithSamples.sampleBlocked.length})
              </h3>
              <div className="space-y-2">
                {(recentScrapeWithSamples.sampleBlocked as Array<{
                  reason: string;
                  kennelTag: string;
                  event: { title?: string; date?: string; location?: string };
                  suggestedAction?: string;
                }>).map((sample, idx) => (
                  <div key={idx} className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {sample.kennelTag}
                          </Badge>
                          <span className="text-sm font-medium">{sample.event.title || "Untitled Event"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {sample.event.date && <span>{sample.event.date}</span>}
                          {sample.event.location && <span> • {sample.event.location}</span>}
                        </div>
                        <div className="text-xs text-red-700 dark:text-red-300">
                          Reason: {sample.reason.replace(/_/g, " ")}
                        </div>
                      </div>
                      {sample.suggestedAction && (
                        <Badge variant="secondary" className="text-xs whitespace-nowrap">
                          {sample.suggestedAction}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recentScrapeWithSamples.sampleSkipped && Array.isArray(recentScrapeWithSamples.sampleSkipped) && recentScrapeWithSamples.sampleSkipped.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">
                ⏭️ Sample Skipped Events ({recentScrapeWithSamples.sampleSkipped.length})
              </h3>
              <div className="space-y-2">
                {(recentScrapeWithSamples.sampleSkipped as Array<{
                  reason: string;
                  kennelTag: string;
                  event: { title?: string; date?: string; location?: string };
                  suggestedAction?: string;
                }>).map((sample, idx) => (
                  <div key={idx} className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {sample.kennelTag}
                          </Badge>
                          <span className="text-sm font-medium">{sample.event.title || "Untitled Event"}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {sample.event.date && <span>{sample.event.date}</span>}
                          {sample.event.location && <span> • {sample.event.location}</span>}
                        </div>
                        <div className="text-xs text-amber-700 dark:text-amber-300">
                          Reason: {sample.reason.replace(/_/g, " ")}
                        </div>
                      </div>
                      {sample.suggestedAction && (
                        <Badge variant="secondary" className="text-xs whitespace-nowrap">
                          {sample.suggestedAction}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Structure Hash History (Phase 1) */}
      {structureHashHistory.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Structure Hash History (Last 10 Runs)</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Hash (first 8 chars)</TableHead>
                  <TableHead className="text-center">Changed?</TableHead>
                  <TableHead>Linked Alert</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {structureHashHistory.map((log) => {
                  const changed = hashChanges.get(log.id);
                  const alert = structureAlerts.find((a) => a.scrapeLogId === log.id);
                  return (
                    <TableRow
                      key={log.id}
                      className={changed ? "bg-red-50 dark:bg-red-950/20" : undefined}
                    >
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatNYC(log.startedAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.structureHash?.substring(0, 8) ?? "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {changed && <span className="text-red-600 dark:text-red-400 text-lg">⚠️</span>}
                      </TableCell>
                      <TableCell>
                        {alert ? (
                          <Badge variant={alert.status === "OPEN" ? "destructive" : "outline"} className="text-xs">
                            STRUCTURE_CHANGE ({alert.status})
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Scrape History */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">Scrape History (Last 25 Runs)</h2>
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
                <TableHead className="text-center">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">T%</TooltipTrigger>
                    <TooltipContent>Title fill rate</TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="text-center">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">L%</TooltipTrigger>
                    <TooltipContent>Location fill rate</TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="text-center">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">H%</TooltipTrigger>
                    <TooltipContent>Hares fill rate</TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="text-center">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">ST%</TooltipTrigger>
                    <TooltipContent>Start time fill rate</TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="text-center">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">R#%</TooltipTrigger>
                    <TooltipContent>Run number fill rate</TooltipContent>
                  </Tooltip>
                </TableHead>
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
                  <FillRateCell rate={log.fillRateTitle} />
                  <FillRateCell rate={log.fillRateLocation} />
                  <FillRateCell rate={log.fillRateHares} />
                  <FillRateCell rate={log.fillRateStartTime} />
                  <FillRateCell rate={log.fillRateRunNumber} />
                  <TableCell className="text-xs">
                    {log.durationMs != null
                      ? `${(log.durationMs / 1000).toFixed(1)}s`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {log.errors.length > 0 ? (
                      (() => {
                        const categorized = categorizeErrors(log.errors);
                        const hasFetch = categorized.fetch.length > 0;
                        const hasParse = categorized.parse.length > 0;
                        const hasMerge = categorized.merge.length > 0;

                        return (
                          <div className="text-xs space-y-1">
                            <div className="text-destructive font-medium">
                              {hasFetch && `📡 Fetch: ${categorized.fetch.length}`}
                              {hasFetch && (hasParse || hasMerge) && " | "}
                              {hasParse && `🔨 Parse: ${categorized.parse.length}`}
                              {hasParse && hasMerge && " | "}
                              {hasMerge && `🔀 Merge: ${categorized.merge.length}`}
                            </div>

                            {hasFetch && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                  📡 Fetch Errors ({categorized.fetch.length})
                                </summary>
                                <ul className="mt-1 ml-4 space-y-1">
                                  {categorized.fetch.map((err, i) => (
                                    <li key={i} className="text-muted-foreground break-all">
                                      {err}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}

                            {hasParse && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                  🔨 Parse Errors ({categorized.parse.length})
                                </summary>
                                <ul className="mt-1 ml-4 space-y-1">
                                  {categorized.parse.map((err, i) => (
                                    <li key={i} className="text-muted-foreground break-all">
                                      {err}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}

                            {hasMerge && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                  🔀 Merge Errors ({categorized.merge.length})
                                </summary>
                                <ul className="mt-1 ml-4 space-y-1">
                                  {categorized.merge.map((err, i) => (
                                    <li key={i} className="text-muted-foreground break-all">
                                      {err}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </div>
                        );
                      })()
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
