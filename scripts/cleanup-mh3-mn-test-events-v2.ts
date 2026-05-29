/**
 * One-shot cleanup for issue #1736 — MH3-MN (Minneapolis H3) test /
 * admin-internal events that a post-merge re-scrape recreated after the
 * #1632 v1 cleanup (`cleanup-mh3-mn-test-events.ts`).
 *
 * v1 matched titles by exact equality after normalize; two re-leaked
 * rows slipped past it:
 *   - 2026-02-24  "Trail # Test Event Hare: L4 Location: 123Fake St,
 *     Saint Paul, MN 55555" — the source pasted a multi-field admin blob
 *     into the SUMMARY, so the whole blob appended past the
 *     `trailtestevent` stem and equality failed.
 *   - 2025-06-22  "mh3-mn" — an empty-SUMMARY row fell back to the
 *     literal kennelTag as its title.
 *
 * This v2 matches the widened adapter filter (#1736): the same
 * whitespace+`#` normalize, then a `startsWith` check against the
 * known test-artifact stems (NOT exact equality). Kept as a separate
 * script from v1 so the v1 audit trail / issue linkage stays intact.
 *
 * Deliberately not a regex with `\s*` / `#?` adjacency — Sonar S5852
 * flags those as ReDoS-shaped even for linear inputs (see memory
 * `feedback_sonar_s5852_procedural_over_regex`).
 *
 * Safety:
 *   - Dry-run by default; pass `--apply` to actually hard-delete.
 *   - Bounded to kennel `mh3-mn` to keep blast radius tight.
 *   - Hard-delete via `deleteLeakedEvent` so a re-scrape can't resurrect
 *     the leaked RawEvent (the adapter filter blocks NEW ones).
 *   - Post-delete orphan check confirms the rows are gone and left no
 *     dangling RawEvents.
 *   - Idempotent — re-runs find zero matching rows once applied.
 *
 * Run:
 *   tsx scripts/cleanup-mh3-mn-test-events-v2.ts          # dry-run
 *   tsx scripts/cleanup-mh3-mn-test-events-v2.ts --apply  # destructive
 *
 * Per memory `feedback_script_env_loading.md` — `import "dotenv/config"`
 * because tsx doesn't auto-load .env.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

const KENNEL_CODE = "mh3-mn";

// Mirrors the adapter's two match modes in
// src/adapters/google-calendar/adapter.ts:
//   - PREFIX stems: admin-internal phrases that never lead a real run
//     title, so `startsWith` is safe.
//   - EXACT titles: `mh3-mn` is the kennel's own tag — matching it as a
//     prefix would catch real titles like "MH3-MN Red Dress Run", so only
//     the bare kennelTag-fallback title is an artifact (Codex review).
const SUSPECT_TITLE_PREFIXES = new Set([
  "trailtestevent",
  "pcmeeting",
]);

const SUSPECT_TITLE_EXACT = new Set([
  "mh3-mn",
]);

function isSuspectTitle(title: string | null): boolean {
  if (!title) return false;
  const normalized = normalizeForMatch(title);
  if (SUSPECT_TITLE_EXACT.has(normalized)) return true;
  for (const prefix of SUSPECT_TITLE_PREFIXES) {
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

// Location matched as a substring AFTER the same whitespace+`#` normalize
// the titles use, so both "123 Fake St" and the no-space "123Fake St"
// variant the re-leak used collapse to the same key. Both appear only on
// the synthetic test entry, so this is safe.
const LOCATION_SUBSTRING = "123fakest";

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replaceAll(/[\s#]+/g, "");
}

async function verifyNoOrphans(deletedIds: string[]): Promise<void> {
  if (deletedIds.length === 0) return;
  const stillPresent = await prisma.event.count({ where: { id: { in: deletedIds } } });
  const danglingRaw = await prisma.rawEvent.count({ where: { eventId: { in: deletedIds } } });
  if (stillPresent === 0 && danglingRaw === 0) {
    console.log(`Verified: all ${deletedIds.length} Event(s) gone, no dangling RawEvents.`);
    return;
  }
  // Fail loud: a destructive run that left orphans behind must surface a
  // non-zero exit code so an operator/pipeline doesn't read success.
  console.warn(
    `WARNING: ${stillPresent} Event(s) still present, ${danglingRaw} dangling RawEvent(s) remain.`,
  );
  process.exitCode = 1;
}

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
    select: {
      id: true,
      title: true,
      date: true,
      locationName: true,
      _count: { select: { hares: true, attendances: true, kennelAttendances: true, rawEvents: true } },
    },
    orderBy: { date: "asc" },
  });

  const matched = candidates.filter((e) => {
    const titleHit = isSuspectTitle(e.title);
    const locationHit = !!e.locationName && normalizeForMatch(e.locationName).includes(LOCATION_SUBSTRING);
    return titleHit || locationHit;
  });

  console.log(`\nMatched ${matched.length} of ${candidates.length} ${KENNEL_CODE} Events:`);
  for (const e of matched) {
    const c = e._count;
    console.log(
      `  ${e.id}  ${e.date.toISOString().slice(0, 10)}  att=${c.attendances}/ka=${c.kennelAttendances}/hares=${c.hares}/raw=${c.rawEvents}  title=${JSON.stringify(e.title)}  loc=${JSON.stringify(e.locationName)}`,
    );
  }

  if (!apply || matched.length === 0) {
    if (!apply) console.log("\nDry-run complete. Re-run with --apply to delete.");
    return;
  }

  // Safety invariant (Codex review): these are leaked SOURCE rows, so a
  // RawEvent backing is EXPECTED (deleteLeakedEvent removes it so a
  // re-scrape can't resurrect). But they must carry zero USER-generated
  // data — any attendance/kennelAttendance/hare means a real event got
  // caught by the predicate or prod drifted since inspection. Abort the
  // whole run rather than hard-delete user data.
  const withUserData = matched.filter(
    (e) => e._count.attendances > 0 || e._count.kennelAttendances > 0 || e._count.hares > 0,
  );
  if (withUserData.length > 0) {
    console.error(
      `\nABORT: ${withUserData.length} matched Event(s) carry user data (attendance/hares) — refusing to hard-delete:`,
    );
    for (const e of withUserData) {
      const c = e._count;
      console.error(`  ${e.id}  att=${c.attendances}/ka=${c.kennelAttendances}/hares=${c.hares}  title=${JSON.stringify(e.title)}`);
    }
    process.exitCode = 1;
    return;
  }

  // The batch guard above is a fast pre-flight abort; the real enforcement
  // is the per-event transactional invariant — `deleteLeakedEvent` binds
  // these required-empty relations to their deleteMany inside the
  // transaction and rolls back if user data appeared after the snapshot
  // (TOCTOU-proof under READ COMMITTED — Codex review).
  // rawEvents is intentionally omitted: a RawEvent backing is EXPECTED for
  // these re-scrape leaks and is what the hard-delete must remove.
  for (const e of matched) {
    await deleteLeakedEvent(prisma, e.id, ["hares", "attendances", "kennelAttendances"]);
  }
  console.log(`\nDeleted ${matched.length} leaked Event(s).`);

  await verifyNoOrphans(matched.map((e) => e.id));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
