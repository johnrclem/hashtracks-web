import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import { AlertCard } from "@/components/admin/AlertCard";
import { AlertFilters } from "@/components/admin/AlertFilters";
import { fuzzyMatch } from "@/lib/fuzzy";
import type { KennelOption } from "@/components/admin/UnmatchedTagResolver";

const VALID_STATUSES = new Set(["OPEN", "ACKNOWLEDGED", "SNOOZED", "RESOLVED"]);

/** Build the Prisma where clause for alert status filtering. */
function buildAlertsWhereClause(statusFilter: string) {
  if (statusFilter === "all") return {};
  if (statusFilter === "active") {
    return { status: { in: ["OPEN" as const, "ACKNOWLEDGED" as const] } };
  }
  if (VALID_STATUSES.has(statusFilter)) {
    return { status: statusFilter as "OPEN" | "ACKNOWLEDGED" | "SNOOZED" | "RESOLVED" };
  }
  return {};
}

/** Compute fuzzy kennel suggestions for UNMATCHED_TAGS alerts. */
function computeFuzzySuggestions(
  alerts: Array<{ id: string; type: string; context: unknown }>,
  fuzzyCandidates: Array<{ id: string; shortName: string; fullName: string; aliases: string[] }>,
): Map<string, Map<string, KennelOption[]>> {
  const suggestionsMap = new Map<string, Map<string, KennelOption[]>>();
  for (const alert of alerts) {
    if (alert.type !== "UNMATCHED_TAGS" || !alert.context) continue;
    const ctx = alert.context as { tags?: string[] };
    if (!ctx.tags) continue;

    const tagSuggestions = new Map<string, KennelOption[]>();
    for (const tag of ctx.tags) {
      tagSuggestions.set(tag, fuzzyMatch(tag, fuzzyCandidates));
    }
    suggestionsMap.set(alert.id, tagSuggestions);
  }
  return suggestionsMap;
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const admin = await getAdminUser();
  if (!admin) notFound();

  const params = await searchParams;
  const statusFilter = params.status ?? "active";
  const where = buildAlertsWhereClause(statusFilter);

  const [alerts, counts, allKennels] = await Promise.all([
    prisma.alert.findMany({
      where,
      include: {
        source: { select: { name: true } },
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.alert.groupBy({
      by: ["status"],
      _count: true,
    }),
    // Fetch kennels for unmatched tag resolver
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
  ]);

  const countMap = new Map<string, number>();
  for (const c of counts) {
    countMap.set(c.status, c._count);
  }

  const openCount = countMap.get("OPEN") ?? 0;
  const acknowledgedCount = countMap.get("ACKNOWLEDGED") ?? 0;
  const snoozedCount = countMap.get("SNOOZED") ?? 0;
  const resolvedCount = countMap.get("RESOLVED") ?? 0;

  const fuzzyCandidates = allKennels.map((k) => ({
    id: k.id,
    shortName: k.shortName,
    fullName: k.fullName,
    aliases: k.aliases.map((a) => a.alias),
  }));

  const suggestionsMap = computeFuzzySuggestions(alerts, fuzzyCandidates);

  const kennelList = allKennels.map((k) => ({
    id: k.id,
    shortName: k.shortName,
    fullName: k.fullName,
    region: k.region,
  }));

  const serialized = alerts.map((a) => ({
    id: a.id,
    sourceId: a.sourceId,
    type: a.type,
    severity: a.severity,
    title: a.title,
    details: a.details,
    context: a.context as Record<string, unknown> | null,
    repairLog: a.repairLog as Array<{
      action: string;
      timestamp: string;
      adminId: string;
      details: Record<string, unknown>;
      result: "success" | "error";
      resultMessage?: string;
    }> | null,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    snoozedUntil: a.snoozedUntil?.toISOString() ?? null,
    sourceName: a.source.name,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Source Alerts</h2>
        <p className="text-sm text-muted-foreground">
          {openCount} open{acknowledgedCount > 0 ? `, ${acknowledgedCount} acknowledged` : ""}
          {snoozedCount > 0 ? `, ${snoozedCount} snoozed` : ""}
        </p>
      </div>

      <AlertFilters
        current={statusFilter}
        counts={{ open: openCount, acknowledged: acknowledgedCount, snoozed: snoozedCount, resolved: resolvedCount }}
      />

      {serialized.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">
            {statusFilter === "active"
              ? "No active alerts. All sources are healthy."
              : `No ${statusFilter} alerts.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {serialized.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              allKennels={alert.type === "UNMATCHED_TAGS" ? kennelList : undefined}
              suggestions={suggestionsMap.get(alert.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
