import { prisma } from "@/lib/db";
import { KENNEL_EVIDENCE_SELECT } from "@/lib/kennel-status";

/**
 * Kennel page "How we know": the newest dated evidence behind a kennel's status
 * and what our feeds actually cover. Coverage reads what feeds returned in the
 * last 180 days, not which sources are merely linked.
 */

export type KennelCoverage =
  | { level: "full"; sourceNames: string[] }
  | { level: "schedule" }
  | { level: "none" };

export interface EvidenceItem {
  kind: "last-run" | "next-posted" | "confirmed" | "stopped";
  date: Date;
  detail: string | null;
  url: string | null;
}

export interface HowWeKnow {
  coverage: KennelCoverage;
  items: EvidenceItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const COVERAGE_WINDOW_DAYS = 180;
const MAX_ITEMS = 3;

function toUtcNoon(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0);
}

/** The event is attached to this kennel, as primary or as a co-host. */
function forKennel(kennelId: string) {
  return { OR: [{ kennelId }, { eventKennels: { some: { kennelId } } }] };
}

/** Real runs only: canonical, not cancelled, not hand-entered. */
function realRunEventWhere(kennelId: string) {
  return {
    isCanonical: true,
    status: { not: "CANCELLED" as const },
    isManualEntry: false,
    ...forKennel(kennelId),
  };
}

async function getCoverage(kennelId: string, now: Date): Promise<KennelCoverage> {
  const [links, activeRules] = await Promise.all([
    prisma.sourceKennel.findMany({
      where: { kennelId },
      select: { source: { select: { id: true, name: true, type: true, enabled: true } } },
    }),
    prisma.scheduleRule.count({ where: { kennelId, isActive: true } }),
  ]);
  const enabled = links.map((l) => l.source).filter((s) => s.enabled);

  let feedSchedule = false;
  if (enabled.length > 0) {
    const since = new Date(toUtcNoon(now) - COVERAGE_WINDOW_DAYS * DAY_MS);
    const rows = await prisma.rawEvent.findMany({
      where: {
        sourceId: { in: enabled.map((s) => s.id) },
        event: { date: { gte: since }, ...realRunEventWhere(kennelId) },
      },
      select: {
        source: { select: { name: true, type: true } },
        event: { select: { date: true, isScheduleOnly: true } },
      },
    });
    const names = new Set<string>();
    for (const row of rows) {
      if (!row.event || row.event.date < since) continue;
      if (row.event.isScheduleOnly) {
        feedSchedule = true;
      } else if (row.source.type !== "STATIC_SCHEDULE") {
        names.add(row.source.name);
      }
    }
    if (names.size > 0) {
      return { level: "full", sourceNames: [...names].sort((a, b) => a.localeCompare(b)) };
    }
  }

  const hasStatic = enabled.some((s) => s.type === "STATIC_SCHEDULE");
  return hasStatic || activeRules > 0 || feedSchedule ? { level: "schedule" } : { level: "none" };
}

/** The source behind a real run on `date`, preferring the newest scrape. */
async function runSourceName(kennelId: string, date: Date): Promise<string | null> {
  const row = await prisma.rawEvent.findFirst({
    where: {
      source: { type: { not: "STATIC_SCHEDULE" } },
      event: { date, isScheduleOnly: false, ...realRunEventWhere(kennelId) },
    },
    orderBy: { scrapedAt: "desc" },
    select: { source: { select: { name: true } } },
  });
  return row?.source.name ?? null;
}

export async function getHowWeKnow(kennelId: string, now: Date = new Date()): Promise<HowWeKnow> {
  const [kennel, coverage, confirmations] = await Promise.all([
    prisma.kennel.findUnique({ where: { id: kennelId }, select: KENNEL_EVIDENCE_SELECT }),
    getCoverage(kennelId, now),
    prisma.kennelConfirmation.findMany({
      where: { kennelId, revertedAt: null },
      orderBy: { observedAt: "desc" },
      select: { kind: true, observedAt: true, note: true, url: true },
    }),
  ]);
  if (!kennel) return { coverage, items: [] };

  const running = confirmations.find((c) => c.kind === "RUNNING");
  const stopped = confirmations.find((c) => c.kind === "STOPPED");
  const items: EvidenceItem[] = [];

  if (kennel.lastRunSeenAt) {
    items.push({
      kind: "last-run",
      date: kennel.lastRunSeenAt,
      detail: await runSourceName(kennelId, kennel.lastRunSeenAt),
      url: null,
    });
  }
  if (kennel.nextRunPostedAt && toUtcNoon(kennel.nextRunPostedAt) >= toUtcNoon(now)) {
    items.push({
      kind: "next-posted",
      date: kennel.nextRunPostedAt,
      detail: await runSourceName(kennelId, kennel.nextRunPostedAt),
      url: null,
    });
  }
  if (kennel.lastConfirmedAt) {
    items.push({
      kind: "confirmed",
      date: kennel.lastConfirmedAt,
      detail: running?.note ?? null,
      url: running?.url ?? null,
    });
  }
  if (kennel.stoppedAt) {
    items.push({
      kind: "stopped",
      date: kennel.stoppedAt,
      detail: stopped?.note ?? null,
      url: stopped?.url ?? null,
    });
  }

  items.sort((a, b) => b.date.getTime() - a.date.getTime());
  return { coverage, items: items.slice(0, MAX_ITEMS) };
}
