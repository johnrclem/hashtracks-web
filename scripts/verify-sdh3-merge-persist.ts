/**
 * End-to-end verify that #1316 fields survive the merge boundary.
 *
 * Spins up a fake source + kennel in the local hashtracks_dev DB,
 * runs `processRawEvents` with a HAH3-style RawEvent payload, and
 * queries the resulting Event row to confirm the four new columns
 * (cost / trailType / dogFriendly / prelube) and the description's
 * UTF-8 emoji all land on disk correctly.
 *
 * Usage: npx tsx scripts/verify-sdh3-merge-persist.ts
 *
 * The script cleans up after itself (deletes the test source + kennel
 * + any rows it created) so it's safe to re-run.
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { processRawEvents } from "@/pipeline/merge";

const TEST_KENNEL_CODE = "verify-hah3-test";
const TEST_SOURCE_NAME = "verify-hah3-test source";

async function main() {
  // Clean up any leftover state from a previous failed run.
  await cleanup();

  // Need a region for the kennel — pick any existing one.
  const anyRegion = await prisma.region.findFirst({ select: { id: true, name: true } });
  if (!anyRegion) throw new Error("No regions in DB; run prisma db seed first.");

  const kennel = await prisma.kennel.create({
    data: {
      kennelCode: TEST_KENNEL_CODE,
      shortName: "VERIFY",
      fullName: "Verify HAH3 Test",
      slug: "verify-hah3-test",
      regionId: anyRegion.id,
      region: anyRegion.name,
      country: "United States",
    },
  });
  const source = await prisma.source.create({
    data: {
      name: TEST_SOURCE_NAME,
      url: "https://example.invalid/verify",
      type: "HTML_SCRAPER",
      trustLevel: 8,
      kennels: { create: [{ kennelId: kennel.id }] },
    },
  });

  const date = "2099-12-15"; // Far-future to dodge the live source's reconcile window.
  const result = await processRawEvents(source.id, [
    {
      date,
      kennelTags: [TEST_KENNEL_CODE],
      title: "Verify Trail",
      hares: "Test Hare",
      cost: "$5",
      trailType: "A to A",
      dogFriendly: true,
      prelube: "SRO 5pm",
      description: "Bring lots of ca$h and ID 🌮 You know I love TACOS",
      sourceUrl: "https://example.invalid/verify/event-1",
    },
  ]);
  console.log("merge result:", result);

  const persisted = await prisma.event.findFirst({
    where: { kennelId: kennel.id, date: new Date(`${date}T12:00:00Z`) },
    select: {
      id: true,
      cost: true,
      trailType: true,
      dogFriendly: true,
      prelube: true,
      description: true,
      haresText: true,
    },
  });
  console.log("\npersisted Event row:", persisted);

  if (!persisted) {
    console.error("❌ no Event row created");
    process.exit(2);
  }

  const checks = {
    cost: persisted.cost === "$5",
    trailType: persisted.trailType === "A to A",
    dogFriendly: persisted.dogFriendly === true,
    prelube: persisted.prelube === "SRO 5pm",
    descriptionHasTaco: persisted.description?.includes("🌮") ?? false,
    descriptionNoMojibake: !/ðŸ/.test(persisted.description ?? ""),
  };
  console.log("\nchecks:", checks);
  const allPass = Object.values(checks).every(Boolean);
  console.log(allPass ? "\n✅ all checks pass" : "\n❌ some checks failed");

  // Clean up.
  await cleanup();
  await prisma.$disconnect();
  process.exit(allPass ? 0 : 1);
}

async function cleanup() {
  const k = await prisma.kennel.findUnique({ where: { kennelCode: TEST_KENNEL_CODE }, select: { id: true } });
  if (k) {
    await prisma.rawEvent.deleteMany({ where: { source: { name: TEST_SOURCE_NAME } } });
    await prisma.eventKennel.deleteMany({ where: { kennelId: k.id } });
    await prisma.event.deleteMany({ where: { kennelId: k.id } });
    await prisma.sourceKennel.deleteMany({ where: { kennelId: k.id } });
    await prisma.source.deleteMany({ where: { name: TEST_SOURCE_NAME } });
    await prisma.kennel.deleteMany({ where: { kennelCode: TEST_KENNEL_CODE } });
  }
}

main().catch(async (err) => {
  console.error(err);
  await cleanup();
  await prisma.$disconnect();
  process.exit(1);
});
