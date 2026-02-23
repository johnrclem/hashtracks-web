import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { ErrorDetails, ParseError } from "@/adapters/types";
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
import { SampleEventActions } from "@/components/admin/SampleEventActions";
import { TroubleshootSection } from "@/components/admin/TroubleshootSection";
import { TYPE_LABELS } from "@/components/admin/SourceTable";
import { fuzzyMatch } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";

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
function FillRateCell({ rate, className }: { rate: number | null | undefined; className?: string }) {
  if (rate == null) return <TableCell className={cn("text-center text-xs text-muted-foreground", className)}>—</TableCell>;

  let colorClass = "";
  if (rate > 90) {
    colorClass = "text-green-600 dark:text-green-400 font-medium";
  } else if (rate >= 70) {
    colorClass = "text-yellow-600 dark:text-yellow-400 font-medium";
  } else {
    colorClass = "text-red-600 dark:text-red-400 font-medium";
  }

  return (
    <TableCell className={cn("text-center text-xs", colorClass, className)}>
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

/**
 * Display errors — prefer structured errorDetails (Phase 2A) with fallback to categorizeErrors().
 */
function ErrorDisplay({ errors, errorDetails }: { errors: string[]; errorDetails: ErrorDetails | null }) {
  // Phase 2A: Use structured errorDetails when available
  if (errorDetails && ((errorDetails.fetch?.length ?? 0) > 0 || (errorDetails.parse?.length ?? 0) > 0 || (errorDetails.merge?.length ?? 0) > 0)) {
    const fetchErrors = errorDetails.fetch ?? [];
    const parseErrors = errorDetails.parse ?? [];
    const mergeErrors = errorDetails.merge ?? [];

    return (
      <div className="text-xs space-y-1">
        <div className="text-destructive font-medium">
          {fetchErrors.length > 0 && `Fetch: ${fetchErrors.length}`}
          {fetchErrors.length > 0 && (parseErrors.length > 0 || mergeErrors.length > 0) && " | "}
          {parseErrors.length > 0 && `Parse: ${parseErrors.length}`}
          {parseErrors.length > 0 && mergeErrors.length > 0 && " | "}
          {mergeErrors.length > 0 && `Merge: ${mergeErrors.length}`}
        </div>

        {fetchErrors.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Fetch Errors ({fetchErrors.length})
            </summary>
            <div className="mt-1 ml-2 space-y-1">
              {fetchErrors.map((err, i) => (
                <div key={i} className="text-muted-foreground">
                  {err.url && <span className="font-mono text-[10px] break-all">{err.url}</span>}
                  {err.status && <Badge variant="outline" className="ml-1 text-[10px] py-0">{err.status}</Badge>}
                  <p className="break-all">{err.message}</p>
                </div>
              ))}
            </div>
          </details>
        )}

        {parseErrors.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Parse Errors ({parseErrors.length})
            </summary>
            <div className="mt-1 ml-2 space-y-1.5">
              {(parseErrors as ParseError[]).map((err, i) => (
                <div key={i} className="text-muted-foreground border-l-2 border-muted pl-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px]">Row {err.row}</span>
                    {err.section && <Badge variant="outline" className="text-[10px] py-0">{err.section}</Badge>}
                    {err.field && <Badge variant="secondary" className="text-[10px] py-0">{err.field}</Badge>}
                  </div>
                  <p className="break-all">{err.error}</p>
                  {err.partialData && Object.keys(err.partialData).length > 0 && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-[10px]">Partial data</summary>
                      <pre className="text-[10px] mt-0.5 overflow-x-auto">{JSON.stringify(err.partialData, null, 1)}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {mergeErrors.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Merge Errors ({mergeErrors.length})
            </summary>
            <div className="mt-1 ml-2 space-y-1">
              {mergeErrors.map((err, i) => (
                <div key={i} className="text-muted-foreground">
                  {err.fingerprint && (
                    <span className="font-mono text-[10px]">{err.fingerprint.substring(0, 12)}...</span>
                  )}
                  <span className="ml-1 break-all">{err.reason}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    );
  }

  // Fallback: categorize flat error strings (for old scrape logs without errorDetails)
  const categorized = categorizeErrors(errors);
  const hasFetch = categorized.fetch.length > 0;
  const hasParse = categorized.parse.length > 0;
  const hasMerge = categorized.merge.length > 0;

  return (
    <div className="text-xs space-y-1">
      <div className="text-destructive font-medium">
        {hasFetch && `Fetch: ${categorized.fetch.length}`}
        {hasFetch && (hasParse || hasMerge) && " | "}
        {hasParse && `Parse: ${categorized.parse.length}`}
        {hasParse && hasMerge && " | "}
        {hasMerge && `Merge: ${categorized.merge.length}`}
      </div>

      {hasFetch && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Fetch Errors ({categorized.fetch.length})
          </summary>
          <ul className="mt-1 ml-4 space-y-1">
            {categorized.fetch.map((err, i) => (
              <li key={i} className="text-muted-foreground break-all">{err}</li>
            ))}
          </ul>
        </details>
      )}

      {hasParse && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Parse Errors ({categorized.parse.length})
          </summary>
          <ul className="mt-1 ml-4 space-y-1">
            {categorized.parse.map((err, i) => (
              <li key={i} className="text-muted-foreground break-all">{err}</li>
            ))}
          </ul>
        </details>
      )}

      {hasMerge && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Merge Errors ({categorized.merge.length})
          </summary>
          <ul className="mt-1 ml-4 space-y-1">
            {categorized.merge.map((err, i) => (
              <li key={i} className="text-muted-foreground break-all">{err}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
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
  const [scrapeLogs, rawEventCount, linkedEventCount, allKennels, openAlertCount, recentAlerts, structureHashHistory, recentScrapeWithSamples, recentRawEvents] =
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
        select: {
          id: true,
          shortName: true,
          fullName: true,
          region: true,
          aliases: { select: { alias: true } },
        },
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
      // Recent events from this source (last 50 raw events, deduped by eventId in UI)
      prisma.rawEvent.findMany({
        where: { sourceId, processed: true, eventId: { not: null } },
        orderBy: { scrapedAt: "desc" },
        take: 50,
        select: {
          id: true,
          scrapedAt: true,
          event: {
            select: {
              id: true,
              date: true,
              title: true,
              locationName: true,
              haresText: true,
              startTime: true,
              runNumber: true,
              kennel: { select: { shortName: true, slug: true } },
            },
          },
        },
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

  // Compute fuzzy suggestions for unmatched tags in sample events
  const fuzzyCandidates = allKennels.map((k) => ({
    id: k.id,
    shortName: k.shortName,
    fullName: k.fullName,
    aliases: k.aliases.map((a) => a.alias),
  }));
  const sampleSuggestions: Record<string, { id: string; shortName: string; score: number }[]> = {};
  const sampleSkippedArr = recentScrapeWithSamples?.sampleSkipped;
  if (sampleSkippedArr && Array.isArray(sampleSkippedArr)) {
    for (const sample of sampleSkippedArr as Array<{ kennelTag: string }>) {
      if (!sampleSuggestions[sample.kennelTag]) {
        sampleSuggestions[sample.kennelTag] = fuzzyMatch(sample.kennelTag, fuzzyCandidates);
      }
    }
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
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h1 className="text-2xl font-bold">{source.name}</h1>
          <Badge variant="outline">{TYPE_LABELS[source.type] ?? source.type}</Badge>
          <Badge variant={healthColors[source.healthStatus]}>
            {source.healthStatus}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground break-all">{source.url}</p>
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
          config: source.config,
          linkedKennelIds: source.kennels.map((sk) => sk.kennelId),
        }}
        allKennels={allKennels}
      />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label="Trust Level" value={`${source.trustLevel}/10`} />
        <StatCard label="Frequency" value={source.scrapeFreq} />
        <StatCard label="Raw Events" value={rawEventCount.toString()} />
        <StatCard label="Linked Events" value={linkedEventCount.toString()} />
        <StatCard
          label="Open Alerts"
          value={openAlertCount.toString()}
          href={openAlertCount > 0 ? `/admin/alerts?source=${sourceId}` : undefined}
        />
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

      {/* Troubleshoot Config */}
      <TroubleshootSection
        url={source.url}
        type={source.type}
        config={source.config as Record<string, unknown> | null}
        allKennels={allKennels}
        linkedKennelIds={source.kennels.map((sk) => sk.kennelId)}
        geminiAvailable={!!process.env.GEMINI_API_KEY}
      />

      {/* Recent Events */}
      {(() => {
        // Deduplicate by eventId, keep most recent RawEvent per canonical Event
        const seen = new Set<string>();
        const uniqueEvents = recentRawEvents.filter((re) => {
          if (!re.event) return false;
          if (seen.has(re.event.id)) return false;
          seen.add(re.event.id);
          return true;
        });
        // Sort by event date descending
        uniqueEvents.sort((a, b) => {
          if (!a.event || !b.event) return 0;
          return b.event.date.getTime() - a.event.date.getTime();
        });

        return (
          <div>
            <h2 className="mb-2 text-lg font-semibold">
              Recent Events
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({uniqueEvents.length} unique)
              </span>
            </h2>
            {uniqueEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No events processed yet. Trigger a scrape to see results.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Kennel</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead className="hidden sm:table-cell">Location</TableHead>
                      <TableHead className="hidden md:table-cell">Hares</TableHead>
                      <TableHead className="hidden sm:table-cell">Time</TableHead>
                      <TableHead className="hidden sm:table-cell">R#</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {uniqueEvents.map((re) => {
                      const evt = re.event!;
                      const dateStr = evt.date.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      });
                      return (
                        <TableRow key={evt.id}>
                          <TableCell className="text-xs whitespace-nowrap">{dateStr}</TableCell>
                          <TableCell>
                            <Link href={`/kennels/${evt.kennel.slug}`}>
                              <Badge variant="outline" className="text-xs hover:bg-accent">
                                {evt.kennel.shortName}
                              </Badge>
                            </Link>
                          </TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">
                            {evt.title || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-xs max-w-[200px] truncate">
                            {evt.locationName || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs max-w-[150px] truncate">
                            {evt.haresText || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-xs whitespace-nowrap">
                            {evt.startTime || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-xs">
                            {evt.runNumber ? `#${evt.runNumber}` : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/hareline/${evt.id}`}
                              className="text-xs text-primary hover:underline"
                            >
                              View
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );
      })()}

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
                  className={`flex flex-wrap items-center gap-2 sm:gap-3 rounded-md border border-l-4 px-3 py-2 text-sm ${severityColors[alert.severity] ?? ""}`}
                >
                  <Badge variant={statusBadge[alert.status] ?? "outline"} className="text-xs">
                    {alert.status}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {alert.type.replace(/_/g, " ")}
                  </Badge>
                  <span className="truncate min-w-0">{alert.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground sm:ml-auto">
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
                      <SampleEventActions
                        sourceId={sourceId}
                        reason={sample.reason}
                        kennelTag={sample.kennelTag}
                        allKennels={allKennels}
                        suggestions={sampleSuggestions[sample.kennelTag]}
                      />
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
                      <SampleEventActions
                        sourceId={sourceId}
                        reason={sample.reason}
                        kennelTag={sample.kennelTag}
                        allKennels={allKennels}
                        suggestions={sampleSuggestions[sample.kennelTag]}
                      />
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
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Found</TableHead>
                <TableHead className="hidden sm:table-cell text-center">Created</TableHead>
                <TableHead className="hidden sm:table-cell text-center">Updated</TableHead>
                <TableHead className="hidden sm:table-cell text-center">Skipped</TableHead>
                <TableHead className="hidden md:table-cell text-center">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">T%</TooltipTrigger>
                    <TooltipContent>Title fill rate</TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="hidden md:table-cell text-center">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">L%</TooltipTrigger>
                    <TooltipContent>Location fill rate</TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="hidden md:table-cell text-center">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">H%</TooltipTrigger>
                    <TooltipContent>Hares fill rate</TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="hidden md:table-cell text-center">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">ST%</TooltipTrigger>
                    <TooltipContent>Start time fill rate</TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="hidden md:table-cell text-center">
                  <Tooltip>
                    <TooltipTrigger className="cursor-help">R#%</TooltipTrigger>
                    <TooltipContent>Run number fill rate</TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="hidden sm:table-cell">Duration</TableHead>
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
                    <div className="flex items-center gap-1 flex-wrap">
                      <Badge variant={statusColors[log.status]}>
                        {log.status}
                      </Badge>
                      {log.forced && (
                        <Badge variant="outline" className="text-xs">
                          Forced
                        </Badge>
                      )}
                      {(() => {
                        const ctx = log.diagnosticContext as Record<string, unknown> | null;
                        const ai = ctx?.aiRecovery as { attempted?: number; succeeded?: number; failed?: number } | undefined;
                        if (!ai || !ai.attempted) return null;
                        const allRecovered = ai.succeeded === ai.attempted;
                        return (
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge
                                variant={allRecovered ? "default" : "secondary"}
                                className={`text-[10px] py-0 ${allRecovered ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700 text-white"}`}
                              >
                                AI: {ai.succeeded}/{ai.attempted}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {allRecovered
                                ? `AI recovered all ${ai.succeeded} parse errors — self-healed`
                                : `AI recovered ${ai.succeeded} of ${ai.attempted} parse errors${ai.failed ? ` (${ai.failed} need code changes)` : ""}`}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">{log.eventsFound}</TableCell>
                  <TableCell className="hidden sm:table-cell text-center">{log.eventsCreated}</TableCell>
                  <TableCell className="hidden sm:table-cell text-center">{log.eventsUpdated}</TableCell>
                  <TableCell className="hidden sm:table-cell text-center">{log.eventsSkipped}</TableCell>
                  <FillRateCell rate={log.fillRateTitle} className="hidden md:table-cell" />
                  <FillRateCell rate={log.fillRateLocation} className="hidden md:table-cell" />
                  <FillRateCell rate={log.fillRateHares} className="hidden md:table-cell" />
                  <FillRateCell rate={log.fillRateStartTime} className="hidden md:table-cell" />
                  <FillRateCell rate={log.fillRateRunNumber} className="hidden md:table-cell" />
                  <TableCell className="hidden sm:table-cell text-xs">
                    {log.durationMs != null ? (
                      <Tooltip>
                        <TooltipTrigger className="cursor-help">
                          {(log.durationMs / 1000).toFixed(1)}s
                        </TooltipTrigger>
                        <TooltipContent>
                          {log.fetchDurationMs != null && log.mergeDurationMs != null
                            ? `Fetch: ${(log.fetchDurationMs / 1000).toFixed(1)}s | Merge: ${(log.mergeDurationMs / 1000).toFixed(1)}s`
                            : `Total: ${(log.durationMs / 1000).toFixed(1)}s`}
                        </TooltipContent>
                      </Tooltip>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    {log.errors.length > 0 ? (
                      <ErrorDisplay
                        errors={log.errors}
                        errorDetails={log.errorDetails as ErrorDetails | null}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                    {log.unmatchedTags.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Unmatched: {log.unmatchedTags.join(", ")}
                      </p>
                    )}
                    {log.diagnosticContext && (() => {
                      const ctx = log.diagnosticContext as Record<string, unknown>;
                      const ai = ctx.aiRecovery as { attempted?: number; succeeded?: number; failed?: number; durationMs?: number; recoveredFields?: Array<{ fields: string[]; confidence: string }> } | undefined;
                      const otherCtx = Object.fromEntries(Object.entries(ctx).filter(([k]) => k !== "aiRecovery"));
                      const hasOther = Object.keys(otherCtx).length > 0;

                      return (
                        <>
                          {ai && ai.attempted && ai.attempted > 0 && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                                AI Recovery ({ai.succeeded}/{ai.attempted} recovered, {((ai.durationMs ?? 0) / 1000).toFixed(1)}s)
                              </summary>
                              <div className="mt-1 ml-2 text-xs text-muted-foreground space-y-1">
                                {ai.recoveredFields?.map((r, idx) => (
                                  <div key={idx} className="flex items-center gap-1">
                                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${r.confidence === "high" ? "bg-green-500" : r.confidence === "medium" ? "bg-yellow-500" : "bg-red-500"}`} />
                                    <span className="font-medium">{r.confidence}</span>
                                    <span>— recovered: {r.fields.join(", ")}</span>
                                  </div>
                                ))}
                                {(ai.failed ?? 0) > 0 && (
                                  <p className="text-amber-600 dark:text-amber-400">
                                    {ai.failed} error{ai.failed === 1 ? "" : "s"} could not be recovered — may need code changes
                                  </p>
                                )}
                              </div>
                            </details>
                          )}
                          {hasOther && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                                Diagnostics
                              </summary>
                              <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                                {Object.entries(otherCtx).map(([key, value]) => (
                                  <div key={key}>
                                    <span className="font-medium">{key}:</span>{" "}
                                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
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

function StatCard({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="rounded-lg hover:ring-2 hover:ring-primary/20">
        {content}
      </Link>
    );
  }
  return content;
}
