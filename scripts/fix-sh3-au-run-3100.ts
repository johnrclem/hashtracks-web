/**
 * Restore Sydney H3 run #3100 (#2838, #2848).
 *
 * The hareline dated run #3103 "31st November". chrono fell back to the scrape
 * day, so each daily scrape filed #3103 on that day, and the merge's same-URL
 * date correction then MOVED the existing #3103 row there. On Nov 9 the scrape
 * landed #3103 on the #3100 event and overwrote it; on Nov 10 it moved that row
 * (cmuyjb26p…) off Nov 9. Run #3100 (Mon 9 Nov) no longer has an event, and a
 * stray #3103 row sits on Nov 8.
 *
 * This puts the original #3100 row back on Nov 9 with #3100's details from the
 * live page. Once the adapter fix deploys, #3103 is dated Nov 30 from the run
 * sequence and the scrape's own date correction moves the stray #3103 row there,
 * so nothing is deleted. Safe before or after the deploy; the UPDATE is guarded
 * on the row still holding run #3103, so a re-run is a no-op.
 *
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/fix-sh3-au-run-3100.ts
 *   Apply:    BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/fix-sh3-au-run-3100.ts --apply
 */
import { runOneShot } from "./lib/one-shot";

const EVENT_ID = "cmuyjb26p001e04l9edm8yx97";
const NOV_9 = new Date("2026-11-09T12:00:00Z");

void runOneShot(async ({ prisma, apply }) => {
  const row = await prisma.event.findUnique({
    where: { id: EVENT_ID },
    select: { id: true, date: true, runNumber: true, title: true, haresText: true, locationName: true, status: true, kennel: { select: { kennelCode: true } } },
  });
  console.log("Current:", JSON.stringify(row));
  if (row?.kennel.kennelCode !== "sh3-au" || row.runNumber !== 3103) {
    console.log("Nothing to do: the row is gone, on another kennel, or already restored.");
    return;
  }
  const clash = await prisma.event.findFirst({
    where: { kennel: { kennelCode: "sh3-au" }, date: NOV_9, isCanonical: true, id: { not: EVENT_ID } },
    select: { id: true, runNumber: true },
  });
  if (clash) {
    console.log(`Stop: another canonical sh3-au event already holds Nov 9 (${JSON.stringify(clash)}).`);
    return;
  }
  const data = {
    date: NOV_9,
    dateUtc: new Date("2026-11-09T07:30:00Z"), // 18:30 Australia/Sydney (AEDT, UTC+11)
    runNumber: 3100,
    title: "Sydney H3 Trail #3100",
    haresText: "Plunger & Handshake",
    locationName: "Thornleigh Oval",
    startTime: "18:30",
    description: "On Site",
    // The stored pin was geocoded from "Ingleside Scouts"; drop it rather than keep a wrong one.
    latitude: null,
    longitude: null,
    locationAddress: null,
  };
  console.log(`${apply ? "FIX" : "WOULD FIX"} ${EVENT_ID}: ${JSON.stringify(data)}`);
  if (!apply) return;
  const { count } = await prisma.event.updateMany({ where: { id: EVENT_ID, runNumber: 3103 }, data });
  console.log(`Updated ${count} row.`);
});
