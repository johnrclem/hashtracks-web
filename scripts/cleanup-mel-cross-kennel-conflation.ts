/**
 * Reassign misrouted Melbourne sibling events off `mel-new-moon` (#1752, #1755).
 *
 * The "Melbourne New Moon Meetup" source hosts five sibling kennels. Its
 * `kennelPatterns` routing was added AFTER years of history had already been
 * scraped, so every pre-routing Bike Hash / City H3 event landed on the default
 * `mel-new-moon` kennel. Dry-run probing on 2026-05-29 found 39 bike-titled and
 * 19 city-titled canonicals sitting under mel-new-moon.
 *
 * The historical backfill can't simply INSERT those events from the Meetup JSON
 * batches — that would fork a second canonical on the same date under a
 * different kennel (cross-kennel conflation). The events already exist with full
 * fidelity (the live adapter captured location/startTime); they're just under
 * the wrong kennel. So the correct fix is to REASSIGN them, then let the
 * backfill scripts insert only the genuinely-missing rows.
 *
 * For each mel-new-moon canonical whose title matches a sibling's matcher:
 *   - if the target kennel already holds a canonical on that date → cascade-
 *     delete the mel-new-moon duplicate (the target copy wins);
 *   - else reassign the Event + its EventKennel to the target (slot-safe).
 *
 * Title-matching is the audit key (same matchers the backfill uses), so a
 * legitimate same-day "New Moon Run" is never touched. Idempotent: a second run
 * finds nothing left to move.
 *
 * Scope: only bike-hash + city-h3 (the two issues). Full Moon / Delinquents
 * rows are also misrouted under mel-new-moon but belong to separate issues.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/cleanup-mel-cross-kennel-conflation.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/cleanup-mel-cross-kennel-conflation.ts
 */

import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
import { cascadeDeleteEvents } from "./lib/cascade-delete";
import { reassignEventKennel } from "./lib/event-reassign";
import { isBikeHashTitle } from "./backfill-mel-bike-hash-history";
import { isCityHashTitle } from "./backfill-mel-city-h3-history";

const APPLY = process.env.BACKFILL_APPLY === "1";
const DEFAULT_KENNEL = "mel-new-moon";

const TARGETS: ReadonlyArray<{ kennelCode: string; matcher: (t: string) => boolean }> = [
  { kennelCode: "melbourne-bike-hash", matcher: isBikeHashTitle },
  { kennelCode: "melbourne-city-h3", matcher: isCityHashTitle },
];

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function reassignTarget(
  prisma: PrismaClient,
  mnmId: string,
  kennelCode: string,
  matcher: (t: string) => boolean,
): Promise<void> {
  const target = await prisma.kennel.findUnique({ where: { kennelCode }, select: { id: true } });
  if (!target) {
    console.warn(`  ⚠ kennel "${kennelCode}" not found — skipping.`);
    return;
  }

  const candidates = await prisma.event.findMany({
    where: { kennelId: mnmId, isCanonical: true },
    select: { id: true, title: true, date: true, runNumber: true },
    orderBy: { date: "asc" },
  });
  const misrouted = candidates.filter((e) => e.title != null && matcher(e.title));

  console.log(`\n── ${kennelCode}: ${misrouted.length} misrouted ${DEFAULT_KENNEL} canonical(s) ──`);
  if (misrouted.length === 0) return;

  // Bulk-fetch the target kennel's occupied days once (one query, not one per
  // misrouted event). A day already held by the target means the misrouted copy
  // is a duplicate to delete; otherwise reassign — and record the day so a
  // second misrouted event on the same date becomes a delete-dup too.
  const targetEvents = await prisma.event.findMany({
    where: { kennelId: target.id, isCanonical: true },
    select: { date: true },
  });
  const targetDays = new Set(targetEvents.map((ev) => isoDay(ev.date)));

  let reassigned = 0;
  let deleted = 0;
  for (const e of misrouted) {
    const iso = isoDay(e.date);
    const slotTaken = targetDays.has(iso);
    const action = slotTaken ? "delete-dup" : "reassign";
    console.log(`  [${action}] ${iso} #${e.runNumber ?? "?"} "${e.title}"`);
    if (!APPLY) continue;
    if (slotTaken) {
      await cascadeDeleteEvents(prisma, [e.id]);
      deleted++;
    } else {
      await reassignEventKennel(prisma, e.id, mnmId, target.id);
      targetDays.add(iso);
      reassigned++;
    }
  }
  if (APPLY) console.log(`  ↳ reassigned ${reassigned}, deleted ${deleted} duplicate(s).`);
}

async function main(): Promise<void> {
  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "DRY RUN"}`);
  try {
    const mnm = await prisma.kennel.findUnique({ where: { kennelCode: DEFAULT_KENNEL }, select: { id: true } });
    if (!mnm) throw new Error(`Kennel "${DEFAULT_KENNEL}" not found.`);
    for (const { kennelCode, matcher } of TARGETS) {
      await reassignTarget(prisma, mnm.id, kennelCode, matcher);
    }
    console.log(`\nDone. ${APPLY ? "Changes committed." : "No changes — pass BACKFILL_APPLY=1 to apply."}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
