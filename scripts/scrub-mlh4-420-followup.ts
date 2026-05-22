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

  const target = new Date("2026-04-20T12:00:00Z");
  const ek = await prisma.eventKennel.findFirst({
    where: { kennelId: k.id, event: { date: target } },
    select: { event: { select: { id: true, title: true, runNumber: true } } },
  });
  if (!ek) { console.log("no 2026-04-20 event found"); return; }
  const e = ek.event;
  console.log(`Target: id=${e.id} title=${e.title} runNumber=${e.runNumber}`);
  if (e.runNumber == null) { console.log("already cleared — no-op"); return; }

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
  console.log(`Found ${raws.length} matching RawEvents for 2026-04-20.`);

  if (!apply) {
    console.log("\nDry run — re-run with APPLY=1 to scrub.");
    return;
  }

  await prisma.event.update({ where: { id: e.id }, data: { runNumber: null } });
  let scrubbed = 0;
  for (const r of raws) {
    const d = r.rawData as Record<string, unknown>;
    if (typeof d.runNumber === "number" && d.runNumber === 420) {
      delete d.runNumber;
      await prisma.rawEvent.update({ where: { id: r.id }, data: { rawData: d as never } });
      scrubbed++;
    }
  }
  console.log(`Event.runNumber cleared. ${scrubbed} RawEvent payload(s) scrubbed.`);
}
main()
  .catch((e) => { console.warn(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
