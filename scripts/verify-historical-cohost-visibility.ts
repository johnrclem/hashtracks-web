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

/**
 * Each entry mirrors a `BACKFILL_ENTRIES` row in
 * `backfill-historical-co-hosts.ts` — keep in sync if entries are added.
 */
interface VerifyEntry {
  eventDate: string;
  titlePattern: string;
  primaryKennelCode: string;
  coHostKennelCodes: string[];
}

const ENTRIES: VerifyEntry[] = [
  { eventDate: "2025-07-12", titlePattern: "Cherry City H3 #1 / OH3", primaryKennelCode: "cch3-or", coHostKennelCodes: ["oh3"] },
  { eventDate: "2025-07-12", titlePattern: "Cherry City H3 #1 / OH3", primaryKennelCode: "oh3", coHostKennelCodes: ["cch3-or"] },
  { eventDate: "2025-10-28", titlePattern: "Space City H3 #313 - Joint Trail with Galveston H3", primaryKennelCode: "galh3", coHostKennelCodes: ["space-city-h3"] },
  { eventDate: "2025-12-30", titlePattern: "Galveston H3 #297 - Joint Hash with Space City H3", primaryKennelCode: "galh3", coHostKennelCodes: ["space-city-h3"] },
  { eventDate: "2026-05-30", titlePattern: "5th Saturday with Cleveland H4", primaryKennelCode: "rch3", coHostKennelCodes: ["cleh4"] },
  { eventDate: "2023-07-29", titlePattern: "5th Saturday of July Trail with Cleveland H4", primaryKennelCode: "rch3", coHostKennelCodes: ["cleh4"] },
  { eventDate: "2019-03-30", titlePattern: "Joint Cleveland Hash", primaryKennelCode: "rch3", coHostKennelCodes: ["cleh4"] },
  { eventDate: "2025-12-13", titlePattern: "CH4 and Rubber City Christmas Trail", primaryKennelCode: "cleh4", coHostKennelCodes: ["rch3"] },
  { eventDate: "2024-06-29", titlePattern: "CH4 5th Saturday with Rubber City", primaryKennelCode: "cleh4", coHostKennelCodes: ["rch3"] },
  { eventDate: "2023-07-29", titlePattern: "CH4's 5th Saturday with Rubber City", primaryKennelCode: "cleh4", coHostKennelCodes: ["rch3"] },
  { eventDate: "2022-07-30", titlePattern: "Joint Trail with Rubber City H3", primaryKennelCode: "cleh4", coHostKennelCodes: ["rch3"] },
  { eventDate: "2018-09-29", titlePattern: "CH4 Trail #790/ Rubber City", primaryKennelCode: "cleh4", coHostKennelCodes: ["rch3"] },
  { eventDate: "2026-05-16", titlePattern: "SSH3 #236 with SWH3", primaryKennelCode: "ssh3-wa", coHostKennelCodes: ["swh3"] },
];

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

async function main() {
  let failures = 0;
  let passes = 0;

  for (const entry of ENTRIES) {
    const dayStart = new Date(`${entry.eventDate}T00:00:00Z`);
    const dayEnd = new Date(`${entry.eventDate}T23:59:59.999Z`);

    const primary = await prisma.kennel.findFirst({
      where: { kennelCode: { equals: entry.primaryKennelCode, mode: "insensitive" } },
      select: { id: true, slug: true },
    });
    if (!primary) {
      console.warn(`SKIP "${entry.titlePattern}" — primary kennel ${entry.primaryKennelCode} missing`);
      continue;
    }

    const events = await prisma.event.findMany({
      where: {
        kennelId: primary.id,
        title: { contains: entry.titlePattern, mode: "insensitive" },
        date: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true, title: true },
    });

    if (events.length === 0) {
      console.warn(`MISS  ${entry.eventDate} ${entry.primaryKennelCode}: no event matches "${entry.titlePattern}"`);
      failures++;
      continue;
    }

    for (const event of events) {
      // Should appear on the primary kennel's page (it always did)
      const onPrimary = await eventVisibleOnKennelPage(event.id, primary.id);
      if (!onPrimary) {
        console.error(`✗ ${event.id} NOT visible on primary /k/${primary.slug}`);
        failures++;
      }

      for (const coHostCode of entry.coHostKennelCodes) {
        const coHost = await prisma.kennel.findFirst({
          where: { kennelCode: { equals: coHostCode, mode: "insensitive" } },
          select: { id: true, slug: true },
        });
        if (!coHost) {
          console.error(`✗ co-host kennel ${coHostCode} missing in DB`);
          failures++;
          continue;
        }
        const onCoHost = await eventVisibleOnKennelPage(event.id, coHost.id);
        if (!onCoHost) {
          console.error(`✗ ${event.id} NOT visible on co-host /k/${coHost.slug}`);
          failures++;
        } else {
          console.log(`✓ ${entry.eventDate} ${event.id.slice(0, 12)}… visible on /k/${primary.slug} AND /k/${coHost.slug}`);
          passes++;
        }
      }
    }
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
