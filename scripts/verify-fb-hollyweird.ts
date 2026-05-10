/**
 * Live verification helper for #1319 — confirms the FACEBOOK_HOSTED_EVENTS
 * adapter populates runNumber/hares/locationStreet for Hollyweird upcoming
 * events against the live FB Page. One-shot script; not registered in package.json.
 *
 * Usage: `tsx scripts/verify-fb-hollyweird.ts`
 */
import "dotenv/config";
import { FacebookHostedEventsAdapter } from "@/adapters/facebook-hosted-events/adapter";
import type { Source } from "@/generated/prisma/client";

const source = {
  id: "verify-h6",
  name: "Hollyweird FB hosted_events (verify)",
  url: "https://www.facebook.com/HollyweirdH6/upcoming_hosted_events",
  type: "FACEBOOK_HOSTED_EVENTS",
  enabled: true,
  trustLevel: 8,
  scrapeFreq: "daily",
  scrapeDays: 90,
  config: {
    kennelTag: "h6",
    pageHandle: "HollyweirdH6",
    timezone: "America/New_York",
    upcomingOnly: true,
  },
  lastScrapeAt: null,
  lastSuccessAt: null,
  baselineResetAt: null,
  healthStatus: "UNKNOWN",
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Source;

async function main() {
  const adapter = new FacebookHostedEventsAdapter();
  const result = await adapter.fetch(source, { days: 365 });

  console.log("\n=== Hollyweird FB hosted_events live verify ===");
  console.log(`Errors: ${JSON.stringify(result.errors, null, 2)}`);
  console.log(
    `Diagnostic: ${JSON.stringify(result.diagnosticContext, null, 2)}`,
  );
  console.log(`Total events: ${result.events.length}\n`);

  for (const e of result.events) {
    console.log("---");
    console.log(`title:          ${e.title}`);
    console.log(`date:           ${e.date}  startTime: ${e.startTime}`);
    console.log(`runNumber:      ${e.runNumber === undefined ? "undefined" : JSON.stringify(e.runNumber)}`);
    console.log(`location:       ${e.location ?? "(none)"}`);
    console.log(`locationStreet: ${e.locationStreet ?? "(none)"}`);
    console.log(`hares:          ${e.hares ?? "(none)"}`);
    console.log(`sourceUrl:      ${e.sourceUrl}`);
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
