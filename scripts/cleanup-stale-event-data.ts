/**
 * One-shot DB cleanup script for two stale-data audit findings:
 *
 *   #634  Atlanta H4 Apr 4 2025: stale placeholder title "Atlanta H4 Trail" —
 *         source (board.atlantahash.com) is permanently down so no re-scrape
 *         can fix it. Wayback capture (Oct 14 2025) shows the real title
 *         "AH4 Saturday 4/5 Ponce Spring Fling".
 *
 *   #970  City H3 + others: a few canonical Event rows have CTA-shaped
 *         haresText values (e.g. "We need a Hare, Contact Full Load!") that
 *         survived from before sanitizeHares filtered the CTA pattern. The
 *         adapter now passes CTAs through and merge clears them on UPDATE,
 *         but rows that haven't received a fresh scrape since are stuck.
 *
 * Idempotent and safe to re-run: each block updates only the rows whose
 * current value still matches the stale pattern, so subsequent runs are
 * no-ops.
 *
 * Default is a dry run (counts the rows that would change without writing).
 * Pass --apply to perform the writes:
 *   npx tsx scripts/cleanup-stale-event-data.ts            # dry run
 *   npx tsx scripts/cleanup-stale-event-data.ts --apply    # write
 *
 * Delete this script after the prod run reports zero affected rows.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

interface Counts { atlanta: number; cta: number }

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const counts: Counts = { atlanta: 0, cta: 0 };
  const tag = apply ? "APPLY" : "DRY-RUN";

  // ── #634: Atlanta H4 Apr 4 2025 stale placeholder title ──
  // Match by kennelTag + exact date + the known stale title. Idempotent: if
  // the row is already corrected, the WHERE clause matches zero rows.
  const ah4Where = {
    date: new Date(Date.UTC(2025, 3, 4, 12, 0, 0)),
    title: "Atlanta H4 Trail",
    kennel: { kennelCode: "atlanta-h4" },
  } as const;
  if (apply) {
    counts.atlanta = (await prisma.event.updateMany({
      where: ah4Where,
      data: { title: "AH4 Saturday 4/5 Ponce Spring Fling" },
    })).count;
  } else {
    counts.atlanta = await prisma.event.count({ where: ah4Where });
  }
  console.log(`[#634][${tag}] Atlanta H4 Apr 4 2025: ${counts.atlanta} rows ${apply ? "updated" : "would be updated"}`);

  // ── #970: clear haresText where it matches a known CTA pattern ──
  // Patterns mirror src/adapters/utils.ts CTA_EMBEDDED_PATTERNS so we don't
  // diverge from the live filter rules. Postgres regex is POSIX (no `\b`),
  // so use word-boundary equivalents `(^|[^A-Za-z])`. Tagged-template
  // `$executeRaw` / `$queryRaw` emit a parameterized query — no SQL injection
  // surface and SonarCloud's $executeRawUnsafe hotspot stays clean.
  const ctaPattern = "(^|[^A-Za-z])(hares?[[:space:]]+(needed|wanted|required|volunteer)|need(ed)?[[:space:]]+(a[[:space:]]+)?hares?|looking[[:space:]]+for[[:space:]]+(a[[:space:]]+)?hares?)";
  if (apply) {
    counts.cta = await prisma.$executeRaw`
      UPDATE "Event" SET "haresText" = NULL
      WHERE "haresText" IS NOT NULL AND "haresText" ~* ${ctaPattern}`;
  } else {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "Event"
      WHERE "haresText" IS NOT NULL AND "haresText" ~* ${ctaPattern}`;
    counts.cta = Number(rows[0]?.count ?? 0);
  }
  console.log(`[#970][${tag}] CTA-shaped haresText: ${counts.cta} rows ${apply ? "cleared" : "would be cleared"}`);

  console.log(`\n[${tag}] Total: ${counts.atlanta + counts.cta} rows ${apply ? "updated" : "would be updated"}`);
  if (!apply) console.log(`Re-run with --apply to perform the writes.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
