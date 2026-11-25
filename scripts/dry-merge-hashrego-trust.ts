/**
 * Dry merge for the Hash Rego trust change (docs/kennel-external-ids-plan.md
 * section 5.6, PR B). LOCAL DATABASE ONLY: refuses any non-local host.
 *
 * On a fresh local copy of prod it re-merges the latest Hash Rego raw event of
 * every canonical event Hash Rego backs, at the trust level given, and writes
 * a before/after snapshot of each event's user-visible fields to a JSON file.
 * Run it once at the current trust (control) and once at the new trust, each
 * on a freshly restored copy, and compare the two outputs: the difference is
 * the effect of the trust change alone.
 *
 * Old raws are cleaned with today's parser cleanup first, so a pre-PR-A
 * placeholder doesn't show up as a trust effect.
 *
 * Usage (DATABASE_URL must point at localhost):
 *   TRUST=10 OUT=/path/out.json npx tsx scripts/dry-merge-hashrego-trust.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { processRawEvents } from "@/pipeline/merge";
import type { RawEventData } from "@/adapters/types";
import {
  cleanHashRegoCost,
  cleanHashRegoHares,
  cleanHashRegoLocation,
  cleanHashRegoTitle,
} from "@/adapters/hashrego/cleanup";

const HASHREGO_SOURCE_ID = "cmlsh9ynh0021m4m9vem8z9kh";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const SNAPSHOT_SELECT = {
  id: true,
  date: true,
  dateUtc: true,
  startTime: true,
  title: true,
  description: true,
  locationName: true,
  locationAddress: true,
  latitude: true,
  longitude: true,
  haresText: true,
  cost: true,
  trustLevel: true,
  status: true,
  kennel: { select: { kennelCode: true } },
} as const;

function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to run: DATABASE_URL host "${host}" is not local.`);
  }
}

function cleanRaw(data: RawEventData): RawEventData {
  return {
    ...data,
    title: data.title ? cleanHashRegoTitle(data.title) : data.title,
    location: cleanHashRegoLocation(data.location ?? undefined),
    locationStreet: cleanHashRegoLocation(data.locationStreet ?? undefined),
    hares: cleanHashRegoHares(data.hares ?? undefined),
    cost: cleanHashRegoCost(data.cost ?? undefined),
  };
}

async function snapshot(ids: string[]) {
  const rows = await prisma.event.findMany({ where: { id: { in: ids } }, select: SNAPSHOT_SELECT });
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

async function main(): Promise<void> {
  assertLocalDatabase();
  const trust = Number(process.env.TRUST);
  const out = process.env.OUT;
  if (!Number.isInteger(trust) || trust < 1 || trust > 10 || !out) {
    throw new Error("Set TRUST (1-10) and OUT (output JSON path).");
  }

  const raws = await prisma.rawEvent.findMany({
    where: { sourceId: HASHREGO_SOURCE_ID, eventId: { not: null } },
    select: { id: true, eventId: true, rawData: true, scrapedAt: true },
    orderBy: { scrapedAt: "desc" },
  });
  const latestByEvent = new Map<string, RawEventData>();
  for (const r of raws) {
    if (!latestByEvent.has(r.eventId!)) latestByEvent.set(r.eventId!, r.rawData as unknown as RawEventData);
  }
  const eventIds = [...latestByEvent.keys()];

  // Which events other sources also back: those are where trust matters.
  const others = await prisma.rawEvent.groupBy({
    by: ["eventId"],
    where: { eventId: { in: eventIds }, sourceId: { not: HASHREGO_SOURCE_ID } },
  });
  const sharedIds = new Set(others.map((o) => o.eventId));

  const before = await snapshot(eventIds);

  await prisma.rawEvent.deleteMany({ where: { sourceId: HASHREGO_SOURCE_ID, eventId: { in: eventIds } } });
  await prisma.source.update({ where: { id: HASHREGO_SOURCE_ID }, data: { trustLevel: trust } });

  const rows = [...latestByEvent.values()].map(cleanRaw);
  const result = await processRawEvents(HASHREGO_SOURCE_ID, rows);

  // Events the re-fed raws now point at (a raw may land on a different event).
  const relinked = await prisma.rawEvent.findMany({
    where: { sourceId: HASHREGO_SOURCE_ID },
    select: { eventId: true },
  });
  const afterIds = [...new Set([...eventIds, ...relinked.map((r) => r.eventId).filter((id): id is string => !!id)])];
  const after = await snapshot(afterIds);

  writeFileSync(
    out,
    JSON.stringify(
      {
        trust,
        eventCount: eventIds.length,
        sharedIds: [...sharedIds],
        mergeResult: result,
        before,
        after,
      },
      null,
      1,
    ),
  );
  console.log(`trust=${trust} events=${eventIds.length} shared=${sharedIds.size} wrote ${out}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
