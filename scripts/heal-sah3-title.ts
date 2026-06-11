/**
 * One-shot HEAL for the San Antonio H3 stale title (#1460).
 *
 * SAH3's hashrego event was registered with a doubled kennel prefix, so its
 * URL slug is "sah3-sah3-2026". A scrape taken BEFORE the kennel renamed the
 * event (and before the #1669 doubled-prefix guard landed) captured the
 * slug-shaped title "SAH3 SAH3 2026" onto the canonical Event.
 *
 * The adapter already reads the real title from og:title — the live page now
 * serves "06/19 SAH3 Summer Campout 2026", which the parser strips to
 * "SAH3 Summer Campout 2026". So the CODE is correct; only the already-persisted
 * canonical row is stale. A future scrape would heal it, but we don't want to
 * wait — this script repairs the persisted value in place.
 *
 * Safety:
 *   - Drift guard: only updates Events whose title is the stale slug shape
 *     ("SAH3 SAH3 …"); idempotent no-op (exit 0) once healed.
 *   - Scoped to the SAH3 kennel (kennelCode "sah3") via EventKennel.
 *   - Dry run unless HEAL_APPLY=1.
 *   - Post-check verifies no stale titles remain.
 *
 * Usage:
 *   Dry run: npx tsx scripts/heal-sah3-title.ts
 *   Apply:   HEAL_APPLY=1 npx tsx scripts/heal-sah3-title.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const LOG_PREFIX = "heal-sah3-title";
const KENNEL_CODE = "sah3";
const STALE_TITLE_PREFIX = "SAH3 SAH3";
const HEALED_TITLE = "SAH3 Summer Campout 2026";

const log = (m: string) => console.log(`[${LOG_PREFIX}] ${m}`);

async function main(apply: boolean): Promise<void> {
  log(`${apply ? "APPLY" : "DRY-RUN"} — heal stale "${STALE_TITLE_PREFIX} …" titles for kennel "${KENNEL_CODE}"`);

  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: KENNEL_CODE },
    select: { id: true },
  });
  if (!kennel) throw new Error(`Kennel not found: kennelCode="${KENNEL_CODE}"`);

  // Events linked to SAH3 whose title is the stale slug shape.
  const stale = await prisma.event.findMany({
    where: {
      title: { startsWith: STALE_TITLE_PREFIX },
      eventKennels: { some: { kennelId: kennel.id } },
    },
    select: { id: true, title: true, dateUtc: true },
  });

  if (stale.length === 0) {
    log("No stale titles found — already healed (no-op).");
    return;
  }

  for (const e of stale) {
    const day = e.dateUtc ? e.dateUtc.toISOString().slice(0, 10) : "no-date";
    log(`  stale Event ${e.id} (${day}): "${e.title}" → "${HEALED_TITLE}"`);
  }

  if (!apply) {
    log(`DRY-RUN — would update ${stale.length} Event(s). Re-run with HEAL_APPLY=1 to apply.`);
    return;
  }

  const result = await prisma.event.updateMany({
    where: {
      id: { in: stale.map((e) => e.id) },
      title: { startsWith: STALE_TITLE_PREFIX },
    },
    data: { title: HEALED_TITLE },
  });
  log(`Updated ${result.count} Event(s).`);

  const remaining = await prisma.event.count({
    where: {
      title: { startsWith: STALE_TITLE_PREFIX },
      eventKennels: { some: { kennelId: kennel.id } },
    },
  });
  if (remaining !== 0) throw new Error(`Post-check failed: ${remaining} stale title(s) still present`);
  log("Post-check OK — no stale titles remain.");
}

main(process.env.HEAL_APPLY === "1")
  .catch((err) => {
    console.error(`[${LOG_PREFIX}] FAILED:`, err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
