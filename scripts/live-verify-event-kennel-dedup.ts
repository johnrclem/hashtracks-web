/**
 * Live smoke for `deduplicateEventKennels` against hashtracks_dev (#1023 step 2).
 * Exercises the four collapse cases that the unit tests cover, but against a
 * real Postgres so the partial unique index actually fires (or doesn't) at the
 * right transition points.
 *
 * Cases:
 *   1. Re-point: source row exists, target row does not  → kennelId moves to target
 *   2. source primary + target secondary  → source deleted, target promoted
 *   3. source secondary + target primary  → source deleted, target unchanged
 *   4. source secondary + target secondary → source deleted, target unchanged
 *
 * Idempotent: cleans up the test event + kennels at the end.
 *
 * Run: `npx tsx scripts/live-verify-event-kennel-dedup.ts`
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deduplicateEventKennels } from "@/app/admin/kennels/actions";

const TAG = "EVENT_KENNEL_DEDUP_PROBE";

async function makeKennel(slug: string, regionRefId: string) {
  return prisma.kennel.create({
    data: {
      slug: `dedup-probe-${slug}`,
      shortName: `DEDUP-${slug.toUpperCase()}`,
      kennelCode: `dedup-${slug}`,
      fullName: `Dedup Probe ${slug}`,
      region: "NYC",
      country: "USA",
      regionRef: { connect: { id: regionRefId } },
    },
  });
}

async function makeEvent(kennelId: string) {
  return prisma.event.create({
    data: {
      kennelId,
      date: new Date(Date.UTC(2099, 0, 1, 12)),
      title: TAG,
      trustLevel: 5,
    },
  });
}

async function reset(eventId: string, source: string, target: string) {
  await prisma.eventKennel.deleteMany({ where: { eventId } });
  return { source, target, eventId };
}

async function setEK(eventId: string, kennelId: string, isPrimary: boolean) {
  await prisma.eventKennel.create({ data: { eventId, kennelId, isPrimary } });
}

async function getEK(eventId: string, kennelId: string) {
  return prisma.eventKennel.findUnique({
    where: { eventId_kennelId: { eventId, kennelId } },
    select: { isPrimary: true },
  });
}

async function runCase(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`${label} ✓`);
  } catch (err) {
    console.error(`${label} ✗`);
    throw err;
  }
}

async function main() {
  // Cleanup any prior probe state.
  const stale = await prisma.event.findMany({ where: { title: TAG }, select: { id: true } });
  for (const e of stale) await prisma.eventKennel.deleteMany({ where: { eventId: e.id } });
  await prisma.event.deleteMany({ where: { title: TAG } });
  await prisma.kennel.deleteMany({ where: { slug: { startsWith: "dedup-probe-" } } });

  const region = await prisma.region.findFirst({ select: { id: true } });
  if (!region) throw new Error("No regions in hashtracks_dev — bail");
  const sourceKennel = await makeKennel("a", region.id);
  const targetKennel = await makeKennel("b", region.id);
  const event = await makeEvent(targetKennel.id);
  console.log(`source=${sourceKennel.shortName}  target=${targetKennel.shortName}  event=${event.id}`);

  // Each case wraps the dedup call in a Prisma interactive transaction (matches
  // how mergeKennels invokes it in production).
  const dedup = () =>
    prisma.$transaction((tx) => deduplicateEventKennels(tx, sourceKennel.id, targetKennel.id));

  await runCase("Case 1 — re-point (source exists, target does not)", async () => {
    await reset(event.id, sourceKennel.id, targetKennel.id);
    await setEK(event.id, sourceKennel.id, false);
    await dedup();
    const src = await getEK(event.id, sourceKennel.id);
    const tgt = await getEK(event.id, targetKennel.id);
    if (src) throw new Error("source row not deleted");
    if (!tgt || tgt.isPrimary !== false) throw new Error("target row missing or primary state wrong");
  });

  await runCase("Case 2 — source primary + target secondary (collapse with promotion)", async () => {
    await reset(event.id, sourceKennel.id, targetKennel.id);
    await setEK(event.id, targetKennel.id, false);
    await setEK(event.id, sourceKennel.id, true);
    await dedup();
    const src = await getEK(event.id, sourceKennel.id);
    const tgt = await getEK(event.id, targetKennel.id);
    if (src) throw new Error("source row not deleted");
    if (!tgt || tgt.isPrimary !== true) throw new Error("target was not promoted to primary");
  });

  await runCase("Case 3 — source secondary + target primary (collapse, no promotion)", async () => {
    await reset(event.id, sourceKennel.id, targetKennel.id);
    await setEK(event.id, targetKennel.id, true);
    await setEK(event.id, sourceKennel.id, false);
    await dedup();
    const src = await getEK(event.id, sourceKennel.id);
    const tgt = await getEK(event.id, targetKennel.id);
    if (src) throw new Error("source row not deleted");
    if (!tgt || tgt.isPrimary !== true) throw new Error("target lost primary status");
  });

  await runCase("Case 4 — source secondary + target secondary (collapse, both stay non-primary)", async () => {
    await reset(event.id, sourceKennel.id, targetKennel.id);
    await setEK(event.id, targetKennel.id, false);
    await setEK(event.id, sourceKennel.id, false);
    await dedup();
    const src = await getEK(event.id, sourceKennel.id);
    const tgt = await getEK(event.id, targetKennel.id);
    if (src) throw new Error("source row not deleted");
    if (!tgt || tgt.isPrimary !== false) throw new Error("target primary state changed unexpectedly");
  });

  // Cleanup
  await prisma.eventKennel.deleteMany({ where: { eventId: event.id } });
  await prisma.event.delete({ where: { id: event.id } });
  await prisma.kennel.delete({ where: { id: sourceKennel.id } });
  await prisma.kennel.delete({ where: { id: targetKennel.id } });
  console.log("Cleanup OK");
  console.log("\nAll EventKennel dedup cases hold ✓");
}

main()
  .catch((err) => {
    console.error("\nDedup verification failed:");
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
