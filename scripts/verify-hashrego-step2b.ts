/**
 * Live verification for HashRego Step 2b JSON fallback.
 *
 * Usage:
 *   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/verify-hashrego-step2b.ts
 *
 * Pulls the full set of eligible (MATCHED/LINKED/ADDED) KennelDiscovery slugs
 * — not just current SourceKennel rows, which may be stale — and runs the
 * adapter against the live hashrego.com JSON API at scale.
 *
 * Asserts:
 *   - kennelPagesStopReason is not "max_pages"
 *   - kennelPagesChecked > 10 (the old cap)
 *   - top-level errors[] stays empty (per-slug failures surface via errorDetails)
 *   - kennelPageEventsFound > 0 (the fallback path produced events)
 *   - events produced overall
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { HashRegoAdapter } from "@/adapters/hashrego/adapter";

/**
 * Resolve the HASHREGO source, pull every eligible KennelDiscovery slug,
 * run the adapter against the live API, and assert the fix invariants.
 */
async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  const source = await prisma.source.findFirst({ where: { type: "HASHREGO" } });
  if (!source) {
    console.error("No HASHREGO source");
    process.exit(1);
  }
  console.log(`Source: ${source.name} (${source.id})`);

  // Use ALL eligible discovery slugs, not just current SourceKennel rows.
  // This simulates post-merge scale even if the DB state has since drifted.
  const discoveries = await prisma.kennelDiscovery.findMany({
    where: {
      externalSource: "HASHREGO",
      matchedKennelId: { not: null },
      status: { in: ["MATCHED", "LINKED", "ADDED"] },
    },
    select: { externalSlug: true },
  });
  const slugs = Array.from(
    new Set(
      discoveries
        .map((d) => d.externalSlug)
        .filter((s): s is string => s !== null),
    ),
  );
  console.log(`Slugs under test (eligible discoveries): ${slugs.length}\n`);

  const hrAdapter = new HashRegoAdapter();
  const start = Date.now();
  const result = await hrAdapter.fetch(source, { kennelSlugs: slugs, days: 90 });
  const elapsed = Date.now() - start;

  console.log("=== HashRego live verification ===");
  console.log(`Wall clock:               ${elapsed} ms`);
  console.log(`Events produced:          ${result.events.length}`);
  console.log(`Errors (top-level):       ${result.errors.length}`);
  if (result.errors.length > 0) console.log(`  first: ${result.errors[0]}`);

  const dc = result.diagnosticContext as Record<string, unknown>;
  console.log(`totalIndexEntries:        ${dc?.totalIndexEntries}`);
  console.log(`matchingEntries:          ${dc?.matchingEntries}`);
  console.log(`kennelPagesChecked:       ${(dc?.kennelPagesChecked as string[])?.length}`);
  console.log(`kennelPageEventsFound:    ${dc?.kennelPageEventsFound}`);
  console.log(`kennelPageFetchErrors:    ${dc?.kennelPageFetchErrors}`);
  console.log(`kennelPagesSkipped:       ${dc?.kennelPagesSkipped}`);
  console.log(`kennelPagesStopReason:    ${dc?.kennelPagesStopReason}`);
  console.log(`fetchDurationMs:          ${dc?.fetchDurationMs}`);
  console.log(`errorDetails.fetch:       ${result.errorDetails?.fetch?.length ?? 0}`);
  console.log(`errorDetails.parse:       ${result.errorDetails?.parse?.length ?? 0}`);

  const sample = result.events[0];
  if (sample) {
    console.log("\nSample event:");
    console.log(`  date:      ${sample.date}`);
    console.log(`  kennelTag: ${sample.kennelTag}`);
    console.log(`  title:     ${sample.title}`);
    console.log(`  startTime: ${sample.startTime}`);
  }

  console.log("\n=== Assertions ===");
  const checked = (dc?.kennelPagesChecked as string[])?.length ?? 0;
  const stop = dc?.kennelPagesStopReason as string | null;
  const skipped = dc?.kennelPagesSkipped as number;
  const pageFetchErrors = dc?.kennelPageFetchErrors as number;
  const pageEventsFound = dc?.kennelPageEventsFound as number;
  const ok =
    result.events.length > 0 &&
    stop === null &&
    skipped === 0 &&
    result.errors.length === 0 &&
    checked > 10 &&
    pageEventsFound > 0 &&
    sample !== undefined &&
    !!sample.date &&
    !!sample.kennelTag;
  console.log(`eventsProduced > 0:              ${result.events.length > 0 ? "✅" : "❌"}`);
  console.log(`stopReason === null:             ${stop === null ? "✅" : `❌ (${stop})`}`);
  console.log(`kennelPagesSkipped === 0:        ${skipped === 0 ? "✅" : `❌ (${skipped})`}`);
  console.log(`top-level errors empty:          ${result.errors.length === 0 ? "✅" : "❌"}`);
  console.log(`kennelPagesChecked > 10:         ${checked > 10 ? `✅ (${checked})` : "❌"}`);
  console.log(`kennelPageEventsFound > 0:       ${pageEventsFound > 0 ? "✅" : "❌"}`);
  console.log(`sample has date + kennelTag:     ${sample && sample.date && sample.kennelTag ? "✅" : "❌"}`);
  console.log(`\n  (kennelPageFetchErrors: ${pageFetchErrors} — per-slug not_found is expected if the DB has drifted from the live API; check errorDetails.fetch[] for kinds)`);

  await pool.end();
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
