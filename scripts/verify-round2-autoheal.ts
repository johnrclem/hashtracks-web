/**
 * Quick check: do the PR #805 fixes auto-heal issues #799, #803, #804?
 * Runs each adapter in-memory against its production URL and greps for the
 * reported-bad substring in the relevant field of the sample event.
 *
 *   #799 Pedal Files — title should NOT end with " -" or " - tbd"
 *   #803 BAH3        — hares should NOT contain "2406185563" (phone)
 *   #804 SWH3        — locationName should NOT contain "text ... for address"
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { getAdapter } from "../src/adapters/registry";

async function runOne(sourceName: string) {
  const source = await prisma.source.findFirst({ where: { name: sourceName } });
  if (!source) throw new Error(`source not found: ${sourceName}`);
  const adapter = getAdapter(source.type);
  const result = await adapter.fetch(source, { days: 180 });
  return { source, events: result.events, errors: result.errors };
}

function sample(events: { title?: string; hares?: string; location?: string; sourceUrl?: string; runNumber?: number }[], pred: (e: { title?: string; hares?: string; location?: string }) => boolean) {
  return events.filter(pred).slice(0, 3);
}

async function main() {
  let failed = false;

  // #799 Pedal Files
  console.log("\n=== #799 Pedal Files ===");
  const pedal = await runOne("Pedal Files Bash Google Calendar");
  console.log(`events=${pedal.events.length} errors=${pedal.errors.length}`);
  const dashArtifacts = sample(pedal.events, e => !!e.title && /\s-\s*(?:tbd)?\s*$/i.test(e.title));
  console.log(`trailing-dash titles:`, dashArtifacts.length, dashArtifacts.map(e => e.title));
  failed ||= dashArtifacts.length > 0;

  // #803 BAH3 — calendar is the Baltimore/Annapolis Hash, phone "2406185563"
  console.log("\n=== #803 BAH3 ===");
  const bah3 = await runOne("BAH3 iCal Feed");
  console.log(`events=${bah3.events.length} errors=${bah3.errors.length}`);
  const phoneHares = sample(bah3.events, e => !!e.hares && /\b2406185563\b/.test(e.hares));
  console.log(`phone-in-hares:`, phoneHares.length, phoneHares.map(e => ({ hares: e.hares, runNumber: e.runNumber })));
  failed ||= phoneHares.length > 0;
  const allHares = bah3.events.filter(e => !!e.hares).slice(0, 5);
  console.log(`sample hares:`, allHares.map(e => e.hares));

  // #804 SWH3
  console.log("\n=== #804 SWH3 ===");
  const swh3 = await runOne("SWH3 Google Calendar");
  console.log(`events=${swh3.events.length} errors=${swh3.errors.length}`);
  const ctaLocs = sample(swh3.events, e => !!e.location && /\btext\b.*\bfor\s+address\b/i.test(e.location));
  console.log(`cta-locations:`, ctaLocs.length, ctaLocs.map(e => e.location));
  failed ||= ctaLocs.length > 0;
  const sampleLocs = swh3.events.filter(e => !!e.location).slice(0, 5);
  console.log(`sample locations:`, sampleLocs.map(e => e.location));

  await prisma.$disconnect();
  if (failed) process.exit(1);
}

main().catch(async err => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
