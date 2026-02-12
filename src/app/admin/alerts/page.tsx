import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import { AlertCard } from "@/components/admin/AlertCard";
import { AlertFilters } from "@/components/admin/AlertFilters";
import { fuzzyMatch } from "@/lib/fuzzy";
import type { KennelOption } from "@/components/admin/UnmatchedTagResolver";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const admin = await getAdminUser();
  if (!admin) notFound();

  const params = await searchParams;
  const statusFilter = params.status ?? "active";

  // Build where clause based on filter
  const where =
    statusFilter === "all"
      ? {}
      : statusFilter === "active"
        ? { status: { in: ["OPEN" as const, "ACKNOWLEDGED" as const] } }
        : { status: statusFilter as "OPEN" | "ACKNOWLEDGED" | "SNOOZED" | "RESOLVED" };

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
        aliases: { select: { alias: true } },
      },
    }),
  ]);

  const countMap: Record<string, number> = {};
  for (const c of counts) {
    countMap[c.status] = c._count;
  }

  const openCount = countMap["OPEN"] ?? 0;
  const acknowledgedCount = countMap["ACKNOWLEDGED"] ?? 0;
  const snoozedCount = countMap["SNOOZED"] ?? 0;
  const resolvedCount = countMap["RESOLVED"] ?? 0;

  // Compute fuzzy suggestions for UNMATCHED_TAGS alerts
  const fuzzyCandidates = allKennels.map((k) => ({
    id: k.id,
    shortName: k.shortName,
    fullName: k.fullName,
    aliases: k.aliases.map((a) => a.alias),
  }));

  const suggestionsMap: Record<string, Record<string, KennelOption[]>> = {};
  for (const alert of alerts) {
    if (alert.type === "UNMATCHED_TAGS" && alert.context) {
      const ctx = alert.context as { tags?: string[] };
      if (ctx.tags) {
        const alertSuggestions: Record<string, KennelOption[]> = {};
        for (const tag of ctx.tags) {
          alertSuggestions[tag] = fuzzyMatch(tag, fuzzyCandidates);
        }
        suggestionsMap[alert.id] = alertSuggestions;
      }
    }
  }

  const kennelList = allKennels.map((k) => ({
    id: k.id,
    shortName: k.shortName,
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
              suggestions={suggestionsMap[alert.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
