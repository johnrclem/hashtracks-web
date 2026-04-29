/**
 * Live smoke for the display-layer multi-kennel migration (#1023 step 5)
 * against `hashtracks_dev`. Builds a synthetic Cherry City + OH3 co-host
 * event, then reads it back through the same WHERE filter the kennel
 * page uses — assert it surfaces on BOTH kennels' pages.
 *
 * Idempotent: cleans up the synthetic event + revertable SourceKennel
 * links it created. Refuses to run against any non-local DATABASE_URL.
 *
 * Run: `npx tsx scripts/live-verify-display-co-host.ts`
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { processRawEvents } from "@/pipeline/merge";

const PROBE_TITLE = "PROBE_DISPLAY: Cherry City × OH3 step-5 visibility";
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal", "postgres", "db"]);

function assertLocalDb(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(`Refusing to run live verification against non-local host ${host}.`);
  }
}

async function main() {
  assertLocalDb();

  // 1. Find Cherry City + OH3 + Oregon Calendar source.
  const [cch3, oh3] = await Promise.all([
    prisma.kennel.findFirst({ where: { kennelCode: "cch3-or" }, select: { id: true, slug: true } }),
    prisma.kennel.findFirst({ where: { kennelCode: "oh3" }, select: { id: true, slug: true } }),
  ]);
  if (!cch3 || !oh3) throw new Error("cch3-or or oh3 missing from hashtracks_dev — bail");

  const source = await prisma.source.findFirst({
    where: { name: "Oregon Hashing Calendar" },
    select: { id: true },
  });
  if (!source) throw new Error("Oregon Hashing Calendar source missing — bail");

  const createdLinks: Array<{ sourceId: string; kennelId: string }> = [];
  const ensureLinked = async (kennelId: string) => {
    const existing = await prisma.sourceKennel.findUnique({
      where: { sourceId_kennelId: { sourceId: source.id, kennelId } },
    });
    if (!existing) {
      await prisma.sourceKennel.create({ data: { sourceId: source.id, kennelId } });
      createdLinks.push({ sourceId: source.id, kennelId });
    }
  };
  await ensureLinked(cch3.id);
  await ensureLinked(oh3.id);

  // 2. Cleanup any prior probe state.
  const stale = await prisma.event.findMany({ where: { title: PROBE_TITLE }, select: { id: true } });
  for (const e of stale) {
    await prisma.eventKennel.deleteMany({ where: { eventId: e.id } });
    await prisma.rawEvent.deleteMany({ where: { eventId: e.id } });
    await prisma.event.delete({ where: { id: e.id } });
  }

  let createdEventId: string | null = null;
  try {
    // 3. Create a synthetic multi-kennel event via the merge pipeline.
    const result = await processRawEvents(source.id, [
      {
        date: "2099-08-15",
        kennelTags: ["cch3-or", "oh3"],
        title: PROBE_TITLE,
        runNumber: 9999,
        sourceUrl: "https://example.com/probe-display",
      },
    ]);
    if (result.created !== 1) {
      throw new Error(`Expected created=1, got ${result.created}: ${JSON.stringify(result)}`);
    }
    const event = await prisma.event.findFirst({
      where: { title: PROBE_TITLE },
      include: { eventKennels: { select: { kennelId: true, isPrimary: true } } },
    });
    if (!event) throw new Error("Created event not found");
    createdEventId = event.id;
    console.log(`Synthetic event ${event.id} written ✓`);

    // 4. Run the kennel-page WHERE filter shape from BOTH kennels.
    //    This is the rewritten predicate used in kennels/[slug]/page.tsx.
    const probeForKennel = (kennelId: string) =>
      prisma.event.findFirst({
        where: {
          eventKennels: { some: { kennelId } },
          status: { not: "CANCELLED" },
          isManualEntry: { not: true },
          isCanonical: true,
          parentEventId: null,
          title: PROBE_TITLE, // narrow to the probe so we don't scan all 34k events
        },
        include: {
          eventKennels: {
            where: { isPrimary: false },
            select: { kennel: { select: { shortName: true } } },
          },
        },
      });

    const onPrimary = await probeForKennel(cch3.id);
    if (!onPrimary) throw new Error("Probe missing on cch3-or kennel page query");
    console.log("Visible on cch3-or page ✓");

    const onCoHost = await probeForKennel(oh3.id);
    if (!onCoHost) {
      throw new Error(
        "Probe missing on oh3 kennel page query — co-host EventKennel filter not surfacing the event",
      );
    }
    console.log("Visible on oh3 page ✓ (co-host visibility working)");

    // 5. Verify coHosts SELECT shape matches what the page maps into the card.
    //    Our SELECT filters EventKennel.isPrimary=false, so this is just the
    //    secondary kennel(s). For the cch3-or × oh3 probe, that's exactly OH3.
    const coHostKennels = onPrimary.eventKennels.map((ek) => ek.kennel.shortName);
    if (coHostKennels.length !== 1) {
      throw new Error(`Expected exactly 1 co-host on cch3-or's view, got ${JSON.stringify(coHostKennels)}`);
    }
    console.log(`Primary view's coHosts = [${coHostKennels.join(", ")}] ✓`);

    // The same SELECT shape from OH3's page also returns 1 co-host row
    // (primary-anchored: the SELECT is `where: { isPrimary: false }` — fixed
    // regardless of which kennel page is viewing. Always returns the
    // non-primary kennel(s), so on OH3's page this is the cch3-or row).
    const coHostFromOh3 = onCoHost.eventKennels.map((ek) => ek.kennel.shortName);
    if (coHostFromOh3.length !== 1) {
      throw new Error(`Expected co-host count of 1, got ${coHostFromOh3.length}`);
    }
    console.log(`OH3-page view's coHosts = [${coHostFromOh3.join(", ")}] ✓ (primary-anchored)`);
  } finally {
    if (createdEventId) {
      await prisma.eventKennel.deleteMany({ where: { eventId: createdEventId } });
      await prisma.rawEvent.deleteMany({ where: { eventId: createdEventId } });
      await prisma.event.delete({ where: { id: createdEventId } }).catch(() => {});
    }
    for (const link of createdLinks) {
      await prisma.sourceKennel.delete({ where: { sourceId_kennelId: link } }).catch(() => {});
    }
    console.log("Cleanup OK");
  }

  console.log("\nDisplay-layer co-host visibility ✓");
}

main()
  .catch((err) => {
    console.error("\nDisplay-layer verification failed:");
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
