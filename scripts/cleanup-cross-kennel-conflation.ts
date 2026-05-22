/**
 * One-shot DB cleanup for the cross-kennel conflation triplet (#1233, #1542, #1556).
 *
 * All three issues land in a single PR; this script reconciles the prod
 * canonical state with the code/seed changes:
 *
 * ── #1556 (Memphis GyNO H3) ───────────────────────────────────────────────
 *   The Memphis GCal source's `kennelPatterns` already route `GyNO`-prefixed
 *   titles to `gynoh3`. One pre-fix RawEvent landed on `mh3-tn` and got a
 *   canonical Event; reassign that canonical to `gynoh3`. Also patch the
 *   gynoh3 kennel row's missing profile fields (fullName, founder,
 *   parentKennelCode) — seed-fill only touches NULLs and `fullName` ships
 *   with the wrong suffix (`Harriers` vs `Harriettes`).
 *
 * ── #1542 (Munich shared hareline) ────────────────────────────────────────
 *   The Munich H3 GoogleSheet carries MFMH3 + MASS H3 + BNH rows alongside
 *   MH3. The fix adds a `groupFilter: "MH3"` config that filters non-MH3
 *   rows out at scrape time. The 3 already-ingested misattributed canonicals
 *   on `mh3-de` must go — sibling kennels have no source-of-record yet, so
 *   they're cascade-deleted (no UI claims they were MH3 events). When
 *   `mfmh3` / `mass-h3` get their own sources, those events will flow in
 *   under the correct kennel.
 *
 * ── #1233 (C2B3H4 cancellation storm) ─────────────────────────────────────
 *   The GCal CTA-placeholder filter dropped every "C2B3H4 - HARE NEEDED"
 *   event (12 of 17 source rows). With the filter relaxed (#1233 GCal fix),
 *   future scrapes will recreate the placeholders with synthesized titles.
 *   The 3 non-CTA past trails (#4 Sep 27, #5 Oct 25, # 6 TURDUCKEN Dec 27 —
 *   all 2025) were cancelled by reconcile in the storm wake — un-cancel
 *   them so the kennel page reflects actual history.
 *
 *   IMPORTANT: this PR also adds `upcomingOnly: true` to the Chicagoland
 *   source config so reconcile stops re-cancelling past events as the GCal
 *   `singleEvents=true` window slides. That config change lands in prod
 *   only after `npx prisma db seed` runs post-merge (see memory
 *   `feedback_post_merge_seed_required`). Until then, this un-cancel may
 *   be re-cancelled by the next scrape — re-run after the seed lands.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/cleanup-cross-kennel-conflation.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/cleanup-cross-kennel-conflation.ts
 */

import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
import { cascadeDeleteEvents } from "./lib/cascade-delete";

const APPLY = process.env.BACKFILL_APPLY === "1";

async function main() {
  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "DRY RUN"}\n`);

    await cleanupMemphisGyno(prisma);
    await cleanupMunichSiblings(prisma);
    await cleanupC2B3H4Cancellations(prisma);

    console.log(`\nDone. ${APPLY ? "Changes committed." : "No changes — pass BACKFILL_APPLY=1 to apply."}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

// ── #1556 GyNO H3 ────────────────────────────────────────────────────────

/**
 * Reassign an Event from one primary kennel to another in a single transaction,
 * keeping the unique `(eventId, kennelId)` constraint on EventKennel safe.
 * If the target kennel already has an EventKennel row on this event (legitimate
 * co-host link), drop the source row instead of attempting an update that
 * would collide on the composite primary key.
 */
async function reassignEventKennel(
  prisma: PrismaClient,
  eventId: string,
  fromKennelId: string,
  toKennelId: string,
) {
  const targetCoHost = await prisma.eventKennel.findUnique({
    where: { eventId_kennelId: { eventId, kennelId: toKennelId } },
  });
  await prisma.$transaction([
    prisma.event.update({ where: { id: eventId }, data: { kennelId: toKennelId } }),
    targetCoHost
      ? prisma.eventKennel.delete({ where: { eventId_kennelId: { eventId, kennelId: fromKennelId } } })
      : prisma.eventKennel.updateMany({
          where: { eventId, kennelId: fromKennelId },
          data: { kennelId: toKennelId },
        }),
  ]);
  if (targetCoHost) {
    // The remaining row (the original co-host) now owns the kennel link.
    // If it wasn't already marked primary, promote it so downstream queries
    // that order by isPrimary surface the right kennel.
    if (!targetCoHost.isPrimary) {
      await prisma.eventKennel.update({
        where: { eventId_kennelId: { eventId, kennelId: toKennelId } },
        data: { isPrimary: true },
      });
    }
  }
}

/** Build the diff of gynoh3 profile fields that still need patching. */
function gynoProfilePatch(gyno: { fullName: string; founder: string | null; parentKennelCode: string | null }): Record<string, string> {
  const patch: Record<string, string> = {};
  if (gyno.fullName !== "Gyrls Night Out Hash House Harriettes") {
    patch.fullName = "Gyrls Night Out Hash House Harriettes";
  }
  if (!gyno.founder) patch.founder = "Wrap It Up";
  if (!gyno.parentKennelCode) patch.parentKennelCode = "mh3-tn";
  return patch;
}

/** Reassign one misattributed GyNO event from mh3-tn to gynoh3, or
 *  cascade-delete it if gynoh3 already has a canonical on that date. */
async function reassignOrDeleteGynoEvent(
  prisma: PrismaClient,
  event: { id: string; date: Date },
  mh3tnId: string,
  gynoId: string,
) {
  const dupe = await prisma.event.findFirst({
    where: { kennelId: gynoId, date: event.date, isCanonical: true },
  });
  if (dupe) {
    console.log(`    ↳ ${event.id}: gynoh3 already has a canonical at ${event.date.toISOString().slice(0, 10)} (${dupe.id}); cascade-deleting mh3-tn ghost.`);
    await cascadeDeleteEvents(prisma, [event.id]);
  } else {
    await reassignEventKennel(prisma, event.id, mh3tnId, gynoId);
    console.log(`    ↳ ${event.id}: reassigned to gynoh3.`);
  }
}

async function cleanupMemphisGyno(prisma: PrismaClient) {
  console.log("── #1556 Memphis GyNO H3 ──");

  const mh3tn = await prisma.kennel.findUnique({ where: { kennelCode: "mh3-tn" } });
  const gyno = await prisma.kennel.findUnique({ where: { kennelCode: "gynoh3" } });
  if (!mh3tn || !gyno) {
    console.warn("  ⚠ mh3-tn or gynoh3 kennel missing — re-seed first, then re-run.");
    return;
  }

  const patch = gynoProfilePatch(gyno);
  if (Object.keys(patch).length > 0) {
    console.log(`  Patching gynoh3 profile fields: ${Object.keys(patch).join(", ")}`);
    if (APPLY) await prisma.kennel.update({ where: { id: gyno.id }, data: patch });
  } else {
    console.log("  gynoh3 profile already up to date.");
  }

  // The source's own description self-identifies as GyNO H3, so anything
  // matching the kennel's name pattern in title or description belongs to
  // gynoh3, not mh3-tn.
  const misattributed = await prisma.event.findMany({
    where: {
      kennelId: mh3tn.id,
      OR: [
        { title: { contains: "GyNO", mode: "insensitive" } },
        { title: { contains: "Gyrls", mode: "insensitive" } },
        { description: { contains: "Gyrls Night Out", mode: "insensitive" } },
      ],
    },
    select: { id: true, title: true, date: true },
  });

  if (misattributed.length === 0) {
    console.log("  No misattributed GyNO events on mh3-tn.");
    return;
  }

  console.log(`  Found ${misattributed.length} misattributed event(s) on mh3-tn:`);
  for (const e of misattributed) {
    console.log(`    - ${e.id} "${e.title}" ${e.date.toISOString().slice(0, 10)}`);
  }
  if (!APPLY) return;

  for (const e of misattributed) {
    await reassignOrDeleteGynoEvent(prisma, e, mh3tn.id, gyno.id);
  }
}

// ── #1542 Munich siblings ────────────────────────────────────────────────

async function cleanupMunichSiblings(prisma: PrismaClient) {
  console.log("\n── #1542 Munich shared-sheet siblings ──");

  const mh3de = await prisma.kennel.findUnique({ where: { kennelCode: "mh3-de" } });
  if (!mh3de) {
    console.warn("  ⚠ mh3-de kennel missing.");
    return;
  }

  // Confirmed misattributed events from the issue body. Hardcoded by event id
  // so the script is auditable + idempotent — a future Munich shared-sheet
  // scrape with a `MH3`-only row #28 wouldn't accidentally re-match.
  const MISATTRIBUTED_IDS = [
    "cmn6672kj000c04jrjrgun2cz", // Trail #27 Feb 21 — MASS H3 (Bushy G)
    "cmn6672xe000g04jrdjci3861", // Trail #28 Mar 7 — MASS H3 (Bottom Blower)
    "cmohmjntp006v04l84vufjkj7", // Trail #264 May 1 — MFMH3 (Moose Diver, "Pink Moon")
  ];

  const found = await prisma.event.findMany({
    where: { id: { in: MISATTRIBUTED_IDS } },
    select: { id: true, title: true, date: true, kennelId: true, runNumber: true, haresText: true },
  });

  if (found.length === 0) {
    console.log("  No misattributed events found (already cleaned up?).");
    return;
  }

  console.log(`  Found ${found.length}/${MISATTRIBUTED_IDS.length} misattributed event(s):`);
  for (const e of found) {
    if (e.kennelId !== mh3de.id) {
      console.warn(`    ⚠ ${e.id} is no longer on mh3-de — skipping (manual review).`);
      continue;
    }
    console.log(`    - ${e.id} "${e.title}" ${e.date.toISOString().slice(0, 10)} run #${e.runNumber} hares="${e.haresText}"`);
  }

  const deletable = found.filter((e) => e.kennelId === mh3de.id).map((e) => e.id);
  if (APPLY && deletable.length > 0) {
    const deleted = await cascadeDeleteEvents(prisma, deletable);
    console.log(`    ↳ cascade-deleted ${deleted} event(s) (RawEvents unlinked, audit trail preserved).`);
  }
}

// ── #1233 C2B3H4 un-cancel + reassign ────────────────────────────────────

async function cleanupC2B3H4Cancellations(prisma: PrismaClient) {
  console.log("\n── #1233 C2B3H4 past-trail un-cancel + reassign ──");

  // The 3 confirmed real past trails that got cancelled by the reconcile storm
  // after the CTA filter dropped most of the calendar. Verified against the
  // source GCal in the issue body. They were created pre-#938 when C2B3H4
  // events were routed to chicago-h3 (the original misattribution that #938
  // was meant to fix — #938 added the new kennel + routing but didn't migrate
  // already-ingested events). Reassign here.
  const C2B3H4_LEGACY_IDS = [
    "cmlrfjbne006o04kz2u3yw873", // C2B3H4 #4 Sep 27 2025
    "cmlrfjc17007h04kzyd882hya", // C2B3H4 #5 Oct 25 2025
    "cmlrfjd3a009h04kzkdjefkf9", // C2B3H4 # 6 - TURDUCKEN Dec 27 2025
  ];

  const c2b3h4 = await prisma.kennel.findUnique({ where: { kennelCode: "c2b3h4" } });
  if (!c2b3h4) {
    console.warn("  ⚠ c2b3h4 kennel missing — skipping.");
    return;
  }

  const events = await prisma.event.findMany({
    where: { id: { in: C2B3H4_LEGACY_IDS } },
    select: { id: true, title: true, date: true, status: true, kennelId: true },
  });

  if (events.length === 0) {
    console.log("  No matching events found.");
    return;
  }

  console.log(`  Found ${events.length}/${C2B3H4_LEGACY_IDS.length} past trails:`);
  for (const e of events) {
    const needsReassign = e.kennelId !== c2b3h4.id;
    const needsUncancel = e.status === "CANCELLED";
    const action = [needsReassign && "reassign", needsUncancel && "un-cancel"].filter(Boolean).join(" + ") || "none";
    console.log(`    - ${e.id} "${e.title}" ${e.date.toISOString().slice(0, 10)} status=${e.status} action=${action}`);
  }

  if (!APPLY) return;
  for (const e of events) {
    await applyC2B3H4Fix(prisma, e, c2b3h4.id);
  }
}

/** Per-event: reassign off ch3 (if needed) and un-cancel (if needed). Slot-safe. */
async function applyC2B3H4Fix(
  prisma: PrismaClient,
  event: { id: string; date: Date; status: string; kennelId: string },
  c2b3h4Id: string,
) {
  const needsReassign = event.kennelId !== c2b3h4Id;
  if (needsReassign) {
    const slotTaken = await prisma.event.findFirst({
      where: { kennelId: c2b3h4Id, date: event.date, isCanonical: true, id: { not: event.id } },
      select: { id: true },
    });
    if (slotTaken) {
      console.log(`    ↳ ${event.id}: c2b3h4 already has canonical at ${event.date.toISOString().slice(0, 10)} (${slotTaken.id}); cascade-deleting legacy ghost.`);
      await cascadeDeleteEvents(prisma, [event.id]);
      return;
    }
    await reassignEventKennel(prisma, event.id, event.kennelId, c2b3h4Id);
  }
  const needsUncancel = event.status === "CANCELLED";
  if (needsUncancel) {
    await prisma.event.update({
      where: { id: event.id },
      data: {
        status: "CONFIRMED",
        adminCancellationReason: null,
        adminCancelledAt: null,
        adminCancelledBy: null,
      },
    });
  }
  const actions = [needsReassign && "reassigned", needsUncancel && "un-cancelled"].filter(Boolean).join(" + ");
  if (actions) console.log(`    ↳ ${event.id}: ${actions}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
