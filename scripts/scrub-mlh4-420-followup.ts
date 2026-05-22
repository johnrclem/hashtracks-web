/**
 * Post-PR-#1622 follow-up: scrub the runNumber=420 leftover on the 2026-04-20
 * MLH4 event ("🌕 Monday Moonlite – 4/20 Edition").
 *
 * Background: the parser fix from #1587 correctly rejected the documented
 * stale matches (#2000 from a street address, #946 from a Black Sheep
 * cross-reference). But the body of this particular trail post evidently
 * contains a literal "Run #420" or "Run 420" joke phrase (consistent with
 * the $1 hash cash and the 4/20 theme), which now passes the tightened
 * `\bRun[\s#]+(\d{2,})\b` regex. The real MLH4 run number on that date
 * was in the high-1600s.
 *
 * Long-term, a sanity check against the kennel's last-known runNumber
 * (e.g. reject body matches more than ±50 from rolling expected) would
 * stop joke-numbered posts from polluting LATEST RUN. Tracked as a
 * follow-up consideration; not in scope for this PR.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

async function main() {
  const apply = process.env.APPLY === "1";
  const k = await prisma.kennel.findUnique({ where: { kennelCode: "mlh4" }, select: { id: true } });
  if (!k) { console.log("MLH4 not found"); return; }

  // Predicate-driven find: ONLY targets Events whose runNumber is still 420.
  // Codex review (#1629) caught two issues with the prior shape:
  //   (P1) The old code nulled `runNumber` whenever the row had any non-null
  //        value, so a re-run after a legitimate backfill (say, runNumber=1665)
  //        would erase the real number.
  //   (P2) `findFirst({kennelId, date})` returns an arbitrary matching row when
  //        multiple Events exist for the same kennel/date (conflict/audit
  //        cases). Combining the date AND the stale-value predicate makes the
  //        target deterministic: there's at most one row matching both.
  const target = new Date("2026-04-20T12:00:00Z");
  const eks = await prisma.eventKennel.findMany({
    where: { kennelId: k.id, event: { date: target, runNumber: 420 } },
    select: { event: { select: { id: true, title: true, runNumber: true } } },
  });
  if (eks.length === 0) {
    console.log("no 2026-04-20 MLH4 event with runNumber=420 found — already clean, no-op");
  } else if (eks.length > 1) {
    console.warn(`⚠ Found ${eks.length} matching events — refusing to write to avoid wrong-row scrub.`);
    for (const ek of eks) console.warn(`  · id=${ek.event.id} title=${ek.event.title}`);
    return;
  }

  const targetEvent = eks[0]?.event;
  if (targetEvent) {
    console.log(`Target: id=${targetEvent.id} title=${targetEvent.title} runNumber=${targetEvent.runNumber}`);
  }

  // Find and scrub the matching RawEvent payload to prevent the next scrape
  // from re-writing the same wrong value.
  const sks = await prisma.sourceKennel.findMany({ where: { kennelId: k.id }, select: { sourceId: true } });
  const raws = await prisma.rawEvent.findMany({
    where: {
      sourceId: { in: sks.map((s) => s.sourceId) },
      rawData: { path: ["date"], equals: "2026-04-20" },
    },
    select: { id: true, rawData: true },
  });
  const rawsCarrying420 = raws.filter((r) => {
    const d = r.rawData as Record<string, unknown>;
    return typeof d.runNumber === "number" && d.runNumber === 420;
  });
  console.log(`Found ${raws.length} RawEvents for 2026-04-20 (${rawsCarrying420.length} carry runNumber=420).`);

  if (!apply) {
    console.log("\nDry run — re-run with APPLY=1 to scrub.");
    return;
  }

  if (targetEvent) {
    await prisma.event.update({ where: { id: targetEvent.id }, data: { runNumber: null } });
  }
  let scrubbed = 0;
  for (const r of rawsCarrying420) {
    const d = r.rawData as Record<string, unknown>;
    delete d.runNumber;
    await prisma.rawEvent.update({ where: { id: r.id }, data: { rawData: d as never } });
    scrubbed++;
  }
  console.log(`Event.runNumber cleared: ${targetEvent ? "yes" : "no-op"}. ${scrubbed} RawEvent payload(s) scrubbed.`);
}
main()
  .catch((e) => { console.warn(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
