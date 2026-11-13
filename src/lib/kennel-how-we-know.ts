import { prisma } from "@/lib/db";
import type { KennelEvidence } from "@/lib/kennel-status";

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
  const feeds = enabled.filter((s) => s.type !== "STATIC_SCHEDULE");
  const knowsSchedule = activeRules > 0 || feeds.length < enabled.length;
  if (enabled.length === 0) return knowsSchedule ? { level: "schedule" } : { level: "none" };

  const since = new Date(toUtcNoon(now) - COVERAGE_WINDOW_DAYS * DAY_MS);
  const [realRunSources, feedScheduleRun] = await Promise.all([
    // One row per source (GROUP BY): an aggregator kennel can have hundreds of
    // RawEvents in the window, but only a handful of sources.
    feeds.length > 0
      ? prisma.rawEvent.groupBy({
          by: ["sourceId"],
          where: {
            sourceId: { in: feeds.map((s) => s.id) },
            event: { date: { gte: since }, isScheduleOnly: false, ...realRunEventWhere(kennelId) },
          },
        })
      : Promise.resolve([]),
    // A feed that returned only generated runs (a template calendar) still
    // tells us the usual schedule. Unneeded when a rule or STATIC_SCHEDULE
    // source already does.
    knowsSchedule
      ? Promise.resolve(null)
      : prisma.event.findFirst({
          where: {
            date: { gte: since },
            isScheduleOnly: true,
            ...realRunEventWhere(kennelId),
            rawEvents: { some: { sourceId: { in: enabled.map((s) => s.id) } } },
          },
          select: { id: true },
        }),
  ]);

  const fullIds = new Set(realRunSources.map((r) => r.sourceId));
  const names = [...new Set(feeds.filter((s) => fullIds.has(s.id)).map((s) => s.name))];
  if (names.length > 0) {
    return { level: "full", sourceNames: names.sort((a, b) => a.localeCompare(b)) };
  }
  return knowsSchedule || feedScheduleRun ? { level: "schedule" } : { level: "none" };
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

/**
 * "How we know" for one kennel. `evidence` is the kennel's cached evidence,
 * which the kennel page has already loaded. Every query runs in parallel
 * except coverage's second step (it needs the linked sources).
 */
export async function getHowWeKnow(
  kennelId: string,
  evidence: KennelEvidence,
  now: Date = new Date(),
): Promise<HowWeKnow> {
  const lastRunAt = evidence.lastRunSeenAt;
  const nextPostedAt =
    evidence.nextRunPostedAt && toUtcNoon(evidence.nextRunPostedAt) >= toUtcNoon(now)
      ? evidence.nextRunPostedAt
      : null;

  const [coverage, confirmations, lastRunSource, nextPostedSource] = await Promise.all([
    getCoverage(kennelId, now),
    prisma.kennelConfirmation.findMany({
      where: { kennelId, revertedAt: null },
      orderBy: { observedAt: "desc" },
      select: { kind: true, observedAt: true, note: true, url: true },
    }),
    lastRunAt ? runSourceName(kennelId, lastRunAt) : Promise.resolve(null),
    nextPostedAt ? runSourceName(kennelId, nextPostedAt) : Promise.resolve(null),
  ]);

  const running = confirmations.find((c) => c.kind === "RUNNING");
  const stopped = confirmations.find((c) => c.kind === "STOPPED");
  const items: EvidenceItem[] = [];

  if (lastRunAt) {
    items.push({ kind: "last-run", date: lastRunAt, detail: lastRunSource, url: null });
  }
  if (nextPostedAt) {
    items.push({ kind: "next-posted", date: nextPostedAt, detail: nextPostedSource, url: null });
  }
  if (evidence.lastConfirmedAt) {
    items.push({
      kind: "confirmed",
      date: evidence.lastConfirmedAt,
      detail: running?.note ?? null,
      url: running?.url ?? null,
    });
  }
  if (evidence.stoppedAt) {
    items.push({
      kind: "stopped",
      date: evidence.stoppedAt,
      detail: stopped?.note ?? null,
      url: stopped?.url ?? null,
    });
  }

  items.sort((a, b) => b.date.getTime() - a.date.getTime());
  return { coverage, items: items.slice(0, MAX_ITEMS) };
}

/** What the kennel page renders when "How we know" can't be loaded. */
export const NO_HOW_WE_KNOW: HowWeKnow = { coverage: { level: "none" }, items: [] };

/**
 * `getHowWeKnow` for the kennel page: a failure is logged and the section
 * renders empty, so it can never take the whole page down.
 */
export async function getHowWeKnowOrEmpty(
  kennelId: string,
  evidence: KennelEvidence,
  now: Date = new Date(),
): Promise<HowWeKnow> {
  try {
    return await getHowWeKnow(kennelId, evidence, now);
  } catch (err) {
    console.error(`[kennel-page] "How we know" failed for kennel ${kennelId}; rendering it empty`, err);
    return NO_HOW_WE_KNOW;
  }
}
