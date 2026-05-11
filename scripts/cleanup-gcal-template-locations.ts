/**
 * One-shot cleanup for #1329: GCal-sourced Event rows whose `locationName`
 * leaked a template field like `When: 5:69` (Flour City "When:" inside joke
 * for 6:09 PM, written into the GCal Location field by accident) — and also
 * any other rows where the stored locationName matches the
 * `NON_ADDRESS_RE` shape (`When:`, `Why:`, `Hare:`, `What:`, `Who:`, `Cost:`).
 *
 * The adapter already rejects these values at scrape time (the
 * `isNonAddressText` filter applies whether the value came from `item.location`
 * directly or from description fallback — verified by the regression tests in
 * `src/adapters/google-calendar/adapter.test.ts`). But stale rows from before
 * the filter was added (PR #1227 + this PR's BARE_LABEL_RE extension) keep
 * their corrupt `locationName` until re-scrape — and the merge pipeline's
 * preserve-existing semantics mean a re-scrape with a now-undefined location
 * does NOT auto-clear them.
 *
 * Strategy: scope to Events sourced from GOOGLE_CALENDAR adapters and clear
 * locationName where it matches the template-label shape. Conservative:
 * we only touch rows whose locationName starts with one of the labels and
 * is short (< 40 chars) — avoids false positives like "When the bell rings…".
 *
 * Runs in dry-run mode by default — pass `--apply` to write.
 *   npm run tsx scripts/cleanup-gcal-template-locations.ts           # preview
 *   npm run tsx scripts/cleanup-gcal-template-locations.ts -- --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

/** Same shape as NON_ADDRESS_RE in src/adapters/google-calendar/adapter.ts — must stay in sync. */
const TEMPLATE_LABEL_RE = /^\s*(?:when|why|hare|what|who|cost)\s*:/i;
/** DB-side pre-filter. Postgres `startsWith` is case-insensitive when the
 *  column is case-collation-aware, but Prisma exposes an explicit `mode`. */
const TEMPLATE_LABEL_PREFIXES = ["When:", "Why:", "Hare:", "Hares:", "What:", "Who:", "Cost:"];

async function main() {
  type Row = {
    id: string;
    kennelId: string;
    locationName: string | null;
    date: Date;
    title: string | null;
  };
  // DB-side filter narrows the pull to candidates that start with one of the
  // template labels — the Node-side regex is the final source of truth and
  // catches any whitespace/case variations the prefix list might miss.
  const events: Row[] = await prisma.event.findMany({
    where: {
      locationName: { not: null },
      // Event links to Source via RawEvent. Restrict to events where at least
      // one contributing RawEvent came from a GOOGLE_CALENDAR source.
      rawEvents: { some: { source: { type: "GOOGLE_CALENDAR" } } },
      OR: TEMPLATE_LABEL_PREFIXES.map((prefix) => ({
        locationName: { startsWith: prefix, mode: "insensitive" as const },
      })),
    },
    select: { id: true, kennelId: true, locationName: true, date: true, title: true },
  });

  const matches = events.filter(
    (e: Row) => e.locationName !== null && e.locationName.length < 40 && TEMPLATE_LABEL_RE.test(e.locationName),
  );

  console.log(`Scanned ${events.length} GOOGLE_CALENDAR-sourced events.`);
  console.log(`Found ${matches.length} with template-label locationName.`);
  for (const e of matches) {
    console.log(
      `  CLEAR  ${e.id}  date=${e.date.toISOString().slice(0, 10)}  title=${JSON.stringify(e.title)}  locationName=${JSON.stringify(e.locationName)}`,
    );
  }

  if (APPLY && matches.length > 0) {
    const result = await prisma.event.updateMany({
      where: { id: { in: matches.map((e: Row) => e.id) } },
      data: { locationName: null },
    });
    console.log(`\nCleared ${result.count} locationName values.`);
  } else if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to write changes.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
