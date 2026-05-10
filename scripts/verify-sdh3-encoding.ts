/**
 * Live verification for SDH3 adapter (issues #1315 + #1316).
 *
 * Hits sdh3.com/hareline.shtml end-to-end and prints HAH3 events with the
 * new discrete fields, plus a sanity check that the 🌮 emoji decodes to
 * the literal taco rather than the "ðŸŒ®" mojibake from the old text() path.
 *
 * Usage: npx tsx scripts/verify-sdh3-encoding.ts
 */

import "dotenv/config";
import { SDH3Adapter } from "@/adapters/html-scraper/sdh3";
import type { Source } from "@/generated/prisma/client";

const source = {
  id: "verify-sdh3",
  name: "SDH3 Hareline (verify)",
  url: "https://sdh3.com/hareline.shtml",
  type: "HTML_SCRAPER",
  trustLevel: 8,
  scrapeFreq: "manual",
  scrapeDays: 90,
  enabled: true,
  config: {
    kennelCodeMap: {
      SDH3: "sdh3", CLH3: "clh3-sd", LJH3: "ljh3", NCH3: "nch3-sd",
      IRH3: "irh3-sd", H4: "humpin-sd", FMH3: "fmh3-sd", HAH3: "hah3-sd",
      MH4: "mh4-sd", DRH3: "drh3-sd",
    },
    kennelNameMap: {
      "San Diego": "sdh3", Larrikins: "clh3-sd", "La Jolla": "ljh3",
      "North County": "nch3-sd", "Iron Rule": "irh3-sd", Humpin: "humpin-sd",
      "Full Moon": "fmh3-sd", "Half-Assed": "hah3-sd",
      "Mission Harriettes": "mh4-sd", "Diaper Rash": "drh3-sd",
    },
    includeHistory: false,
  },
} as unknown as Source;

async function main() {
  const adapter = new SDH3Adapter();
  const result = await adapter.fetch(source, { days: 365 });

  console.log(`Total events: ${result.events.length}`);
  const byKennel: Record<string, number> = {};
  for (const e of result.events) {
    const k = e.kennelTags[0] ?? "?";
    byKennel[k] = (byKennel[k] ?? 0) + 1;
  }
  console.log("By kennel:", byKennel);
  console.log(`Errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.log("First 3 errors:", result.errors.slice(0, 3));
  }

  const hahEvents = result.events.filter((e) => e.kennelTags[0] === "hah3-sd");
  console.log(`\nHAH3 events (${hahEvents.length}):`);
  for (const e of hahEvents) {
  console.log(`\n  ${e.date} ${e.startTime ?? ""}  "${e.title ?? ""}"`);
  console.log(`    cost=${JSON.stringify(e.cost)}`);
  console.log(`    trailType=${JSON.stringify(e.trailType)}`);
  console.log(`    dogFriendly=${JSON.stringify(e.dogFriendly)}`);
  console.log(`    prelube=${JSON.stringify(e.prelube)}`);
  console.log(`    hares=${JSON.stringify(e.hares)}`);
  if (e.description) {
    const containsMojibake = /ðŸ|Â|Ã©|Ã¨|Ã¯/.test(e.description);
    const containsTacos = /🌮/.test(e.description);
    const truncated = e.description.length > 120 ? e.description.slice(0, 120) + "…" : e.description;
    console.log(`    description=${JSON.stringify(truncated)}`);
    if (containsMojibake) console.log("    ⚠️  description contains mojibake markers!");
    if (containsTacos) console.log("    ✅ description contains literal 🌮");
    // #1316 regression check
    if (/Hash Cash:|Trail:\s|Dog Friendly:|Pre-lube:/.test(e.description)) {
      console.log("    ❌ description still contains label-prefixed smashed fields");
    }
  }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
