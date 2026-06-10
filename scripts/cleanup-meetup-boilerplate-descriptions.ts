/**
 * One-shot cleanup for #2058/#2059/#2062: the Meetup adapter previously stored a
 * kennel's standing recurring-event template (the group blurb Meetup applies to
 * every occurrence) as each event's `description`, displacing run-specific
 * notes. The adapter fix in this same PR detects the template structurally
 * (paragraph blocks repeated verbatim across the group's events) and strips them
 * going forward — but that only fires for events still inside the scrape window.
 * Canonical Events that already stored the boilerplate and have aged out won't
 * re-merge, so they keep the stale template until cleared here.
 *
 * Structural detection (mirrors the adapter — no keyword list):
 *   - Scope to RawEvents from MEETUP-typed sources (only the Meetup adapter
 *     contributes these descriptions).
 *   - Provenance guard: only touch a canonical `Event.description` that EXACTLY
 *     equals the Meetup `RawEvent.rawData.description` snapshot, so a
 *     description merged from a different (e.g. higher-trust) adapter is never
 *     touched.
 *   - Per kennel, run the SAME paragraph-block detector the adapter uses
 *     (`detectBoilerplateBlocks` / `stripBoilerplateBlocks`): a paragraph block
 *     reused across >= 2 distinct events is template boilerplate and is removed.
 *     A fully templated description collapses to null; a club blurb prepended to
 *     a per-event stanza is partially stripped; a genuinely unique description
 *     is left untouched.
 *
 * Blast-radius control: by default this only touches the kennels named in the
 * incident (`AFFECTED_KENNELS`). The structural detector necessarily treats any
 * paragraph a kennel reuses across >= 2 events as boilerplate, so running it
 * over the entire Meetup corpus could strip a paragraph some other kennel
 * legitimately repeats. Pass `--all` to opt into the full corpus only after
 * reviewing a dry-run. Originals are always preserved in the immutable
 * `RawEvent.rawData`, so a mistaken strip is recoverable.
 *
 * Runs in dry-run mode by default — pass `--apply` to write.
 *   npx tsx scripts/cleanup-meetup-boilerplate-descriptions.ts            # preview affected kennels
 *   npx tsx scripts/cleanup-meetup-boilerplate-descriptions.ts --apply    # write affected kennels
 *   npx tsx scripts/cleanup-meetup-boilerplate-descriptions.ts --all      # preview entire Meetup corpus
 *
 * ORDERING (important):
 *   1. Run `--apply` ONLY AFTER the adapter fix in this PR is deployed to prod.
 *      For kennels whose canonical is owned by a higher-trust source (e.g.
 *      Montreal mhhh.ca trust 9 > Meetup trust 7), the merge enrich branch is
 *      fill-only (`if (!existing.description && event.description)`). If you
 *      clear a description to null while the OLD adapter is still live, the next
 *      cron re-emits the boilerplate and the fill branch puts it right back.
 *   2. Run BEFORE any `force: true` re-scrape — force deletes the RawEvents that
 *      carry the provenance link (see scripts/cleanup-lsw-stale-descriptions.ts).
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { detectBoilerplateBlocks, stripBoilerplateBlocks } from "../src/adapters/meetup/adapter";

const APPLY = process.argv.includes("--apply");
// Default scope: only the kennels named in #2058/#2059/#2062. `--all` opts into
// the full Meetup corpus (review the dry-run first — see header).
const ALL = process.argv.includes("--all");
const AFFECTED_KENNELS = new Set(["savh3", "hogtownh3", "mh3-ca"]);

async function main() {
  const meetupSources = await prisma.source.findMany({
    where: { type: "MEETUP" },
    select: { id: true },
  });
  if (meetupSources.length === 0) {
    console.log("No MEETUP sources found — nothing to scan.");
    await prisma.$disconnect();
    return;
  }

  console.log(
    `Scanning ${meetupSources.length} MEETUP source(s) for group-template boilerplate ` +
      `(scope: ${ALL ? "ALL kennels" : [...AFFECTED_KENNELS].join(", ")}).`,
  );

  // Canonical Events with a Meetup-provenance description, linked through
  // RawEvent. An Event may have several Meetup RawEvents — we de-dupe to one
  // record per Event below.
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

  // Provenance-matched events grouped by kennel (eventId → description), so the
  // block detector runs over one kennel's corpus at a time.
  const byKennel = new Map<string, Map<string, string>>();
  let skipped = 0;

  for (const re of rawEvents) {
    if (!re.event || re.event.description === null) {
      skipped++;
      continue;
    }
    const raw = re.rawData as { description?: unknown } | null;
    const rawDescription = typeof raw?.description === "string" ? raw.description : null;
    // Provenance: canonical Event.description must equal this Meetup raw's
    // stored description.
    if (rawDescription === null || re.event.description !== rawDescription) {
      skipped++;
      continue;
    }
    const kennelCode = re.event.kennel?.kennelCode ?? "?";
    if (!ALL && !AFFECTED_KENNELS.has(kennelCode)) {
      skipped++;
      continue;
    }
    let group = byKennel.get(kennelCode);
    if (!group) {
      group = new Map();
      byKennel.set(kennelCode, group);
    }
    group.set(re.event.id, re.event.description);
  }

  // For each kennel, detect boilerplate blocks across its descriptions and strip
  // them from each event. Collect the resulting writes (null or shortened).
  const updates: { id: string; kennelCode: string; after: string | null }[] = [];
  let provenancedCount = 0;
  for (const [kennelCode, events] of byKennel) {
    provenancedCount += events.size;
    const boilerplateBlocks = detectBoilerplateBlocks([...events.values()]);
    if (boilerplateBlocks.size === 0) continue;
    for (const [id, description] of events) {
      const after = stripBoilerplateBlocks(description, boilerplateBlocks);
      if (after !== description) updates.push({ id, kennelCode, after });
    }
  }

  for (const u of updates) {
    const what = u.after === null ? "NULL" : `-> "${u.after.slice(0, 60)}${u.after.length > 60 ? "..." : ""}"`;
    console.log(`  ${u.kennelCode} ${u.id}: ${what}`);
  }

  console.log(
    `\nFound ${updates.length} canonical Event(s) carrying group-template boilerplate ` +
      `across ${provenancedCount} provenance-matched Meetup event(s). (${skipped} rows skipped.)`,
  );

  // Do NOT mutate RawEvent.rawData (immutable audit trail). We only rewrite the
  // canonical UI value; the next in-window scrape re-applies the same strip.
  let cleared = 0;
  if (APPLY) {
    for (const u of updates) {
      await prisma.event.update({ where: { id: u.id }, data: { description: u.after } });
      cleared++;
    }
  }

  const verb = APPLY ? "Updated" : "Would update";
  console.log(`\n${verb} ${APPLY ? cleared : updates.length} canonical Event.description value(s).`);
  if (!APPLY) console.log("Dry-run only. Re-run with --apply to write changes.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
