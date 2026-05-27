/**
 * One-shot cleanup for issue #1701 — Morgantown H3 events with
 * unstripped "MH3:" title prefix.
 *
 * Six events from 2026-03-01 through 2026-04-01 carry the source's
 * "MH3:" prefix verbatim in the HashTracks title. Identical events
 * from 2026-04-15 onward (same SUMMARY shape, same GOOGLE_CALENDAR
 * source) had the prefix stripped correctly — the strip rule was
 * deployed between those dates and the older rows weren't reprocessed.
 *
 * This script rewrites the affected Event.title rows in place. The
 * fingerprint isn't touched (title isn't a fingerprint input), so the
 * next scrape will continue to find the same RawEvent → Event linkage.
 *
 * Special-case skip: 2026-10-17 "MH3: MH3 Analversary - Calling All
 * Wankers" → "MH3 Analversary - Calling All Wankers" is the legitimate
 * stripped form (the second "MH3" is the event-name token, not a
 * kennel prefix). The issue body calls this out; we still rewrite it
 * here because the strip is identical and the result is identical.
 *
 * Safety:
 *   - Dry-run by default; pass `--apply` to actually update.
 *   - Bounded to kennel `mh3-wv` to keep blast radius tight.
 *   - Idempotent: re-runs find zero matching titles once applied.
 *
 * Run:
 *   tsx scripts/cleanup-morgantown-mh3-prefix.ts          # dry-run
 *   tsx scripts/cleanup-morgantown-mh3-prefix.ts --apply  # destructive
 *
 * Per memory `feedback_script_env_loading.md` — `import "dotenv/config"`
 * because tsx doesn't auto-load .env.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const KENNEL_CODE = "mh3-wv";
const PREFIX_RE = /^MH3:\s*/;

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY (will UPDATE titles)" : "DRY-RUN"}`);

  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: KENNEL_CODE },
    select: { id: true, shortName: true },
  });
  if (!kennel) {
    console.log(`Kennel "${KENNEL_CODE}" not found — nothing to do.`);
    return;
  }
  console.log(`Targeting kennel: ${kennel.shortName} (${kennel.id})`);

  const affected = await prisma.event.findMany({
    where: {
      kennelId: kennel.id,
      title: { startsWith: "MH3:" },
    },
    select: { id: true, title: true, date: true },
    orderBy: { date: "asc" },
  });

  console.log(`\nFound ${affected.length} Event(s) with "MH3:" prefix:`);
  for (const e of affected) {
    const stripped = (e.title ?? "").replace(PREFIX_RE, "");
    console.log(`  ${e.id}  ${e.date.toISOString().slice(0, 10)}  ${JSON.stringify(e.title)} → ${JSON.stringify(stripped)}`);
  }

  if (!apply || affected.length === 0) {
    if (!apply) console.log("\nDry-run complete. Re-run with --apply to rewrite.");
    return;
  }

  let updated = 0;
  for (const e of affected) {
    const stripped = (e.title ?? "").replace(PREFIX_RE, "");
    if (!stripped || stripped === e.title) continue;
    await prisma.event.update({ where: { id: e.id }, data: { title: stripped } });
    updated++;
  }
  console.log(`\nUpdated ${updated} of ${affected.length} Event(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
