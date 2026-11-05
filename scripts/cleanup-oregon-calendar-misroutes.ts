/**
 * One-shot cleanup: delete the events "Oregon Hashing Calendar" filed under
 * the wrong kennel before it had `strictKennelRouting`.
 *
 * Background: the calendar is a regional aggregator. With a `defaultKennelTag`
 * of "oh3" and no strict routing, every sibling kennel's run (Eugene EH3,
 * Stumptown, Dead Whores, Central Oregon, SWH3, OBGYN, Beaver, Kahuna …) and
 * template junk ("start comment- choose your preferred fields") landed on oh3.
 * The 2026-11-05 wide backfill (`backfill-gcal-history.ts`, 9999 days) carried
 * that back to 2018. The seed + migration now set `strictKennelRouting: true`
 * and an emoji-tolerant OH3 pattern; this removes the rows the old routing made.
 *
 * Selection, per canonical event in the default-tag bucket (oh3):
 *   - EVERY RawEvent comes from "Oregon Hashing Calendar" (anything another
 *     source also backs is real data and is kept);
 *   - under the NEW config (read from prisma/seed-data/sources.ts), none of its
 *     raw titles routes to the event's kennel — skipPatterns drop, no pattern
 *     matches, or a pattern routes it elsewhere;
 *   - no Attendance / KennelAttendance rows (reported and kept if present).
 * Deletes the event and this source's RawEvents in one transaction
 * (EventKennel / EventLink cascade).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/cleanup-oregon-calendar-misroutes.ts
 *   Apply:    CLEANUP_APPLY=1 npx tsx scripts/cleanup-oregon-calendar-misroutes.ts
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { SOURCES } from "../prisma/seed-data/sources";
import { compilePatterns } from "@/adapters/utils";
import {
  compileKennelPatterns,
  matchCompiledKennelPatterns,
  type CompiledKennelPattern,
  type KennelPattern,
} from "@/adapters/kennel-patterns";

const SOURCE_NAME = "Oregon Hashing Calendar";
const APPLY = process.env.CLEANUP_APPLY === "1";

interface RoutingConfig {
  kennelPatterns: KennelPattern[];
  skipPatterns?: string[];
  defaultKennelTag?: string;
}

export interface Candidate {
  id: string;
  kennelCode: string;
  titles: string[];
  otherSource: boolean;
  attendances: number;
}

export type Verdict =
  | "DELETE"
  | "KEEP_ROUTES_HERE"
  | "KEEP_OTHER_SOURCE"
  | "KEEP_ATTENDANCE"
  | "KEEP_NOT_DEFAULT_BUCKET";

/** Kennel codes a title routes to under strict routing ([] = dropped). Exported for tests. */
export function routeTitle(title: string, compiled: CompiledKennelPattern[], skips: RegExp[]): string[] {
  if (skips.some((re) => re.test(title))) return [];
  return matchCompiledKennelPatterns(title, compiled);
}

/**
 * Pure classification. Exported for tests. Only the default-tag bucket is a
 * deletion candidate: that is where the leak landed. A row on a pattern-routed
 * kennel (tgif, cch3-or) got there by an explicit pattern at some point, so it
 * is kept even if today's patterns no longer match its title.
 */
export function classify(
  c: Candidate,
  compiled: CompiledKennelPattern[],
  skips: RegExp[],
  defaultKennelTag: string,
): Verdict {
  if (c.kennelCode !== defaultKennelTag) return "KEEP_NOT_DEFAULT_BUCKET";
  if (c.otherSource) return "KEEP_OTHER_SOURCE";
  if (c.titles.some((t) => routeTitle(t, compiled, skips).includes(c.kennelCode))) return "KEEP_ROUTES_HERE";
  if (c.attendances > 0) return "KEEP_ATTENDANCE";
  return "DELETE";
}

async function main() {
  const seed = (SOURCES as unknown as Array<{ name: string; config?: RoutingConfig & { strictKennelRouting?: boolean } }>)
    .find((s) => s.name === SOURCE_NAME);
  if (!seed?.config?.strictKennelRouting) {
    throw new Error(`Seed config for "${SOURCE_NAME}" lacks strictKennelRouting — this script classifies by the NEW routing.`);
  }
  const defaultTag = seed.config.defaultKennelTag;
  if (!defaultTag) throw new Error(`Seed config for "${SOURCE_NAME}" has no defaultKennelTag`);
  const compiled = compileKennelPatterns(seed.config.kennelPatterns);
  // Same compiler + flags the GCal adapter uses for skipPatterns.
  const skips = compilePatterns(seed.config.skipPatterns ?? [], "i");

  const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME, type: "GOOGLE_CALENDAR" }, select: { id: true } });
  if (!source) throw new Error(`Source "${SOURCE_NAME}" not found`);

  const raws = await prisma.rawEvent.findMany({
    where: { sourceId: source.id, eventId: { not: null } },
    select: { eventId: true, rawData: true },
  });
  const titlesByEvent = new Map<string, string[]>();
  for (const r of raws) {
    const t = (r.rawData as Record<string, unknown> | null)?.title;
    const list = titlesByEvent.get(r.eventId as string) ?? [];
    if (typeof t === "string") list.push(t);
    titlesByEvent.set(r.eventId as string, list);
  }
  const eventIds = [...titlesByEvent.keys()];
  const others = await prisma.rawEvent.groupBy({
    by: ["eventId"],
    where: { eventId: { in: eventIds }, sourceId: { not: source.id } },
  });
  const otherSourceIds = new Set(others.map((o) => o.eventId));

  const events = await prisma.event.findMany({
    where: { id: { in: eventIds }, isCanonical: true },
    select: {
      id: true,
      date: true,
      title: true,
      kennel: { select: { kennelCode: true } },
      _count: { select: { attendances: true, kennelAttendances: true } },
    },
    orderBy: { date: "asc" },
  });

  const tally = new Map<string, number>();
  const toDelete: string[] = [];
  const samples: string[] = [];
  for (const e of events) {
    const verdict = classify(
      {
        id: e.id,
        kennelCode: e.kennel.kennelCode,
        titles: titlesByEvent.get(e.id) ?? [],
        otherSource: otherSourceIds.has(e.id),
        attendances: e._count.attendances + e._count.kennelAttendances,
      },
      compiled,
      skips,
      defaultTag,
    );
    const key = `${e.kennel.kennelCode.padEnd(8)} ${verdict}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (verdict === "DELETE") {
      toDelete.push(e.id);
      if (samples.length < 25) samples.push(`  ${e.date.toISOString().slice(0, 10)}  ${e.kennel.kennelCode.padEnd(8)} ${e.title ?? "(no title)"}`);
    }
    if (verdict === "KEEP_ATTENDANCE") console.warn(`⚠️  kept (has attendance): ${e.id} ${e.title}`);
  }

  console.log(`Canonical events backed by "${SOURCE_NAME}": ${events.length}`);
  for (const [k, n] of [...tally].sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${k.padEnd(28)} ${n}`);
  console.log(`\nSample of rows to delete:\n${samples.join("\n")}`);

  if (!APPLY) {
    console.log(`\nDry run. Would delete ${toDelete.length} event(s) and their "${SOURCE_NAME}" RawEvents.`);
    console.log("Re-run with CLEANUP_APPLY=1 to apply.");
    return;
  }
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.rawEvent.deleteMany({ where: { eventId: { in: toDelete }, sourceId: source.id } });
    const ev = await tx.event.deleteMany({ where: { id: { in: toDelete } } });
    return { raws: r.count, events: ev.count };
  });
  console.log(`\n✅ Deleted ${result.events} events and ${result.raws} RawEvents.`);
}

if (process.argv[1]?.endsWith("cleanup-oregon-calendar-misroutes.ts")) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
