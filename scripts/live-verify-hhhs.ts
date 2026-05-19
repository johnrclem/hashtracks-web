/**
 * Live verification for the HHHS Hareline HTML_SCRAPER adapter (#1474).
 *
 * Runs the actual HHHSAdapter against https://www.hhhs.org.sg/hareline via the
 * NAS browser-render service, prints a summary of parsed events, and asserts
 * that:
 *   - the scrape returns ≥1 event
 *   - rich data flows through (runNumber, hares, location, title from Notes)
 *   - dispatch goes through HHHSAdapter (diagnosticContext.adapter)
 *
 * Run: `set -a && source .env && set +a && npx tsx scripts/live-verify-hhhs.ts`
 *
 * Requires BROWSER_RENDER_URL + BROWSER_RENDER_KEY in the environment.
 * Does NOT touch the database — purely an upstream-fetch + parse smoke test.
 */
import "dotenv/config";
import { getAdapter } from "@/adapters/registry";
import type { Source } from "@/generated/prisma/client";

const SOURCE_URL = "https://www.hhhs.org.sg/hareline";

async function main() {
  if (!process.env.BROWSER_RENDER_URL || !process.env.BROWSER_RENDER_KEY) {
    console.error(
      "✗ BROWSER_RENDER_URL / BROWSER_RENDER_KEY not set; cannot reach the NAS browser-render service.",
    );
    console.error("  Source .env first: set -a && source .env && set +a");
    process.exit(1);
  }

  const adapter = getAdapter("HTML_SCRAPER", SOURCE_URL);
  console.log(`Adapter dispatch: ${adapter.constructor.name}`);
  if (adapter.constructor.name !== "HHHSAdapter") {
    console.error(`✗ Expected HHHSAdapter, got ${adapter.constructor.name}`);
    process.exit(1);
  }
  console.log("✓ Registry resolves https://www.hhhs.org.sg/hareline → HHHSAdapter");

  const source = {
    id: "live-verify-hhhs",
    url: SOURCE_URL,
    type: "HTML_SCRAPER",
  } as unknown as Source;

  console.log(`\nFetching ${SOURCE_URL} via browser-render…`);
  const result = await adapter.fetch(source, { days: 365 });

  console.log(`\n── Result summary ──`);
  console.log(`  events: ${result.events.length}`);
  console.log(`  errors: ${JSON.stringify(result.errors)}`);
  console.log(`  diagnosticContext: ${JSON.stringify(result.diagnosticContext)}`);

  if (result.events.length === 0) {
    console.error("\n✗ No events returned — fetch or parse failed");
    process.exit(1);
  }

  const sorted = [...result.events].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted.at(-1)!;
  console.log(`\n── Date range ──`);
  console.log(`  ${first.date} → ${last.date}`);

  console.log(`\n── First 3 events ──`);
  for (const ev of sorted.slice(0, 3)) {
    console.log(`  #${ev.runNumber ?? "?"} ${ev.date} @ ${ev.startTime ?? "?"}`);
    console.log(`    title:    ${ev.title ?? "(none)"}`);
    console.log(`    hares:    ${ev.hares ?? "(none)"}`);
    console.log(`    location: ${ev.location ?? "(none)"}`);
  }

  const withRich = result.events.filter(
    (e) => e.runNumber !== undefined && e.hares && e.location,
  );
  console.log(`\n── Rich-data coverage ──`);
  console.log(`  events with runNumber + hares + location: ${withRich.length}/${result.events.length}`);

  if (withRich.length === 0) {
    console.error("\n✗ Zero events carry the rich fields — adapter is shipping placeholders");
    process.exit(1);
  }

  console.log("\n✓ Live verification passed");
}

main().catch((err) => {
  console.error("✗ Live verification crashed:", err);
  process.exit(1);
});
