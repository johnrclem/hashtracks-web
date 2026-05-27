/**
 * One-shot cleanup for issue #1632 — MH3-MN (Minneapolis H3) test /
 * admin-internal events leaked from the GOOGLE_CALENDAR source.
 *
 * The source calendar carried at least three synthetic / non-trail
 * entries that surfaced on /kennels/mh3-mn:
 *   - "Trail # Test Event" (paired with location "123 Fake St")
 *   - "PC Meeting" (admin-internal)
 *   - Empty-summary events that fell back to the kennelTag "mh3-mn" as
 *     title (Codex review caught this shape in the issue body)
 *
 * The adapter-side fix lands in `src/adapters/google-calendar/adapter.ts`
 * via TEST_ARTIFACT_TITLE_PATTERNS (#1632) — but already-merged Events
 * stay until we explicitly cancel them. This script hard-deletes the
 * leaked rows so they stop rendering, using the same
 * `deleteLeakedEvent` helper as the cleanup-issue-NNNN family.
 *
 * Safety:
 *   - Dry-run by default; pass `--apply` to actually delete.
 *   - Bounded to kennel `mh3-mn` to keep blast radius tight.
 *   - Idempotent — re-runs find zero matching rows once applied.
 *
 * Run:
 *   tsx scripts/cleanup-mh3-mn-test-events.ts          # dry-run
 *   tsx scripts/cleanup-mh3-mn-test-events.ts --apply  # destructive
 *
 * Per memory `feedback_script_env_loading.md` — `import "dotenv/config"`
 * because tsx doesn't auto-load .env.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

const KENNEL_CODE = "mh3-mn";

// Match the same shapes the adapter filter catches. Title patterns are
// anchored to whole-title to avoid bulldozing legitimate trails that
// happen to mention "test" or "PC" mid-title. The third entry catches
// the kennelTag-as-title leakage path: when an empty-summary calendar
// event fell through earlier code paths, the kennelCode "mh3-mn" itself
// surfaced as title. The adapter's `if (!item.summary) return null`
// guard prevents new ones from being created, but existing rows still
// need a sweep.
const TITLE_REGEXES: readonly RegExp[] = [
  /^\s*trail\s*#?\s*test\s+event\s*$/i,
  /^\s*pc\s+meeting\s*$/i,
  /^\s*mh3-mn\s*$/i,
];

// Location is matched case-insensitive substring — "123 Fake St" only
// appears on the synthetic test entry, so this is safe.
const LOCATION_SUBSTRING = "123 fake st";

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

  const candidates = await prisma.event.findMany({
    where: { kennelId: kennel.id },
    select: { id: true, title: true, date: true, locationName: true },
    orderBy: { date: "asc" },
  });

  const matched = candidates.filter((e) => {
    const titleHit = TITLE_REGEXES.some((re) => e.title && re.test(e.title));
    const locationHit = !!e.locationName && e.locationName.toLowerCase().includes(LOCATION_SUBSTRING);
    return titleHit || locationHit;
  });

  console.log(`\nMatched ${matched.length} of ${candidates.length} ${KENNEL_CODE} Events:`);
  for (const e of matched) {
    console.log(`  ${e.id}  ${e.date.toISOString().slice(0, 10)}  title=${JSON.stringify(e.title)}  loc=${JSON.stringify(e.locationName)}`);
  }

  if (!apply || matched.length === 0) {
    if (!apply) console.log("\nDry-run complete. Re-run with --apply to delete.");
    return;
  }

  for (const e of matched) {
    await deleteLeakedEvent(prisma, e.id);
  }
  console.log(`\nDeleted ${matched.length} leaked Event(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
