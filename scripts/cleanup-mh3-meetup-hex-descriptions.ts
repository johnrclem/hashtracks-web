/**
 * One-shot cleanup for #1659: MH3 Montreal Event.description rows contain
 * placeholder tokens of the shape `$XX` (hex) instead of real prose.
 *
 * The adapter-side fix in `src/adapters/meetup/adapter.ts` (cleanMeetupDescription)
 * prevents new ingest from re-introducing the shape, but the existing
 * production rows need their `description` cleared so the merge pipeline
 * can re-fill from a clean source (the new mhhh.ca HTML adapter, or a
 * subsequent Meetup re-scrape now that the field is gated).
 *
 * Scope:
 *   - Default: only mh3-ca (the only kennel where the shape was observed).
 *   - Pass `--all-kennels` to clear across every kennel — useful if alerts
 *     surface the shape on another Meetup kennel later.
 *
 * Safety:
 *   - Dry-run by default. `--apply` actually writes.
 *   - We never touch RawEvent rows (immutable audit trail per CLAUDE.md).
 *     Instead, we clear Event.description only — next scrape + merge
 *     refills from current (clean) sources.
 *
 * Usage:
 *   npm run tsx scripts/cleanup-mh3-meetup-hex-descriptions.ts             # dry-run, mh3-ca
 *   npm run tsx scripts/cleanup-mh3-meetup-hex-descriptions.ts -- --apply  # write, mh3-ca
 *   npm run tsx scripts/cleanup-mh3-meetup-hex-descriptions.ts -- --all-kennels --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const ALL_KENNELS = process.argv.includes("--all-kennels");

const HEX_TOKEN_RE = /^\s*\$[0-9a-f]+\s*$/i;

async function main() {
  const where = ALL_KENNELS
    ? { description: { not: null } }
    : { description: { not: null }, kennel: { kennelCode: "mh3-ca" } };

  const events = await prisma.event.findMany({
    where,
    select: {
      id: true,
      description: true,
      runNumber: true,
      kennel: { select: { kennelCode: true } },
      date: true,
    },
  });

  console.log(`Scanning ${events.length} events with non-null description${ALL_KENNELS ? " (all kennels)" : " for mh3-ca"}.`);

  const matches = events.filter((e) => e.description && HEX_TOKEN_RE.test(e.description));
  console.log(`Found ${matches.length} events with placeholder-hex shape.`);

  for (const ev of matches) {
    const dateStr = ev.date.toISOString().slice(0, 10);
    console.log(
      `  CLEAR  ${ev.id}  ${ev.kennel?.kennelCode ?? "?"}  ${dateStr}  run #${ev.runNumber ?? "—"}  desc=${JSON.stringify(ev.description)}`,
    );
  }

  if (APPLY && matches.length > 0) {
    const ids = matches.map((m) => m.id);
    const result = await prisma.event.updateMany({
      where: { id: { in: ids } },
      data: { description: null },
    });
    console.log(`\nCleared ${result.count} Event.description rows.`);
  } else if (matches.length > 0) {
    console.log("\nDry-run only. Re-run with --apply to clear descriptions.");
  } else {
    console.log("\nNothing to clean up.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
