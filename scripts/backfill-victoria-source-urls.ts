/**
 * One-shot: rewrite existing Victoria-cluster (vh3 / dsmh3 / vk9h3) canonical
 * Event `sourceUrl`s from the bare `https://vh3.ca/` root to the per-kennel
 * section deep-link the adapter now emits (#2014, PR #2027).
 *
 * Why a backfill is needed: the merge UPDATE path preserves a non-null existing
 * `Event.sourceUrl` (`sourceUrl: existingEvent.sourceUrl ?? event.sourceUrl` in
 * `src/pipeline/merge.ts`), so a normal rescrape updates titles but NOT the
 * sourceUrl of events already stored with the old root. This script applies the
 * adapter's own per-event anchor to those rows.
 *
 * It re-runs `VictoriaH3Adapter` (the single source of truth for the schedule-
 * vs-card-only anchor choice), keys by (kennelCode, runNumber, date), and only
 * touches Events whose sourceUrl is still the bare root — so it's idempotent and
 * safe to re-run.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-victoria-source-urls.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-victoria-source-urls.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { VictoriaH3Adapter } from "@/adapters/html-scraper/victoria-h3";

const ROOT_URL = "https://vh3.ca/";
const SOURCE_NAME = "Victoria H3 Gamma Site";
const KENNEL_CODES = ["vh3", "dsmh3", "vk9h3"] as const;
const APPLY = process.env.BACKFILL_APPLY === "1";

async function main() {
  // 1. Re-run the adapter (against the real Source row) → per-event sourceUrl
  //    keyed by (kennelCode, run, date).
  const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME } });
  if (!source) throw new Error(`Source "${SOURCE_NAME}" not found — run \`npx prisma db seed\``);
  const result = await new VictoriaH3Adapter().fetch(source, { days: 400 });
  if (result.errors.length > 0) {
    throw new Error(`Adapter returned errors, aborting: ${result.errors.join("; ")}`);
  }
  const urlByKey = new Map<string, string>();
  for (const e of result.events) {
    if (e.sourceUrl) urlByKey.set(`${e.kennelTags[0]}#${e.runNumber}#${e.date}`, e.sourceUrl);
  }
  console.log(`Adapter emitted ${urlByKey.size} (kennel,run,date) → sourceUrl mappings`);

  // 2. Find existing canonical Events for these kennels still on the bare root.
  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: [...KENNEL_CODES] } },
    select: { id: true, kennelCode: true },
  });
  const codeById = new Map(kennels.map((k) => [k.id, k.kennelCode]));

  const events = await prisma.event.findMany({
    where: { kennelId: { in: kennels.map((k) => k.id) }, sourceUrl: ROOT_URL },
    select: { id: true, kennelId: true, runNumber: true, date: true },
  });
  console.log(`Found ${events.length} Victoria events still on the bare root URL`);

  // 3. Match each to the adapter's anchor; update (or report) only on a match.
  let updated = 0;
  let unmatched = 0;
  for (const ev of events) {
    const code = codeById.get(ev.kennelId);
    const isoDate = ev.date.toISOString().slice(0, 10);
    const key = `${code}#${ev.runNumber}#${isoDate}`;
    const url = urlByKey.get(key);
    if (!url) {
      unmatched++;
      continue;
    }
    if (APPLY) {
      await prisma.event.update({ where: { id: ev.id }, data: { sourceUrl: url } });
    }
    updated++;
  }

  console.log(
    `${APPLY ? "Updated" : "Would update"} ${updated} events; ${unmatched} unmatched ` +
      `(out-of-window / run-number drift — left on root).`,
  );
  if (!APPLY) console.log("Dry run — set BACKFILL_APPLY=1 to apply.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
