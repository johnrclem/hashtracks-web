/**
 * Live verification (#1023 step 4): exercise the full multi-kennel path
 * against hashtracks_dev — Oregon Calendar config + Cherry City/OH3 title
 * → resolveKennelTagFromSummary → buildRawEventFromGCalItem emits
 * `kennelTags: ["cch3-or", "oh3"]` → processRawEvents creates an Event
 * with the primary EventKennel (cch3-or) + a secondary co-host (oh3).
 *
 * Idempotent — cleans up the synthetic event at the end.
 *
 * Run: `npx tsx scripts/live-verify-multi-kennel-pattern.ts`
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { matchKennelPatterns, type KennelPattern } from "@/adapters/kennel-patterns";
import { processRawEvents } from "@/pipeline/merge";

const PROBE_TITLE = "PROBE: Cherry City H3 #1 / OH3 # 1340 (multi-kennel test)";

async function main() {
  // 1. Verify the helper produces the expected multi-kennel result for the
  //    Oregon Calendar pattern shape.
  const oregonPatterns: KennelPattern[] = [
    ["(?:Cherry City.*OH3)|(?:OH3.*Cherry City)", ["cch3-or", "oh3"]],
    ["^OH3\\b|OH3 Full Moon", "oh3"],
    ["TGIF|Friday.*Pubcrawl", "tgif"],
    ["Cherry City|Cherry Cherry City", "cch3-or"],
  ];
  const tags = matchKennelPatterns(PROBE_TITLE, oregonPatterns);
  if (tags.length !== 2 || tags[0] !== "cch3-or" || tags[1] !== "oh3") {
    throw new Error(`Helper returned wrong tags: ${JSON.stringify(tags)}`);
  }
  console.log(`Helper output: ${JSON.stringify(tags)} ✓`);

  // 2. Find the cch3-or kennel + an existing source linked to both kennels.
  const cch3 = await prisma.kennel.findFirst({ where: { kennelCode: "cch3-or" }, select: { id: true } });
  const oh3 = await prisma.kennel.findFirst({ where: { kennelCode: "oh3" }, select: { id: true } });
  if (!cch3 || !oh3) throw new Error("cch3-or or oh3 kennel missing from hashtracks_dev — bail");

  const source = await prisma.source.findFirst({
    where: { name: "Oregon Hashing Calendar" },
    select: { id: true },
  });
  if (!source) throw new Error("Oregon Hashing Calendar source missing from hashtracks_dev — bail");

  // Make sure both kennels are linked to the source (they should be).
  await prisma.sourceKennel.upsert({
    where: { sourceId_kennelId: { sourceId: source.id, kennelId: cch3.id } },
    create: { sourceId: source.id, kennelId: cch3.id },
    update: {},
  });
  await prisma.sourceKennel.upsert({
    where: { sourceId_kennelId: { sourceId: source.id, kennelId: oh3.id } },
    create: { sourceId: source.id, kennelId: oh3.id },
    update: {},
  });

  // 3. Cleanup any prior probe state.
  const stale = await prisma.event.findMany({ where: { title: PROBE_TITLE }, select: { id: true } });
  for (const e of stale) {
    await prisma.eventKennel.deleteMany({ where: { eventId: e.id } });
    await prisma.rawEvent.deleteMany({ where: { eventId: e.id } });
    await prisma.event.delete({ where: { id: e.id } });
  }

  // 4. Push a synthetic RawEventData through processRawEvents.
  const result = await processRawEvents(source.id, [
    {
      date: "2099-07-12",
      kennelTags: tags,
      title: PROBE_TITLE,
      runNumber: 1340,
      sourceUrl: "https://example.com/probe",
    },
  ]);

  if (result.created !== 1) {
    throw new Error(`Expected created=1, got ${result.created}: ${JSON.stringify(result)}`);
  }
  console.log("processRawEvents created 1 event ✓");

  // 5. Verify the resulting Event has both kennels as EventKennel rows.
  const event = await prisma.event.findFirst({
    where: { title: PROBE_TITLE },
    include: { eventKennels: { select: { kennelId: true, isPrimary: true } } },
  });
  if (!event) throw new Error("Expected Event row not found");

  const eks = event.eventKennels;
  console.log(`Event ${event.id} has ${eks.length} EventKennel rows`);

  const primaryRow = eks.find((r) => r.isPrimary);
  const coHostRows = eks.filter((r) => !r.isPrimary);

  if (!primaryRow) throw new Error("No primary EventKennel row");
  if (primaryRow.kennelId !== cch3.id) {
    throw new Error(`Primary kennel is ${primaryRow.kennelId}, expected cch3-or (${cch3.id})`);
  }
  console.log("Primary EventKennel = cch3-or ✓");

  if (coHostRows.length !== 1) {
    throw new Error(`Expected 1 co-host row, got ${coHostRows.length}`);
  }
  if (coHostRows[0].kennelId !== oh3.id) {
    throw new Error(`Co-host kennel is ${coHostRows[0].kennelId}, expected oh3 (${oh3.id})`);
  }
  console.log("Co-host EventKennel = oh3 (isPrimary=false) ✓");

  if (event.kennelId !== cch3.id) {
    throw new Error(`Denorm Event.kennelId = ${event.kennelId}, expected cch3-or`);
  }
  console.log("Denorm Event.kennelId = cch3-or ✓");

  // 6. Cleanup.
  await prisma.eventKennel.deleteMany({ where: { eventId: event.id } });
  await prisma.rawEvent.deleteMany({ where: { eventId: event.id } });
  await prisma.event.delete({ where: { id: event.id } });
  console.log("Cleanup OK");

  console.log("\nMulti-kennel pattern end-to-end ✓");
}

main()
  .catch((err) => {
    console.error("\nMulti-kennel verification failed:");
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
