/**
 * Live verification harness for the DFW adapter (issues #1151 + #1155).
 *
 * Runs DFWHashAdapter.fetch() against the live dfwhhh.org calendar and prints:
 *   - event count + date range
 *   - count of events with description / cost populated
 *   - one fully-populated sample event
 *
 * Usage: npx tsx scripts/verify-dfw-adapter.ts
 */

import "dotenv/config";
import { DFWHashAdapter } from "@/adapters/html-scraper/dfw-hash";

async function main() {
  const adapter = new DFWHashAdapter();
  const source = {
    id: "live-verify",
    url: "http://www.dfwhhh.org/calendar/", // NOSONAR — source has expired SSL
  };

  const result = await adapter.fetch(source as never);

  const dates = result.events.map((e) => e.date).sort((a, b) => a.localeCompare(b));
  const withDescription = result.events.filter((e) => e.description);
  const withCost = result.events.filter((e) => e.cost);
  const withRunNumber = result.events.filter((e) => e.runNumber !== undefined);

  console.log(`\n=== DFW Live Verification ===\n`);
  console.log(`Events parsed: ${result.events.length}`);
  console.log(`Date range:    ${dates[0] ?? "n/a"} → ${dates.at(-1) ?? "n/a"}`);
  console.log(`With description: ${withDescription.length}`);
  console.log(`With cost:        ${withCost.length}`);
  console.log(`With runNumber:   ${withRunNumber.length}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Diagnostic:`, result.diagnosticContext);

  if (result.errors.length) {
    console.log(`\nFirst 3 errors:`);
    result.errors.slice(0, 3).forEach((e) => {
      console.log(`  - ${e}`);
    });
  }

  const sample = result.events.find((e) => e.description && e.cost) ?? result.events[0];
  if (sample) {
    console.log(`\n=== Sample event ===\n${JSON.stringify(sample, null, 2)}`);
  }

  // Per-kennel breakdown
  const byKennel = new Map<string, number>();
  for (const e of result.events) {
    for (const tag of e.kennelTags ?? []) {
      byKennel.set(tag, (byKennel.get(tag) ?? 0) + 1);
    }
  }
  console.log(`\n=== Events per kennel ===`);
  for (const [tag, n] of [...byKennel.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${tag}: ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
