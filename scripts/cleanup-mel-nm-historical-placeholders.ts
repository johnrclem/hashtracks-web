/**
 * One-shot cleanup for issue #1737 — Mel-NM (Melbourne New Moon H3)
 * historical 2024 placeholder events.
 *
 * PR #1726 added TEMPLATE_TITLE_PATTERNS to the Meetup adapter's
 * `cleanMeetupTitle`, blocking NEW template-shaped titles. But 13
 * historical 2024 Events still carry the verbatim Meetup recurrence
 * template `"Every Wednesday @ 6:30pm from tbd"` as their title — they
 * fall outside the Mel-NM Meetup source's `scrapeDays: 180` window, so
 * the adapter never re-emits them and the merge pipeline never gets a
 * chance to apply the new rejection logic.
 *
 * Why hard-delete (not a title rewrite): inspection on 2026-05-28 showed
 * all 13 rows have runNumber=null, zero hares, zero attendance, zero
 * KennelAttendance, AND zero RawEvent backing. They are orphaned
 * placeholder canonical Events with no recoverable identity and no data
 * worth preserving — there's nothing to rewrite a title *for*. Deleting
 * them is consistent with the other cleanup-* scripts in this bundle.
 *
 * Why NOT widen scrapeDays: per the issue, bumping Mel-NM's Meetup
 * `scrapeDays` to ~600 to cover 2024 would waste API calls on every
 * scrape just to fix a one-shot historical issue. One-shot cleanup is
 * the right shape; the source config is intentionally left untouched.
 *
 * Safety:
 *   - Dry-run by default; pass `--apply` to actually hard-delete.
 *   - Bounded to kennel `mel-new-moon`, year 2024, and the exact
 *     template-title shape — three independent guards.
 *   - Hard-delete via `deleteLeakedEvent`.
 *   - Post-delete orphan check confirms the rows are gone.
 *   - Idempotent — re-runs find zero matching rows once applied.
 *
 * Run:
 *   tsx scripts/cleanup-mel-nm-historical-placeholders.ts          # dry-run
 *   tsx scripts/cleanup-mel-nm-historical-placeholders.ts --apply  # destructive
 *
 * Per memory `feedback_script_env_loading.md` — `import "dotenv/config"`
 * because tsx doesn't auto-load .env.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";
import { verifyNoOrphans } from "./lib/verify-no-orphans";

const KENNEL_CODE = "mel-new-moon";

// The verbatim Meetup recurrence-template title. Matched as a prefix so
// minor trailing drift ("...from tbd", "...from TBD") still collapses,
// but the "Every Wednesday @" lead is specific enough to never hit a
// real trail name. Not a regex — string prefix keeps it Sonar-clean.
const TEMPLATE_TITLE_PREFIX = "Every Wednesday @";

// Hard date guard: only 2024 rows. Keeps the sweep off any current-year
// event even if a future template leak somehow shared the prefix.
const YEAR = 2024;

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY (will hard-delete)" : "DRY-RUN"}`);

  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: KENNEL_CODE },
    select: { id: true, shortName: true },
  });
  if (!kennel) {
    console.log(`Kennel "${KENNEL_CODE}" not found — nothing to do.`);
    return;
  }
  console.log(`Targeting kennel: ${kennel.shortName} (${kennel.id})`);

  const matched = await prisma.event.findMany({
    where: {
      kennelId: kennel.id,
      title: { startsWith: TEMPLATE_TITLE_PREFIX },
      date: {
        gte: new Date(Date.UTC(YEAR, 0, 1)),
        lt: new Date(Date.UTC(YEAR + 1, 0, 1)),
      },
    },
    select: {
      id: true,
      title: true,
      date: true,
      _count: { select: { hares: true, attendances: true, kennelAttendances: true, rawEvents: true } },
    },
    orderBy: { date: "asc" },
  });

  console.log(`\nMatched ${matched.length} ${KENNEL_CODE} placeholder Event(s) in ${YEAR}:`);
  for (const e of matched) {
    const c = e._count;
    console.log(
      `  ${e.id}  ${e.date.toISOString().slice(0, 10)}  att=${c.attendances}/ka=${c.kennelAttendances}/hares=${c.hares}/raw=${c.rawEvents}  title=${JSON.stringify(e.title)}`,
    );
  }

  if (!apply || matched.length === 0) {
    if (!apply) console.log("\nDry-run complete. Re-run with --apply to delete.");
    return;
  }

  // Safety invariant (Codex review): the hard-delete is only justified
  // because these rows are pure orphaned placeholders — zero hares, zero
  // attendance, zero kennelAttendance, AND zero RawEvent backing. Enforce
  // that at execution time, not just in the header: if prod has drifted or
  // a real `Every Wednesday @…` 2024 event exists, abort the whole run
  // rather than irreversibly delete data.
  const withData = matched.filter((e) => {
    const c = e._count;
    return c.hares > 0 || c.attendances > 0 || c.kennelAttendances > 0 || c.rawEvents > 0;
  });
  if (withData.length > 0) {
    console.error(
      `\nABORT: ${withData.length} matched Event(s) are not pure orphans (have hares/attendance/RawEvent) — refusing to hard-delete:`,
    );
    for (const e of withData) {
      const c = e._count;
      console.error(`  ${e.id}  att=${c.attendances}/ka=${c.kennelAttendances}/hares=${c.hares}/raw=${c.rawEvents}  title=${JSON.stringify(e.title)}`);
    }
    process.exitCode = 1;
    return;
  }

  // The batch guard above is a fast pre-flight abort; the real enforcement
  // is the per-event transactional invariant — `deleteLeakedEvent` binds
  // these required-empty relations to their deleteMany inside the
  // transaction and rolls back if any row appeared after the snapshot
  // (TOCTOU-proof under READ COMMITTED — Codex review).
  for (const e of matched) {
    await deleteLeakedEvent(prisma, e.id, ["hares", "attendances", "kennelAttendances", "rawEvents"]);
  }
  console.log(`\nDeleted ${matched.length} placeholder Event(s).`);

  await verifyNoOrphans(prisma, matched.map((e) => e.id));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
