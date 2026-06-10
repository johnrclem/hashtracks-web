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

interface ProvEvent {
  rawData: unknown;
  event: { id: string; description: string | null; kennel: { kennelCode: string } | null } | null;
}
interface Update {
  id: string;
  kennelCode: string;
  after: string | null;
}

/**
 * Group provenance-matched events by kennel (eventId → description). An event is
 * provenance-matched when its canonical description exactly equals a Meetup raw
 * snapshot AND (unless `--all`) it belongs to an affected kennel. De-dupes to
 * one record per event. Returns the grouping and the skipped-row count.
 */
function groupProvenancedByKennel(rawEvents: ProvEvent[]): {
  byKennel: Map<string, Map<string, string>>;
  skipped: number;
} {
  const byKennel = new Map<string, Map<string, string>>();
  let skipped = 0;
  for (const re of rawEvents) {
    const description = re.event?.description ?? null;
    const raw = re.rawData as { description?: unknown } | null;
    const rawDescription = typeof raw?.description === "string" ? raw.description : null;
    const kennelCode = re.event?.kennel?.kennelCode ?? "?";
    const scoped = ALL || AFFECTED_KENNELS.has(kennelCode);
    if (!re.event || description === null || description !== rawDescription || !scoped) {
      skipped++;
      continue;
    }
    let group = byKennel.get(kennelCode);
    if (!group) {
      group = new Map();
      byKennel.set(kennelCode, group);
    }
    group.set(re.event.id, description);
  }
  return { byKennel, skipped };
}

/** Detect boilerplate per kennel and collect the events whose description changes. */
function computeUpdates(byKennel: Map<string, Map<string, string>>): {
  updates: Update[];
  provenancedCount: number;
} {
  const updates: Update[] = [];
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
  return { updates, provenancedCount };
}

/** One-line preview of what an update would write. */
function describeUpdate(after: string | null): string {
  if (after === null) return "NULL";
  const preview = after.length > 60 ? `${after.slice(0, 60)}...` : after;
  return `-> "${preview}"`;
}

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
  // RawEvent. An Event may have several Meetup RawEvents — de-duped to one
  // record per Event in groupProvenancedByKennel.
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

  const { byKennel, skipped } = groupProvenancedByKennel(rawEvents);
  const { updates, provenancedCount } = computeUpdates(byKennel);

  for (const u of updates) {
    console.log(`  ${u.kennelCode} ${u.id}: ${describeUpdate(u.after)}`);
  }

  console.log(
    `\nFound ${updates.length} canonical Event(s) carrying group-template boilerplate ` +
      `across ${provenancedCount} provenance-matched Meetup event(s). (${skipped} rows skipped.)`,
  );

  // Do NOT mutate RawEvent.rawData (immutable audit trail). We only rewrite the
  // canonical UI value; the next in-window scrape re-applies the same strip.
  if (APPLY) {
    for (const u of updates) {
      await prisma.event.update({ where: { id: u.id }, data: { description: u.after } });
    }
  }

  const verb = APPLY ? "Updated" : "Would update";
  console.log(`\n${verb} ${updates.length} canonical Event.description value(s).`);
  if (!APPLY) console.log("Dry-run only. Re-run with --apply to write changes.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
