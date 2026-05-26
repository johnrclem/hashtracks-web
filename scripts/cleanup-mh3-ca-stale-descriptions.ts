/**
 * One-shot cleanup for #1659: the Meetup adapter previously passed bare Apollo
 * back-references (e.g. `$44`, `$43`, `$3f`) through to canonical Event
 * descriptions when Meetup's __APOLLO_STATE__ deduplicated the boilerplate
 * description string to another cache key. The adapter fix in this same PR
 * stops new leaks (resolves the ref or emits null), but ~6+ canonical Event
 * rows for mh3-ca and any other Meetup-fed kennels still carry the literal
 * `$XX` shape until they're re-scraped.
 *
 * Provenance guard:
 *   - Canonical Event.description must match the leak shape /^\$[0-9a-fA-F]+$/.
 *   - The leak is Meetup-specific (only the Meetup adapter wrote a raw Apollo
 *     ref into description). Scope to RawEvents from MEETUP-typed sources so
 *     coincidental `$XX` text from a hypothetical other adapter is left alone.
 *
 * Runs in dry-run mode by default — pass `--apply` to write.
 *   npx tsx scripts/cleanup-mh3-ca-stale-descriptions.ts            # preview
 *   npx tsx scripts/cleanup-mh3-ca-stale-descriptions.ts --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

// Tight ASCII-only regex matching the leak shape. Anchored both ends so we
// never null-out a legitimate description that merely starts with `$XX`.
// Same regex used in the merge-pipeline guard in src/adapters/meetup/adapter.ts.
const APOLLO_REF_RE = /^\$[0-9a-fA-F]+$/;

async function main() {
  // RawEvents from any MEETUP source whose stored description matches the
  // leak shape. JSON field path traversal is the Postgres-compatible way to
  // query Json columns in Prisma.
  const meetupSources = await prisma.source.findMany({
    where: { type: "MEETUP" },
    select: { id: true, name: true },
  });
  if (meetupSources.length === 0) {
    console.log("No MEETUP sources found — nothing to scan.");
    return;
  }

  console.log(`Scanning ${meetupSources.length} MEETUP source(s) for stale $XX descriptions.`);

  // Canonical Events to clear. Linked through RawEvent provenance.
  const rawEvents = await prisma.rawEvent.findMany({
    where: {
      sourceId: { in: meetupSources.map((s) => s.id) },
      eventId: { not: null },
      event: { description: { not: null } },
    },
    select: {
      rawData: true,
      event: {
        select: {
          id: true,
          description: true,
          kennel: { select: { kennelCode: true } },
        },
      },
    },
  });

  let skipped = 0;
  const eventIdsToClear = new Set<string>();

  for (const re of rawEvents) {
    if (!re.event) continue;
    const raw = re.rawData as { description?: unknown } | null;
    const rawDescription = typeof raw?.description === "string" ? raw.description : null;

    // Provenance check: a MEETUP RawEvent whose raw.description is a $XX
    // back-ref AND whose canonical Event.description matches that same ref.
    // Both must hold so we don't clear a description sourced from another
    // adapter that happened to merge first.
    if (
      rawDescription === null ||
      !APOLLO_REF_RE.test(rawDescription) ||
      re.event.description !== rawDescription
    ) {
      skipped++;
      continue;
    }

    if (!eventIdsToClear.has(re.event.id)) {
      console.log(
        `  CLEAR canonical ${re.event.id} (${re.event.kennel?.kennelCode ?? "?"}): description="${re.event.description}"`,
      );
      eventIdsToClear.add(re.event.id);
    }
  }

  console.log(
    `\nFound ${eventIdsToClear.size} canonical Event(s) carrying the $XX leak shape. (${skipped} other rows skipped — provenance did not match.)`,
  );

  // We deliberately do NOT touch RawEvent.rawData here — CLAUDE.md requires
  // RawEvents to remain an immutable audit trail. The adapter fix in this PR
  // stops new $XX entries from being written; the next scrape will create
  // fresh RawEvents whose merge replaces the canonical Event.description.
  // This script just clears the canonical UI value in advance so users don't
  // see the corruption between deploy and next-scrape.

  let canonicalCleared = 0;
  if (APPLY && eventIdsToClear.size > 0) {
    const res = await prisma.event.updateMany({
      where: { id: { in: [...eventIdsToClear] } },
      data: { description: null },
    });
    canonicalCleared = res.count;
  }

  const verb = APPLY ? "Cleared" : "Would clear";
  console.log(`\n${verb} ${APPLY ? canonicalCleared : eventIdsToClear.size} canonical Event.description value(s).`);
  if (!APPLY) console.log("Dry-run only. Re-run with --apply to write changes.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
