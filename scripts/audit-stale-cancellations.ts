/**
 * Read-only fleet audit — surface other kennels likely affected by the
 * same upcoming-only mis-config that triggered #1229 (Gold Coast TablePress
 * past events stale-cancelled).
 *
 * Smoking-gun signature: `status = CANCELLED`, `adminCancelledAt IS NULL`
 * (so this isn't an admin override), and the event date is in the past
 * (so the cancellation can't be a real "the kennel cancelled the upcoming
 * trail" decision — by definition, real cancellations happen BEFORE the
 * date passes). Sources whose `config.upcomingOnly` is already true are
 * excluded — they're using the correct mode and any past-cancellation
 * there has another root cause.
 *
 * Usage:
 *   npx tsx scripts/audit-stale-cancellations.ts
 *   npx tsx scripts/audit-stale-cancellations.ts --since 2025-01-01   # filter window
 *
 * Output: a per-source table sorted by stale-cancellation count, plus a
 * per-source list of sample event ids for spot-checking. The user reviews
 * the output and decides which sources need follow-up `upcomingOnly: true`
 * config additions (each shipped in its own PR to keep WS3 scope tight).
 *
 * Read-only — never writes to the database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const MIN_COUNT_TO_REPORT = 3;

function parseSince(): Date {
  const idx = process.argv.indexOf("--since");
  if (idx === -1 || !process.argv[idx + 1]) {
    // Default: 1 year back. The reconcile bug isn't time-bounded — older
    // cancellations that fit the signature are equally suspicious — but
    // 1 year is a reasonable cap for a quick-scan report.
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(process.argv[idx + 1] + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) {
    console.error(`Invalid --since date: ${process.argv[idx + 1]}`);
    process.exit(1);
  }
  return d;
}

async function main() {
  const since = parseSince();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Filter sources up front so we never load full Source.config blobs
    // (potentially large JSONB) per event. Build an in-memory lookup of
    // eligible sources (those NOT already marked upcomingOnly) and keyed by id.
    const allSources = await prisma.source.findMany({
      select: { id: true, name: true, type: true, config: true },
    });
    type EligibleSource = { id: string; name: string; type: string };
    const eligibleSources = new Map<string, EligibleSource>();
    for (const s of allSources) {
      const cfg = (s.config ?? {}) as { upcomingOnly?: boolean };
      if (cfg.upcomingOnly === true) continue;
      eligibleSources.set(s.id, { id: s.id, name: s.name, type: s.type });
    }
    if (eligibleSources.size === 0) {
      console.log("All sources already use upcomingOnly: true. Nothing to audit.");
      return;
    }

    // Now pull cancelled past events whose RawEvents reference an eligible
    // source. Prisma's relational filter pushes the IN-list to the DB.
    const candidates = await prisma.event.findMany({
      where: {
        status: "CANCELLED",
        adminCancelledAt: null,
        date: { gte: since, lt: today },
        rawEvents: { some: { sourceId: { in: [...eligibleSources.keys()] } } },
      },
      select: {
        id: true,
        date: true,
        kennelId: true,
        kennel: { select: { kennelCode: true, shortName: true } },
        rawEvents: { select: { sourceId: true } },
      },
    });

    // Group by source. An event with multiple sources gets counted under
    // each (the bug typically fires on a per-source basis).
    type Bucket = {
      sourceName: string;
      sourceType: string;
      kennels: Set<string>;
      events: { id: string; date: string; kennel: string }[];
    };
    const bySource = new Map<string, Bucket>();

    for (const event of candidates) {
      const dateStr = event.date.toISOString().slice(0, 10);
      const kennelLabel =
        event.kennel?.shortName ?? event.kennel?.kennelCode ?? event.kennelId;
      for (const r of event.rawEvents) {
        const src = eligibleSources.get(r.sourceId);
        if (!src) continue;
        let bucket = bySource.get(r.sourceId);
        if (!bucket) {
          bucket = {
            sourceName: src.name,
            sourceType: src.type,
            kennels: new Set(),
            events: [],
          };
          bySource.set(r.sourceId, bucket);
        }
        bucket.kennels.add(kennelLabel);
        bucket.events.push({ id: event.id, date: dateStr, kennel: kennelLabel });
      }
    }

    // Filter to noisy buckets and sort by event count desc.
    const reported = [...bySource.entries()]
      .filter(([, b]) => b.events.length >= MIN_COUNT_TO_REPORT)
      .sort((a, b) => b[1].events.length - a[1].events.length);

    console.log(
      `\nStale-cancellation audit (since ${since.toISOString().slice(0, 10)}): ` +
        `${reported.length} suspect source(s) with ≥${MIN_COUNT_TO_REPORT} past CANCELLED events.\n`,
    );

    if (reported.length === 0) {
      console.log("No suspects. Either the fleet is healthy or the bug is contained to upcomingOnly-eligible sources.");
      return;
    }

    for (const [sourceId, b] of reported) {
      const kennelList = [...b.kennels].sort().join(", ");
      console.log(
        `  ${b.events.length.toString().padStart(4)}  ${b.sourceType.padEnd(18)}  ${b.sourceName}`,
      );
      console.log(`         kennel(s): ${kennelList}`);
      console.log(`         sourceId:  ${sourceId}`);
      const samples = b.events.slice(0, 5);
      console.log(`         sample(s): ${samples.map((s) => `${s.date} ${s.id}`).join(", ")}`);
      console.log("");
    }

    console.log(
      "Suggested follow-up: for each suspect source above, verify the source URL is upcoming-only " +
        "(does the live page strip past rows?). If yes, add `config: { upcomingOnly: true }` to its " +
        "row in prisma/seed-data/sources.ts in a follow-up PR.",
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
