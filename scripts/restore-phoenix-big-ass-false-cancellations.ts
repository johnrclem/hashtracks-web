/**
 * One-shot restore: flip back to CONFIRMED the past Phoenix events that
 * "Phoenix H3 Big Ass Calendar" reconcile cancelled by mistake.
 *
 * Background: since #2242 the Big Ass Calendar adapter fetches forward-only
 * (current month onward), but the source lacked `upcomingOnly` until #2684.
 * Reconcile's window was therefore now−scrapeDays…now+scrapeDays, and every
 * already-run event in the trailing window looked "removed from the source":
 * a wave on the 1st of each month as the prior month dropped off the fetch,
 * plus 89 in one scrape on 2026-11-05. None of these were real cancellations.
 *
 * Selection (all must hold), per event:
 *   - kennel ∈ {lbh-phx, hump-d, wrong-way, fdtdd}, status CANCELLED,
 *     isCanonical, date < today (UTC), adminCancelledAt IS NULL
 *   - ≥1 RawEvent, and EVERY RawEvent comes from the Big Ass Calendar source
 *   - every RawEvent carries a non-empty title. The older adapter emitted
 *     title-less day-cell rows ({date, location:"Phoenix"} only) that fell to
 *     the wrong-way default tag and display as "Wrong Way Trail"; they were
 *     never real runs and stay cancelled.
 *   - no RawEvent title/description carries a cancellation signal
 *   - no CONFIRMED canonical event already occupies the (kennel, date) slot
 *     (restoring would surface a duplicate card)
 *   - within the restore set, same-slot rows whose normalized titles match
 *     are one run scraped twice (e.g. ' vs ’ apostrophes): keep the richest
 *
 * Dry run by default. Apply re-checks status inside the update.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/restore-phoenix-big-ass-false-cancellations.ts
 *   Apply:    RESTORE_APPLY=1 npx tsx scripts/restore-phoenix-big-ass-false-cancellations.ts
 */

import "dotenv/config";
import { prisma } from "@/lib/db";

const KENNEL_CODES = ["lbh-phx", "hump-d", "wrong-way", "fdtdd"];
const SOURCE_NAME = "Phoenix H3 Big Ass Calendar";
const APPLY = process.env.RESTORE_APPLY === "1";

const CANCEL_SIGNAL_RE = /\b(?:cancel+(?:ed|led|ation)?|postponed|called off|rained out)\b/i;

export interface RawSummary {
  sourceId: string;
  title: string | null;
  description: string | null;
}

export interface Candidate {
  id: string;
  kennelCode: string;
  dateKey: string;
  title: string | null;
  startTime: string | null;
  adminCancelledAt: Date | null;
  raws: RawSummary[];
  /** CONFIRMED canonical events (other than this one) in the same kennel+date slot. */
  confirmedInSlot: number;
}

export type Verdict =
  | "RESTORE"
  | "SKIP_ADMIN_CANCELLED"
  | "SKIP_NO_RAWS"
  | "SKIP_OTHER_SOURCE"
  | "SKIP_TITLELESS_ROW"
  | "SKIP_CANCEL_SIGNAL"
  | "SKIP_SLOT_TAKEN"
  | "SKIP_DUPLICATE_IN_SLOT";

/** Lowercase, drop punctuation/quotes/whitespace so "Hump D' Throwdown" ≡ "Hump D’ Throwdown". */
export function normalizeTitle(title: string | null): string {
  return (title ?? "").toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, "");
}

function individualVerdict(c: Candidate, sourceId: string): Verdict {
  if (c.adminCancelledAt) return "SKIP_ADMIN_CANCELLED";
  if (c.raws.length === 0) return "SKIP_NO_RAWS";
  if (!c.raws.every((r) => r.sourceId === sourceId)) return "SKIP_OTHER_SOURCE";
  if (!c.raws.every((r) => (r.title ?? "").trim().length > 0)) return "SKIP_TITLELESS_ROW";
  if (c.raws.some((r) => CANCEL_SIGNAL_RE.test(`${r.title ?? ""} ${r.description ?? ""}`))) {
    return "SKIP_CANCEL_SIGNAL";
  }
  if (c.confirmedInSlot > 0) return "SKIP_SLOT_TAKEN";
  return "RESTORE";
}

/** Richer row wins: has startTime, then more RawEvents, then stable id order. */
function richness(a: Candidate, b: Candidate): number {
  const at = a.startTime ? 1 : 0;
  const bt = b.startTime ? 1 : 0;
  if (at !== bt) return bt - at;
  if (a.raws.length !== b.raws.length) return b.raws.length - a.raws.length;
  return a.id.localeCompare(b.id);
}

/** Pure classification. Exported for tests. */
export function classifyCandidates(candidates: Candidate[], sourceId: string): Map<string, Verdict> {
  const verdicts = new Map<string, Verdict>();
  const restorableBySlot = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const v = individualVerdict(c, sourceId);
    verdicts.set(c.id, v);
    if (v !== "RESTORE") continue;
    const key = `${c.kennelCode}:${c.dateKey}:${normalizeTitle(c.title)}`;
    restorableBySlot.set(key, [...(restorableBySlot.get(key) ?? []), c]);
  }
  for (const group of restorableBySlot.values()) {
    if (group.length < 2) continue;
    const [, ...losers] = [...group].sort(richness);
    for (const l of losers) verdicts.set(l.id, "SKIP_DUPLICATE_IN_SLOT");
  }
  return verdicts;
}

async function main() {
  const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME }, select: { id: true, config: true } });
  if (!source) throw new Error(`Source "${SOURCE_NAME}" not found`);
  const cfg = (source.config ?? {}) as Record<string, unknown>;
  if (cfg.upcomingOnly !== true) {
    throw new Error(`"${SOURCE_NAME}" lacks upcomingOnly — deploy #2684's migration first or the next scrape re-cancels.`);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const events = await prisma.event.findMany({
    where: {
      kennel: { kennelCode: { in: KENNEL_CODES } },
      status: "CANCELLED",
      isCanonical: true,
      date: { lt: today },
    },
    select: {
      id: true,
      kennelId: true,
      date: true,
      title: true,
      startTime: true,
      adminCancelledAt: true,
      kennel: { select: { kennelCode: true } },
      rawEvents: { select: { sourceId: true, rawData: true } },
    },
    orderBy: [{ date: "asc" }],
  });

  const confirmed = await prisma.event.findMany({
    where: {
      kennelId: { in: [...new Set(events.map((e) => e.kennelId))] },
      status: "CONFIRMED",
      isCanonical: true,
      date: { lt: today },
    },
    select: { kennelId: true, date: true },
  });
  const confirmedSlots = new Map<string, number>();
  for (const c of confirmed) {
    const k = `${c.kennelId}:${c.date.toISOString().slice(0, 10)}`;
    confirmedSlots.set(k, (confirmedSlots.get(k) ?? 0) + 1);
  }

  const candidates: Candidate[] = events.map((e) => {
    const dateKey = e.date.toISOString().slice(0, 10);
    return {
      id: e.id,
      kennelCode: e.kennel.kennelCode,
      dateKey,
      title: e.title,
      startTime: e.startTime,
      adminCancelledAt: e.adminCancelledAt,
      raws: e.rawEvents.map((r) => {
        const d = (r.rawData ?? {}) as Record<string, unknown>;
        return {
          sourceId: r.sourceId,
          title: typeof d.title === "string" ? d.title : null,
          description: typeof d.description === "string" ? d.description : null,
        };
      }),
      confirmedInSlot: confirmedSlots.get(`${e.kennelId}:${dateKey}`) ?? 0,
    };
  });

  const verdicts = classifyCandidates(candidates, source.id);
  const tally = new Map<Verdict, number>();
  for (const c of candidates) {
    const v = verdicts.get(c.id) ?? "SKIP_NO_RAWS";
    tally.set(v, (tally.get(v) ?? 0) + 1);
    if (v === "SKIP_TITLELESS_ROW") continue; // ~100 identical "Wrong Way Trail" junk rows — counted, not listed
    console.log(`  ${c.dateKey}  ${c.kennelCode.padEnd(10)} ${v.padEnd(24)} ${c.title ?? "(no title)"}`);
  }
  console.log(`\nPast CANCELLED canonical events in ${KENNEL_CODES.join(", ")}: ${candidates.length}`);
  for (const [v, n] of [...tally].sort()) console.log(`  ${v.padEnd(24)} ${n}`);

  const ids = candidates.filter((c) => verdicts.get(c.id) === "RESTORE").map((c) => c.id);
  if (!APPLY) {
    console.log(`\nDry run. Would restore ${ids.length} event(s) to CONFIRMED.`);
    console.log("Re-run with RESTORE_APPLY=1 to apply.");
    return;
  }
  const res = await prisma.event.updateMany({
    where: { id: { in: ids }, status: "CANCELLED", adminCancelledAt: null },
    data: { status: "CONFIRMED" },
  });
  console.log(`\n✅ Restored ${res.count} of ${ids.length} event(s) to CONFIRMED.`);
}

if (process.argv[1]?.endsWith("restore-phoenix-big-ass-false-cancellations.ts")) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
