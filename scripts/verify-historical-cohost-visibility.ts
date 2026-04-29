/**
 * Read-only verifier for the historical co-host backfill (#1023 step 6).
 *
 * After running `scripts/backfill-historical-co-hosts.ts --apply`, this
 * script confirms the affected events actually surface on BOTH kennel
 * pages via the kennel-page WHERE filter. Mirrors the production page
 * predicate in `src/app/kennels/[slug]/page.tsx`.
 *
 * Read-only — no DB mutations. Safe to run anywhere.
 *
 * Run: `npx tsx scripts/verify-historical-cohost-visibility.ts`
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import {
  HISTORICAL_CO_HOST_ENTRIES,
  type CoHostBackfillEntry,
} from "./data/historical-co-hosts";

/**
 * Mirror of the kennel page production query at
 * `src/app/kennels/[slug]/page.tsx` — the only filter we tighten here is
 * the title (so we land on the specific historical row, not the kennel's
 * full event list). If the production WHERE clause changes, update this.
 */
async function eventVisibleOnKennelPage(eventId: string, kennelId: string): Promise<boolean> {
  const found = await prisma.event.findFirst({
    where: {
      id: eventId,
      eventKennels: { some: { kennelId } },
    },
    select: { id: true },
  });
  return found !== null;
}

interface KennelLite {
  id: string;
  slug: string;
}

async function findKennelByCode(kennelCode: string): Promise<KennelLite | null> {
  return prisma.kennel.findFirst({
    where: { kennelCode: { equals: kennelCode, mode: "insensitive" } },
    select: { id: true, slug: true },
  });
}

async function findEventsForEntry(
  entry: CoHostBackfillEntry,
  primary: KennelLite,
): Promise<Array<{ id: string; title: string | null }>> {
  const dayStart = new Date(`${entry.eventDate}T00:00:00Z`);
  const dayEnd = new Date(`${entry.eventDate}T23:59:59.999Z`);
  return prisma.event.findMany({
    where: {
      kennelId: primary.id,
      title: { contains: entry.titlePattern, mode: "insensitive" },
      date: { gte: dayStart, lte: dayEnd },
    },
    select: { id: true, title: true },
  });
}

interface VerifyTally {
  passes: number;
  failures: number;
}

/** Verify a single (event, primary, co-host) triple. Returns the tally delta. */
async function verifyEventOnBothPages(
  eventId: string,
  eventDate: string,
  primary: KennelLite,
  coHostCode: string,
): Promise<VerifyTally> {
  const tally: VerifyTally = { passes: 0, failures: 0 };

  if (await eventVisibleOnKennelPage(eventId, primary.id)) {
    // Primary visibility is the pre-backfill baseline; only counted if it
    // ALSO surfaces on the co-host page.
  } else {
    console.error(`✗ ${eventId} NOT visible on primary /k/${primary.slug}`);
    tally.failures++;
    return tally;
  }

  const coHost = await findKennelByCode(coHostCode);
  if (!coHost) {
    console.error(`✗ co-host kennel ${coHostCode} missing in DB`);
    tally.failures++;
    return tally;
  }

  if (await eventVisibleOnKennelPage(eventId, coHost.id)) {
    console.log(`✓ ${eventDate} ${eventId.slice(0, 12)}… visible on /k/${primary.slug} AND /k/${coHost.slug}`);
    tally.passes++;
  } else {
    console.error(`✗ ${eventId} NOT visible on co-host /k/${coHost.slug}`);
    tally.failures++;
  }
  return tally;
}

async function verifyEntry(entry: CoHostBackfillEntry): Promise<VerifyTally> {
  const tally: VerifyTally = { passes: 0, failures: 0 };

  const primary = await findKennelByCode(entry.primaryKennelCode);
  if (!primary) {
    console.warn(`SKIP "${entry.titlePattern}" — primary kennel ${entry.primaryKennelCode} missing`);
    return tally;
  }

  const events = await findEventsForEntry(entry, primary);
  if (events.length === 0) {
    console.warn(`MISS  ${entry.eventDate} ${entry.primaryKennelCode}: no event matches "${entry.titlePattern}"`);
    tally.failures++;
    return tally;
  }

  for (const event of events) {
    for (const coHostCode of entry.coHostKennelCodes) {
      const sub = await verifyEventOnBothPages(event.id, entry.eventDate, primary, coHostCode);
      tally.passes += sub.passes;
      tally.failures += sub.failures;
    }
  }
  return tally;
}

async function main() {
  let passes = 0;
  let failures = 0;

  for (const entry of HISTORICAL_CO_HOST_ENTRIES) {
    const sub = await verifyEntry(entry);
    passes += sub.passes;
    failures += sub.failures;
  }

  console.log(`\nPass: ${passes}  Fail: ${failures}`);
  if (failures > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error("\nVerifier crashed:");
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
