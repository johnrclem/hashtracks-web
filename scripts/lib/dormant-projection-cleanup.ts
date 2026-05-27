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
 *        - optional `title` exact match (used when a kennel's static-schedule
 *          phantoms share their sourceUrl with the real HTML_SCRAPER source,
 *          e.g. Mooloo H3 — see `cleanup-mooloo-projections.ts`).
 *   3. **Attendance preflight** — count `attendances` + `kennelAttendances`
 *      across the candidate set. Abort with a listing if any non-zero — the
 *      misman/RSVP audit trail is unrecoverable. (Closes #1419, #1692, #1676,
 *      #1704, #1663, #1673.)
 *   4. Dry-run logs the candidate IDs / dates / titles. `--apply` calls
 *      `cascadeDeleteEvents()` which orphans the linked RawEvents
 *      (`eventId=null, processed=false`) so the audit trail survives and the
 *      next scrape will re-link them to a real titled VEVENT if the source
 *      publishes one at the same date.
 *
 * Idempotent: re-runs after `--apply` find zero candidates and exit cleanly,
 * because the sourceUrl + placeholder-shape filter excludes anything the
 * adapter would re-create with non-NULL `runNumber` / `haresText`.
 */
import { prisma } from "@/lib/db";
import { cascadeDeleteEvents } from "./cascade-delete";

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
   */
  sourceUrlPrefixes: readonly string[];
  /**
   * Optional title-exact-match guard. Use when the dormant sourceUrl is
   * shared with a real source (Mooloo's `sporty.co.nz/mooloohhh` is the
   * static-schedule URL; the HTML_SCRAPER uses `/UpCumming-Runs`). Leaving
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
  // Misconfig guard: empty prefix list would generate `OR: []` which Prisma
  // treats as "no row" — silent false-negative that looks like success.
  if (cfg.sourceUrlPrefixes.length === 0) {
    throw new Error(
      `cleanupDormantProjections(${cfg.kennelCode}): sourceUrlPrefixes must be non-empty`,
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
  const sourceUrlOr = cfg.sourceUrlPrefixes.map((prefix) => ({
    sourceUrl: { startsWith: prefix },
  }));

  const candidates = await prisma.event.findMany({
    where: {
      kennelId: kennel.id,
      runNumber: null,
      OR: sourceUrlOr,
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
    const deleted = await cascadeDeleteEvents(
      prisma,
      candidates.map((c) => c.id),
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
