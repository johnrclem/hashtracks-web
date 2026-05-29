/**
 * Shared helper for one-shot dormant-RRULE projection cleanup scripts.
 *
 * Five kennels were hit by the same pathology — an unbounded RRULE in a
 * source calendar (or a static-schedule audit with a wide forward window)
 * materialized hundreds of placeholder Events into the canonical store, none
 * of which carry hares / run number / location. Each per-kennel script
 * configures the kennelCode and the dormant series' sourceUrl prefix(es),
 * and this helper does the rest:
 *
 *   1. Resolve the kennel by `kennelCode` (abort if missing).
 *   2. Discover phantom Events scoped to that kennel where:
 *        - `sourceUrl LIKE ANY(prefixes)` (anchors to the dormant series), AND
 *        - `runNumber IS NULL`, AND
 *        - `haresText IS NULL OR ''` (placeholder shape — guards against
 *          deleting any titled trail that happened to share a sourceUrl), AND
 *        - optional `titleEquals` exact match (the recommended belt-and-
 *          suspenders defense against RECURRENCE-ID exception overrides that
 *          could share a dormant series' eid prefix with a real title — see
 *          codex review of PR #1720).
 *   3. **Attendance preflight (atomic, isolation=Serializable)** — the
 *      candidate set is re-counted inside the same transaction that performs
 *      the delete. If attendance appears between the initial discovery and
 *      the transaction start, the in-tx recheck catches it and rolls back.
 *      Without this, the window between `findMany()` and `cascadeDeleteEvents`
 *      let concurrent writes slip through and get silently deleted alongside
 *      the phantom Events.
 *   4. Dry-run logs the candidate IDs / dates / titles. `--apply` runs the
 *      transactional delete in batches, unlinking RawEvents (`eventId=null,
 *      processed=false`) so the audit trail survives and the next scrape can
 *      re-link them if a real titled VEVENT appears at the same date.
 *
 * Idempotent: re-runs after `--apply` find zero candidates and exit cleanly,
 * because the sourceUrl + placeholder-shape filter excludes anything the
 * adapter would re-create with non-NULL `runNumber` / `haresText`.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export interface DormantCleanupConfig {
  /** Human-readable identifier surfaced in logs (e.g. "knightvillian"). */
  kennelCode: string;
  /**
   * Issue numbers this cleanup addresses — surfaced in the script's banner
   * so future readers can trace the policy provenance.
   */
  issues: readonly number[];
  /**
   * `sourceUrl` LIKE-pattern prefixes (one per dormant series). The helper
   * matches `sourceUrl LIKE '<prefix>%'`. For Mosquito's 3 RRULEs this is a
   * three-element list; for the single-dormant-series kennels it's one.
   * Optional: when a dormant GCal series has no shared sourceUrl prefix (each
   * materialized instance carries a distinct `eid`, so there's nothing to
   * anchor on — Mr. Happy's #1708), omit this and gate on `titleEquals`
   * instead. At least one of `sourceUrlPrefixes` / `titleEquals` is required.
   */
  sourceUrlPrefixes?: readonly string[];
  /**
   * Optional title-exact-match guard. Use when the dormant sourceUrl is
   * shared with a real source (Mooloo's `sporty.co.nz/mooloohhh` is the
   * static-schedule URL; the HTML_SCRAPER uses `/UpCumming-Runs`), or as the
   * sole discriminator when `sourceUrlPrefixes` is omitted (#1708). Leaving
   * undefined skips the title check.
   */
  titleEquals?: string;
  /**
   * Optional `sourceUrl NOT CONTAINS <substring>` exclusion. Defends against
   * the `startsWith` semantics of `sourceUrlPrefixes` overlapping a sibling
   * source URL (Mooloo: static-schedule URL is a prefix of the HTML_SCRAPER's
   * `/UpCumming-Runs` URL — without this guard a future scrape that emits an
   * event with title="Mooloo H3 Run" via the HTML scraper would be caught).
   */
  excludeSourceUrlContains?: string;
  /**
   * Optional `createdAt < <date>` upper bound. Makes the cleanup time-bound
   * for the legacy phantom cohort: Mooloo's STATIC_SCHEDULE post-cap scrape
   * still emits ~26 placeholder Mondays per year with the same sourceUrl +
   * title + null-runNumber signature, and we don't want a future re-run to
   * delete them. Set this to a date just after the cleanup PR merges; only
   * the pre-merge phantom cohort matches.
   */
  createdBefore?: Date;
}

export async function cleanupDormantProjections(
  cfg: DormantCleanupConfig,
  apply: boolean,
): Promise<void> {
  // Misconfig guard: with neither a sourceUrl anchor nor a title anchor, the
  // query would scope only to "kennel + null runNumber + empty hares" — far
  // too broad. Require at least one discriminator. (An empty-but-present
  // `sourceUrlPrefixes: []` is also rejected — it would generate `OR: []`,
  // which Prisma treats as "no row": a silent false-negative.)
  const hasSourceUrlGate = (cfg.sourceUrlPrefixes?.length ?? 0) > 0;
  if (!hasSourceUrlGate && !cfg.titleEquals) {
    throw new Error(
      `cleanupDormantProjections(${cfg.kennelCode}): provide at least one of ` +
        `sourceUrlPrefixes (non-empty) or titleEquals`,
    );
  }

  const banner = `${cfg.kennelCode} dormant-RRULE projection cleanup (issues ${cfg.issues.map((n) => `#${n}`).join(", ")})`;
  console.log(`\n=== ${banner} ===`);

  const kennel = await prisma.kennel.findFirst({ where: { kennelCode: cfg.kennelCode } });
  if (!kennel) {
    console.error(`Kennel ${cfg.kennelCode} not found — aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // OR-chain of `startsWith` predicates — Prisma can express each cleanly,
  // and we keep the query inside the type-checked client rather than dropping
  // to raw SQL.
  const sourceUrlOr = (cfg.sourceUrlPrefixes ?? []).map((prefix) => ({
    sourceUrl: { startsWith: prefix },
  }));

  const candidates = await prisma.event.findMany({
    where: {
      kennelId: kennel.id,
      runNumber: null,
      ...(hasSourceUrlGate ? { OR: sourceUrlOr } : {}),
      AND: [
        { OR: [{ haresText: null }, { haresText: "" }] },
        ...(cfg.titleEquals ? [{ title: cfg.titleEquals }] : []),
        ...(cfg.excludeSourceUrlContains
          ? [{ NOT: { sourceUrl: { contains: cfg.excludeSourceUrlContains } } }]
          : []),
        ...(cfg.createdBefore ? [{ createdAt: { lt: cfg.createdBefore } }] : []),
      ],
    },
    select: {
      id: true,
      date: true,
      title: true,
      locationName: true,
      sourceUrl: true,
      _count: { select: { attendances: true, kennelAttendances: true } },
    },
    orderBy: { date: "asc" },
  });

  console.log(`Found ${candidates.length} phantom Event row(s) for ${cfg.kennelCode}.`);

  // Attendance preflight: any candidate with attached attendance must NOT be
  // touched — manual reassignment is required first. We list them and abort.
  const withAttendance = candidates.filter(
    (c) => c._count.attendances > 0 || c._count.kennelAttendances > 0,
  );
  if (withAttendance.length > 0) {
    console.error(
      `\nABORT — ${withAttendance.length} candidate(s) have attendance / kennel-attendance rows. ` +
        `Reassign to a real Event before re-running:`,
    );
    for (const e of withAttendance) {
      console.error(
        `  ${e.id}  date=${e.date.toISOString().slice(0, 10)}  ` +
          `attendances=${e._count.attendances}  kennelAttendances=${e._count.kennelAttendances}  ` +
          `title=${JSON.stringify(e.title)}`,
      );
    }
    await prisma.$disconnect();
    process.exit(2);
  }

  // Compact log: just dates + the eid-tail of the sourceUrl so the operator
  // can eyeball which dormant series each row belongs to.
  for (const e of candidates) {
    const eidTail = e.sourceUrl?.match(/eid=([A-Za-z0-9_-]{8,40})/)?.[1] ?? "<not-gcal>";
    console.log(
      `  ${apply ? "DELETE" : "  --  "}  ${e.id}  date=${e.date.toISOString().slice(0, 10)}  ` +
        `title=${JSON.stringify(e.title)}  eid=${eidTail}`,
    );
  }

  if (apply && candidates.length > 0) {
    const candidateIds = candidates.map((c) => c.id);
    const deleted = await prisma.$transaction(
      async (tx) => {
        // In-transaction recheck — closes the TOCTOU window between the
        // outer `findMany` and the delete. With Serializable isolation,
        // any concurrent writer that adds attendance to a candidate row
        // after our snapshot triggers a serialization-failure abort.
        const recheck = await tx.event.findMany({
          where: { id: { in: candidateIds } },
          select: {
            id: true,
            _count: { select: { attendances: true, kennelAttendances: true } },
          },
        });
        const newAttendance = recheck.filter(
          (e) => e._count.attendances > 0 || e._count.kennelAttendances > 0,
        );
        if (newAttendance.length > 0) {
          // Thrown errors roll the whole transaction back — no rows deleted.
          throw new Error(
            `Concurrent attendance detected on ${newAttendance.length} candidate(s); ` +
              `rolling back. IDs: ${newAttendance.map((e) => e.id).join(", ")}`,
          );
        }
        return cascadeDeleteEventsTx(tx, candidateIds);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60_000,
        maxWait: 10_000,
      },
    );
    console.log(
      `\nDeleted ${deleted} Event row(s). RawEvents unlinked (eventId=null, processed=false) ` +
        `for re-link on next scrape; no attendance data lost.`,
    );
  } else if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write changes.");
  }

  await prisma.$disconnect();
}

/**
 * Tx-scoped variant of `cascadeDeleteEvents`. Same semantics as the standalone
 * helper but uses an injected `Prisma.TransactionClient` so the recheck +
 * delete share an atomic boundary. Reusing `cascadeDeleteEvents(prisma, ...)`
 * directly inside an outer interactive transaction would open a *separate*
 * connection and defeat the isolation guarantee — that's why we duplicate
 * the cascade body here instead of calling the shared helper.
 */
async function cascadeDeleteEventsTx(
  tx: Prisma.TransactionClient,
  eventIds: string[],
): Promise<number> {
  if (eventIds.length === 0) return 0;
  const BATCH_SIZE = 100;
  let deleted = 0;
  for (let i = 0; i < eventIds.length; i += BATCH_SIZE) {
    const batch = eventIds.slice(i, i + BATCH_SIZE);
    await tx.rawEvent.updateMany({
      where: { eventId: { in: batch } },
      data: { eventId: null, processed: false },
    });
    await tx.event.updateMany({
      where: { parentEventId: { in: batch } },
      data: { parentEventId: null },
    });
    await tx.eventHare.deleteMany({ where: { eventId: { in: batch } } });
    await tx.attendance.deleteMany({ where: { eventId: { in: batch } } });
    await tx.kennelAttendance.deleteMany({ where: { eventId: { in: batch } } });
    const res = await tx.event.deleteMany({ where: { id: { in: batch } } });
    deleted += res.count;
  }
  return deleted;
}
