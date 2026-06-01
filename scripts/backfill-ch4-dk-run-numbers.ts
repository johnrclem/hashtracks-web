/**
 * One-shot runNumber backfill for ch4-dk (Copenhagen Howling H3) — closes #1049.
 *
 * The Google Calendar source (ch3.archive@gmail.com, owned by the GCal adapter)
 * publishes CH4 runs with the run number in the SUMMARY ("CH4 376 - Venue - Theme")
 * but never parses it into Event.runNumber, so 95+ canonical events sit with
 * runNumber=NULL. The kennel page's "Latest Run" stat is
 *   currentRunNumber = upcoming.find(runNumber != null) ?? past.find(runNumber != null)
 * (src/app/kennels/[slug]/page.tsx) — with 346–376 all NULL it falls through to the
 * last *numbered* event, #345, which is the stale value reported in #1049.
 *
 * This script parses the leading "CH4 <NNN>" from the title and writes it into
 * Event.runNumber, scoped strictly to ch4-dk canonical events. It does NOT touch
 * the GCal adapter, merge pipeline, or sibling kennels (ch3-dk / rdh3).
 *
 * Collision guard (must not re-introduce #1050): a candidate number is skipped if
 * it appears more than once among the NULL-runNumber events, or already exists on a
 * non-NULL canonical event. In prod the only internal collisions are #352 (×2) and
 * #360 (×2) — four distinct real trails sharing a kennel-side GCal SUMMARY typo
 * (different dates/venues/themes). They are deliberately left NULL and reported.
 *
 * Durability: a later GCal re-scrape emits runNumber=undefined, which the merge
 * pipeline treats as "preserve existing", so the backfilled value persists. Each
 * GCal event has a distinct sourceUrl, so distinct eventSignatures — setting
 * runNumber cannot collapse distinct canonicals in recomputeCanonical().
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   npx tsx scripts/backfill-ch4-dk-run-numbers.ts            # dry-run (default)
 *   npx tsx scripts/backfill-ch4-dk-run-numbers.ts --apply    # actually write
 *
 * Idempotent: re-running finds fewer NULLs and still skips the typo collisions.
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const APPLY = process.argv.includes("--apply");
const KENNEL_CODE = "ch4-dk";

// Anchored: the run number must follow "CH4" directly (optionally a "#"). This
// matches "CH4 376", "CH4 #376", "CH4 352 - …" but intentionally rejects
// "CH4 Full Moon - 315", "CH4 run258" and "CH4 - Flagpole" — we do not guess
// numbers that aren't in the canonical leading position.
const RE_LEADING_RUN = /^\s*CH4\s*#?\s*(\d+)\b/i;

/** Parse the leading "CH4 <NNN>" run number from an event title, or null. */
export function parseCh4TitleRunNumber(title: string | null | undefined): number | null {
  if (!title) return null;
  const m = RE_LEADING_RUN.exec(title);
  return m ? Number.parseInt(m[1], 10) : null;
}

interface CanonicalEvent {
  id: string;
  title: string | null;
  runNumber: number | null;
}

interface BackfillPlan {
  /** events whose runNumber will be set: { id, number } */
  toSet: { id: string; number: number }[];
  /** numbers skipped because they collide (internal dup or already taken) */
  skippedCollisions: number[];
  /** count of NULL-runNumber events whose title has no leading CH4 number */
  unparseable: number;
}

/**
 * Pure planner — decides which NULL-runNumber events get which number, applying
 * the collision guard. Exported for unit testing.
 */
export function planRunNumberBackfill(events: CanonicalEvent[]): BackfillPlan {
  const taken = new Set<number>();
  for (const e of events) {
    if (e.runNumber != null) taken.add(e.runNumber);
  }

  // Collect parseable candidates and tally their numbers to detect internal dups.
  const candidateCounts = new Map<number, number>();
  const candidates: { id: string; number: number }[] = [];
  let unparseable = 0;
  for (const e of events) {
    if (e.runNumber != null) continue;
    const number = parseCh4TitleRunNumber(e.title);
    if (number == null) {
      unparseable++;
      continue;
    }
    candidateCounts.set(number, (candidateCounts.get(number) ?? 0) + 1);
    candidates.push({ id: e.id, number });
  }

  // Skip any number that collides internally (appears >1×) or is already taken.
  const toSet: { id: string; number: number }[] = [];
  const skipped = new Set<number>();
  for (const { id, number } of candidates) {
    if ((candidateCounts.get(number) ?? 0) > 1 || taken.has(number)) {
      skipped.add(number);
      continue;
    }
    toSet.push({ id, number });
  }

  return {
    toSet,
    skippedCollisions: [...skipped].sort((a, b) => a - b),
    unparseable,
  };
}

async function main() {
  console.log(`\n=== backfill-ch4-dk-run-numbers ===`);
  console.log(`Mode: ${APPLY ? "APPLY (will write to DB)" : "DRY-RUN (read-only)"}`);

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as never);

  try {
    const kennel = await prisma.kennel.findUnique({
      where: { kennelCode: KENNEL_CODE },
      select: { id: true, shortName: true },
    });
    if (!kennel) {
      console.error(`${KENNEL_CODE} kennel not found — aborting.`);
      process.exit(1);
    }

    // Scope strictly to events where ch4-dk is the PRIMARY kennel. Event.runNumber
    // is a single kennel-specific field shared across co-hosts, so writing it on a
    // row where ch4-dk is only a secondary co-host would leak CH4 numbering into
    // another kennel's display. CH4 has no co-hosts today, but this keeps the
    // script correct if that ever changes.
    const primaryScope = {
      kennelId: kennel.id,
      eventKennels: { some: { kennelId: kennel.id, isPrimary: true } },
    } as const;

    const events: CanonicalEvent[] = await prisma.event.findMany({
      where: { isCanonical: true, ...primaryScope },
      select: { id: true, title: true, runNumber: true },
    });

    const nullCount = events.filter((e) => e.runNumber == null).length;
    const plan = planRunNumberBackfill(events);

    console.log(`\nCanonical ${kennel.shortName} events: ${events.length}`);
    console.log(`  NULL runNumber:        ${nullCount}`);
    console.log(`  Will set runNumber on: ${plan.toSet.length}`);
    console.log(
      `  Skipped (collisions):  ${plan.skippedCollisions.length}` +
        (plan.skippedCollisions.length ? ` → #${plan.skippedCollisions.join(", #")}` : ""),
    );
    console.log(`  Unparseable titles:    ${plan.unparseable}`);

    if (plan.toSet.length === 0) {
      console.log("\nNothing to set — already backfilled.");
      return;
    }

    if (!APPLY) {
      console.log(`\nDry-run complete. Re-run with --apply to set ${plan.toSet.length} run numbers.`);
      return;
    }

    console.log(`\n⚠️  APPLY mode — writing in 3s. Ctrl-C to abort.`);
    await new Promise((r) => setTimeout(r, 3000));

    // Predicate-guarded writes: each update only fires if the row is STILL a
    // primary, canonical, NULL-runNumber ch4-dk event. If a scrape or manual
    // repair changed it between the snapshot and now, count comes back 0 and we
    // safely skip rather than overwrite a stale assumption (fail-closed).
    let written = 0;
    let drifted = 0;
    for (const { id, number } of plan.toSet) {
      const { count } = await prisma.event.updateMany({
        where: { id, isCanonical: true, runNumber: null, ...primaryScope },
        data: { runNumber: number },
      });
      if (count === 1) written++;
      else drifted++;
    }
    console.log(`\nSet runNumber on ${written} events.`);
    if (drifted > 0) {
      console.log(`Skipped ${drifted} events that changed since the snapshot (not overwritten).`);
    }

    // Verify: max run number now reflects the real latest run, and no non-NULL dups.
    const afterEvents = await prisma.event.findMany({
      where: { isCanonical: true, runNumber: { not: null }, ...primaryScope },
      select: { runNumber: true },
    });
    const maxRun = afterEvents.reduce((m, e) => Math.max(m, e.runNumber ?? 0), 0);
    const counts = new Map<number, number>();
    for (const e of afterEvents) {
      if (e.runNumber != null) counts.set(e.runNumber, (counts.get(e.runNumber) ?? 0) + 1);
    }
    const dupNumbers = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);

    console.log(`Max runNumber (canonical): ${maxRun}`);
    console.log(
      `Non-NULL duplicate run numbers: ${dupNumbers.length}` +
        (dupNumbers.length ? ` → #${dupNumbers.sort((a, b) => a - b).join(", #")}` : ""),
    );
    if (dupNumbers.length > 0) {
      console.error(`\nERROR: backfill introduced duplicate run numbers — investigate.`);
      process.exit(1);
    }
    if (drifted > 0) {
      console.error(`\nERROR: ${drifted} planned writes drifted — re-run to retry the skipped rows.`);
      process.exit(1);
    }
    console.log(`\nDone. ✓`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

// Only auto-run when invoked directly (not when imported by the test file).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("\nFatal error:", err);
    process.exit(1);
  });
}
