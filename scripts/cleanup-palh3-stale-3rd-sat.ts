/**
 * One-shot cleanup for the stale PalH3 "PalH3 Monthly Run" placeholder Events
 * left behind when the STATIC_SCHEDULE recurrence was corrected from a single
 * "3rd Saturday monthly" rule to "2nd & 4th Saturday" (#1903).
 *
 * The old STATIC source synthesized one event per month on the 3rd Saturday with
 * the generic title "PalH3 Monthly Run". The corrected schedule emits events on
 * the 2nd & 4th Saturdays with the new default title "Palmetto H3 Trail", so the
 * old 3rd-Saturday placeholders are orphaned at dates the adapter no longer
 * produces. The reconciler would only cancel them (cancelled-but-visible); this
 * deletes them. (Canonical-ghost cleanup that accompanies a date-changing static
 * fix — memory: feedback_parser_fix_canonical_ghosts.)
 *
 * Selection is intentionally narrow: only Events whose title is EXACTLY the old
 * placeholder. The corrected STATIC adapter emits "Palmetto H3 Trail" and the
 * Google Calendar emits real per-run titles, so live events are never matched.
 * Events with attendance check-ins are kept (a synthetic placeholder shouldn't
 * have any — flagged loudly if one does). Deletion uses the shared cascade-safe
 * helper (unlinks RawEvents to preserve the audit trail).
 *
 * Run order (POST-merge — Vercel deploys schema but not seed data):
 *   1. npx prisma db seed                                  # flips the RRULE to 2SA/4SA
 *   2. re-scrape PalH3 (admin re-scrape / cron)            # creates the 2nd/4th-Sat events
 *   3. npx tsx scripts/cleanup-palh3-stale-3rd-sat.ts            # dry run
 *   4. npx tsx scripts/cleanup-palh3-stale-3rd-sat.ts --apply    # apply
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { cascadeDeleteEvents } from "./lib/cascade-delete";
import { parseApplyMode, resolveCleanupKennel } from "./lib/cleanup-cli";

const KENNEL_CODE = "palh3";
export const PLACEHOLDER_TITLE = "PalH3 Monthly Run";

async function main() {
  const apply = parseApplyMode();
  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const kennel = await resolveCleanupKennel(prisma, KENNEL_CODE);
    if (!kennel) return;

    const placeholders = await prisma.event.findMany({
      where: { kennelId: kennel.id, title: PLACEHOLDER_TITLE },
      select: { id: true, date: true, status: true, _count: { select: { attendances: true } } },
      orderBy: { date: "asc" },
    });
    console.log(`Found ${placeholders.length} "${PLACEHOLDER_TITLE}" placeholder event(s).`);

    const deletable = placeholders.filter((e) => e._count.attendances === 0);
    for (const e of placeholders) {
      const kept = e._count.attendances > 0;
      console.log(
        `  ${e.date.toISOString().slice(0, 10)} status=${e.status} attendances=${e._count.attendances}` +
          (kept ? " → KEPT (has check-ins)" : ""),
      );
    }
    if (placeholders.length - deletable.length > 0) {
      console.warn(
        `⚠️  Kept ${placeholders.length - deletable.length} event(s) with check-ins — unexpected on a synthetic placeholder; investigate before forcing.`,
      );
    }

    if (!apply) {
      console.log(`\nDry-run: ${deletable.length} event(s) would be deleted. Re-run with --apply.`);
      return;
    }
    const deleted = await cascadeDeleteEvents(prisma, deletable.map((e) => e.id));
    console.log(`\n✅ Deleted ${deleted} stale 3rd-Saturday placeholder event(s).`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
