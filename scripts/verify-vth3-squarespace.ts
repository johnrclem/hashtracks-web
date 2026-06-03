/**
 * One-shot live verification for the VTH3 Squarespace source (#1941).
 * Runs the shared SquarespaceEventsAdapter against the live vontramph3.com
 * hareline and asserts the parse is sane. Not part of CI — run manually:
 *   eval "$(fnm env)" && fnm use 20 && npx tsx scripts/verify-vth3-squarespace.ts
 */
import "dotenv/config";
import type { Source } from "@/generated/prisma/client";
import { SquarespaceEventsAdapter } from "@/adapters/html-scraper/squarespace-events";

const source = {
  id: "verify-vth3",
  name: "Von Tramp H3 Squarespace Events",
  url: "https://www.vontramph3.com",
  type: "HTML_SCRAPER",
  config: { kennelTag: "vth3", collectionPath: "/hareline" },
  trustLevel: 9,
  scrapeFreq: "daily",
  scrapeDays: 3650,
  enabled: true,
} as unknown as Source;

async function main() {
  const adapter = new SquarespaceEventsAdapter();
  const result = await adapter.fetch(source, { days: 3650 });

  const { events, errors, diagnosticContext } = result;
  console.log("errors:", errors);
  console.log("diagnosticContext:", JSON.stringify(diagnosticContext, null, 2));
  console.log("event count:", events.length);

  const dates = events.map((e) => e.date).sort((a, b) => a.localeCompare(b));
  console.log("date range:", dates[0], "→", dates[dates.length - 1]);
  // Event dates are local to the site timezone (America/New_York). Compute
  // "today" in that same zone — a UTC `toISOString().slice(0,10)` rolls over
  // after ~8pm ET and would misclassify tonight's run as past, spuriously
  // failing the future-event assertion.
  const todayYmd = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const future = events.filter((e) => e.date >= todayYmd);
  console.log("future events:", future.length);

  const withRun = events.filter((e) => typeof e.runNumber === "number");
  console.log("events with runNumber:", withRun.length);

  const sample = future.sort((a, b) => a.date.localeCompare(b.date))[0] ?? events[0];
  console.log("\nsample (soonest upcoming):", JSON.stringify(sample, null, 2));

  // Assertions
  const fails: string[] = [];
  if (errors.length) fails.push(`unexpected errors: ${errors.join("; ")}`);
  if (events.length < 100) fails.push(`expected ~113 events, got ${events.length}`);
  if (!events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)))
    fails.push("some dates are not YYYY-MM-DD");
  if (future.length < 1) fails.push("no future events");
  if (withRun.length < events.length * 0.8)
    fails.push(`too few runNumbers: ${withRun.length}/${events.length}`);
  // Coords: at least one event should carry the real Burlington pin, not the
  // Manhattan tenant-default (40.7207559) which extractVenueCoords must reject.
  const burlington = events.filter(
    (e) => typeof e.latitude === "number" && e.latitude > 44 && e.latitude < 45,
  );
  if (burlington.length < 1) fails.push("no events with Burlington coords (~44.x)");
  const manhattanLeak = events.filter(
    (e) => typeof e.latitude === "number" && Math.abs(e.latitude - 40.7207559) < 1e-4,
  );
  if (manhattanLeak.length > 0)
    fails.push(`${manhattanLeak.length} events leaked Manhattan default coords`);

  if (fails.length) {
    console.error("\n❌ VERIFICATION FAILED:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\n✅ VTH3 Squarespace verification passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
