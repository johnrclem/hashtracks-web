/**
 * Inspect Hockessin H3 (`hockessin`) for ORPHAN synthetic events.
 *
 * Background (#1390 + #1394):
 *   PR #1394 nulled `Kennel.scheduleDayOfWeek` + `scheduleTime` on the
 *   Hockessin row to defuse a seasonal-cadence time-bomb (the seed had
 *   hardcoded summer-Wed which would render wrong half the year). PR 3 of
 *   the multi-cadence rollout migrates Hockessin to structured
 *   `scheduleRules` (Wed/summer + Sat/winter).
 *
 *   Hockessin has NO STATIC_SCHEDULE source — its only source is an
 *   HTML_SCRAPER that hits hockessinhash.org. The PR #1394 display-only
 *   change generated zero synthetic events, and the PR 3 structured-rules
 *   change doesn't drive event generation either (the existing HTML scrape
 *   continues unchanged).
 *
 *   Expected result of this script: ZERO orphan candidates. Documented as
 *   the no-op proof that the schedule-shape evolution didn't disturb
 *   historical event records.
 *
 * This is a DRY-RUN-ONLY script. It surfaces:
 *   1. The current set of STATIC_SCHEDULE sources for Hockessin (expect 0).
 *   2. The count of past Hockessin events partitioned by which source
 *      generated them — confirms the HTML scrape is the sole origin.
 *
 * It does NOT delete anything. If a non-empty STATIC_SCHEDULE source ever
 * surfaces, the cleanup pass should use `scripts/lib/cascade-delete.ts`
 * (`cascadeDeleteEvents`).
 *
 * Usage:
 *   npx tsx scripts/inspect-hockessin-orphan-synthetic-events.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const HOCKESSIN_KENNEL_CODE = "hockessin";

async function main() {
  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const kennel = await prisma.kennel.findUnique({
      where: { kennelCode: HOCKESSIN_KENNEL_CODE },
      select: { id: true, shortName: true },
    });
    if (!kennel) {
      console.error(`✗ Kennel "${HOCKESSIN_KENNEL_CODE}" not found.`);
      process.exitCode = 1;
      return;
    }

    console.log(`━━━ Hockessin H3 (${kennel.shortName}) source-origin audit ━━━`);

    // 1. Look for any STATIC_SCHEDULE sources linked to Hockessin. Expected: 0.
    const staticSources = await prisma.source.findMany({
      where: {
        type: "STATIC_SCHEDULE",
        kennels: { some: { kennelId: kennel.id } },
      },
      select: { id: true, name: true, url: true, enabled: true },
    });

    console.log(`  STATIC_SCHEDULE sources linked: ${staticSources.length}`);
    if (staticSources.length === 0) {
      console.log(`  ✓ No STATIC_SCHEDULE source — display-only schedule changes`);
      console.log(`    cannot have produced synthetic events.`);
    } else {
      console.log(`\n  ⚠ Found STATIC_SCHEDULE source(s) — investigate:`);
      for (const s of staticSources) {
        console.log(`    ${s.id}  enabled=${s.enabled}  ${s.name}  ${s.url ?? ""}`);
      }
    }

    // 2. Per-source past-event distribution for Hockessin. Restricted to past
    //    CONFIRMED canonical events so cancelled / duplicate / future-projected
    //    rows don't pad the histogram.
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));

    const hockessinEvents = await prisma.event.findMany({
      where: {
        eventKennels: { some: { kennelId: kennel.id } },
        date: { lt: todayUtc },
        status: "CONFIRMED",
        isCanonical: true,
      },
      select: { id: true, date: true, rawEvents: { select: { sourceId: true } } },
    });

    const sourceIdCounts = new Map<string, number>();
    for (const e of hockessinEvents) {
      for (const re of e.rawEvents) {
        sourceIdCounts.set(re.sourceId, (sourceIdCounts.get(re.sourceId) ?? 0) + 1);
      }
    }
    const sourceIds = [...sourceIdCounts.keys()];
    const sourceMeta = sourceIds.length > 0
      ? await prisma.source.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, name: true, type: true },
        })
      : [];
    const metaById = new Map(sourceMeta.map((s) => [s.id, s]));

    console.log(`\n  RawEvent counts by source (past CONFIRMED canonical events):`);
    if (sourceIdCounts.size === 0) {
      console.log(`    (no RawEvent rows yet — Hockessin events may all be manual entries)`);
    }
    for (const [sourceId, count] of sourceIdCounts) {
      const meta = metaById.get(sourceId);
      console.log(
        `    ${(meta?.type ?? "(unknown)").padEnd(20)} ${count.toString().padStart(5)}  ` +
          `${meta?.name ?? sourceId}`,
      );
    }

    console.log(`\n  Total past CONFIRMED canonical Hockessin events: ${hockessinEvents.length}`);
    if (staticSources.length === 0) {
      console.log(
        `  ✓ No-op proof: no STATIC_SCHEDULE source means no synthetic-event\n` +
          `    origin path; the seed change for #1390 is display-only.`,
      );
    } else {
      console.log(
        `  ⚠ STATIC_SCHEDULE source(s) detected (see above). Cleanup may be needed —\n` +
          `    review the linked source(s) and the per-source counts above to decide.`,
      );
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([prisma.$disconnect(), pool.end()]);
  }
}

void main();
