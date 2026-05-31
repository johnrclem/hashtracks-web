/**
 * One-shot historical backfill for ONH3 (Original Nairobi H3, Nairobi, Kenya).
 *
 * Per `feedback_historical_backfill` memory: deep-dive history is loaded via a
 * one-shot DB script, not adapter parsing. The ONH3Adapter parses per-post run
 * announcements + the *future* rows of the current "Hareline YYYY" master table
 * (the live advance schedule the Google Calendar doesn't cover past ~4 weeks).
 * The *past* rows of those annual tables — the kennel's archive — are mapped
 * here once and inserted as RawEvents. No regex parser ships for this; the
 * dataset below was curated by reading the published Hareline tables/posts:
 *   - Hareline 2026 (rows before today): https://onh3.wordpress.com/2026/03/26/hareline-2026/
 *   - Hareline 2025 (full year):          https://onh3.wordpress.com/2026/03/26/hareline-2025/
 *   - Hareline 2020 (runs 1057–1068):     https://onh3.wordpress.com/2020/01/21/hareline-2020/
 * The 2020 list trails off into COVID-postponed "Available" placeholders from
 * run 1069 on — those never happened and are deliberately excluded.
 *
 * Partition (per `.claude/rules/adapter-patterns.md`):
 *   - Adapter handles dates >= today (Africa/Nairobi)
 *   - This script handles dates <  today
 * Never overlap. The WordPress source carries `upcomingOnly: true`, so
 * reconciliation only cancels stale *future* events and never these archives.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-onh3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-onh3-history.ts
 *   Env:     DATABASE_URL
 *
 * Idempotency: fingerprint-based dedup against existing RawEvents for this
 * source id — safe to re-run; only new rows insert.
 */

import "dotenv/config";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
import { googleMapsSearchUrl } from "@/adapters/utils";
import { composeVenueTitle } from "@/adapters/html-scraper/onh3";
import { generateFingerprint } from "@/pipeline/fingerprint";
import type { RawEventData } from "@/adapters/types";

const KENNEL_TAG = "onh3";
const SOURCE_NAME = "ONH3 WordPress Trail Posts";
const START_TIME = "17:45"; // 5:45 PM, per kennel convention
const KENNEL_TIMEZONE = "Africa/Nairobi";

interface HistoryRow {
  date: string; // YYYY-MM-DD
  runNumber: number;
  hares: string | null;
  venue: string | null;
  area: string | null;
}

// Curated archive (no parser): past runs from the published Hareline tables/posts.
const HISTORY: HistoryRow[] = [
  { date: "2020-01-06", runNumber: 1057, hares: "Shut the Fuck Up!", venue: "Tribe 44", area: "Spring Valley" },
  { date: "2020-01-13", runNumber: 1058, hares: "Electrical Erection", venue: "Hare's hole", area: "Lakeview" },
  { date: "2020-01-20", runNumber: 1059, hares: "Squat", venue: "Spring Valley Oven at Total Petrol station", area: null },
  { date: "2020-01-27", runNumber: 1060, hares: "Landmined", venue: "For You Restaurant", area: "Gitanga Road" },
  { date: "2020-02-03", runNumber: 1061, hares: "Mismanagement", venue: "Curry in Hurry", area: null },
  { date: "2020-02-10", runNumber: 1062, hares: "Pussy Power", venue: "Hare's hole", area: null },
  { date: "2020-02-17", runNumber: 1063, hares: "Squat & Sushi's Eco-Run", venue: "Planning House", area: null },
  { date: "2020-02-24", runNumber: 1064, hares: "Turbo Pharts & Blown Fuse", venue: "Thigiri Mall", area: null },
  { date: "2020-02-29", runNumber: 1065, hares: "Fuk Tard", venue: "Watamu Beach Run (Saturday)", area: null },
  { date: "2020-03-02", runNumber: 1066, hares: "Fishkiller", venue: "Hare's hole", area: "Loresho" },
  { date: "2020-03-09", runNumber: 1067, hares: "Pounder", venue: "Wasp & Sprout", area: "Loresho" },
  { date: "2020-03-16", runNumber: 1068, hares: "Dodger", venue: "Hare's Hole", area: null },
  { date: "2025-01-06", runNumber: 1264, hares: "Pounder and Holi Herpes", venue: "Spring Valley Oven", area: "Spring Valley" },
  { date: "2025-01-13", runNumber: 1265, hares: "Glossy?", venue: "The Venue", area: "Karen" },
  { date: "2025-01-20", runNumber: 1266, hares: "Maasai Disaster", venue: "Mama Ashanti", area: "Lavington" },
  { date: "2025-01-27", runNumber: 1267, hares: "Nom Nom and Peeping Clam", venue: "German Point", area: "Riviera Mall, Runda" },
  { date: "2025-02-03", runNumber: 1268, hares: "Weed Wacker & Electric Erection", venue: "Triple Two", area: "Loresho" },
  { date: "2025-02-10", runNumber: 1269, hares: "Pounder & PK (Red Run)", venue: "254 Racquet Club", area: "Loresho" },
  { date: "2025-02-17", runNumber: 1270, hares: "Willy Barrow & Barrow Banger", venue: "Mohinders", area: "Spring Valley" },
  { date: "2025-02-24", runNumber: 1271, hares: "Turbo Pharts and Blown Fuse", venue: "Josephine Restaurant", area: "Gigiri Courtyard" },
  { date: "2025-03-03", runNumber: 1272, hares: "Hurricane Knickers, Blow me Hard and Alcasleezer", venue: "Mardi Gras House, 623 Andrew Zagoritis Rd, Runda", area: null },
  { date: "2025-03-10", runNumber: 1273, hares: "Pounder & PK (Pre-Holi Run, dress code, white)", venue: "254 Racquet Club", area: "Loresho" },
  { date: "2025-03-17", runNumber: 1274, hares: "St Patrick’s Day – Just Maddie", venue: "Karoga & Kocktail", area: "General Mathenge" },
  { date: "2025-03-24", runNumber: 1275, hares: "Silent killer", venue: "Hare’s Hole", area: "Spring Valley Road" },
  { date: "2025-04-01", runNumber: 1276, hares: "Mismanagement Run", venue: "Minth Shack", area: "Peponi Road, Westlands" },
  { date: "2025-04-07", runNumber: 1277, hares: "Muddy Shaft and Alkasleazer", venue: "Hare’s Hole", area: "Runda" },
  { date: "2025-04-14", runNumber: 1278, hares: "Not Yet", venue: "Hare’s Hole", area: "Runda" },
  { date: "2025-04-22", runNumber: 1279, hares: "Blown Fuse and EE", venue: "Spring Valley Oven", area: "Lower Kabete Westlands" },
  { date: "2025-04-28", runNumber: 1280, hares: "Swaying P", venue: "Kengeles", area: "Lavington" },
  { date: "2025-05-05", runNumber: 1281, hares: "Laj Kuma", venue: "55 Woodvale Lane", area: "Runda (spa)" },
  { date: "2025-05-12", runNumber: 1282, hares: "Seven fucks", venue: "For you restaurant", area: "Lavington" },
  { date: "2025-05-19", runNumber: 1283, hares: "Bend Over Barbie", venue: "German Point, Rosslyn", area: "Runda" },
  { date: "2025-05-26", runNumber: 1284, hares: "Comatose and 369er", venue: "Rolling Stones", area: "Parklands Sports Club" },
  { date: "2025-06-03", runNumber: 1285, hares: "Cinderella", venue: "Spice Roots", area: "Simba Union Club, Parklands" },
  { date: "2025-06-09", runNumber: 1286, hares: "Mchuzi mix and Bumble Bitch", venue: "Red Ginger", area: "Parklands" },
  { date: "2025-06-16", runNumber: 1287, hares: "Nom Nom and Peeping Clam", venue: "Barrels & Stools", area: "Westlands" },
  { date: "2025-06-23", runNumber: 1288, hares: "Just Mike and Holiherpes", venue: "Kingfisher Hotel", area: "Westlands" },
  { date: "2025-06-30", runNumber: 1289, hares: "Muddy Shaft, Absolutely Clueless, Pounder", venue: "Hares Hole", area: "Runda" },
  { date: "2025-07-07", runNumber: 1290, hares: "Electric Erection & Bumfluff", venue: "Karoga & Kocktails", area: "Westlands (Gen Mathenge)" },
  { date: "2025-07-14", runNumber: 1291, hares: "Nut humper, Titscutter & Deadloss", venue: "Hares Hole (Deadloss)", area: "Runda" },
  { date: "2025-07-21", runNumber: 1292, hares: "Gliterious & Muff Diva", venue: "Espresso Cafe", area: "Kyuna Road (Dhiren’s Hairsalon)" },
  { date: "2025-07-28", runNumber: 1293, hares: "Chips Funga", venue: "Mohinders Corner", area: "Brookside road" },
  { date: "2025-08-04", runNumber: 1294, hares: "BF, Turbo and EE", venue: "Spring Valley Oven", area: "Lower Kabete Westlands" },
  { date: "2025-08-11", runNumber: 1295, hares: "Thumbs up", venue: "254 Racquet Club", area: "Loresho" },
  { date: "2025-08-18", runNumber: 1296, hares: "Pounder", venue: "Hare’s Hole", area: "Kyuna Crescent" },
  { date: "2025-08-25", runNumber: 1297, hares: "Beer slut", venue: "Hare’s Hole", area: "Runda" },
  { date: "2025-09-01", runNumber: 1298, hares: "Fire me & Back Door", venue: "Barrels & Stools", area: "Lower Kabete Westlands" },
  { date: "2025-09-08", runNumber: 1299, hares: "Salmonella & STFU", venue: "Hare’s Hole", area: "Kitisuru (Tate Close)" },
  { date: "2025-09-15", runNumber: 1300, hares: "1300th Run!! by Mismanagement", venue: "Dhiren’s Place", area: "Kyuna Road" },
  { date: "2025-09-22", runNumber: 1301, hares: "Honest Abe", venue: "Chi-Robi Pizza place, Rosslyn Riviera", area: "Runda" },
  { date: "2025-09-29", runNumber: 1302, hares: "Hurricane Knickers & Blow me Hard", venue: "Hare’s hole", area: "Runda" },
  { date: "2025-10-06", runNumber: 1303, hares: "Mad Cow Disease", venue: "Lily’s Ridgeways", area: "Kiambu" },
  { date: "2025-10-13", runNumber: 1304, hares: "MicroWhenSoft", venue: "Bavaria Gardens", area: "Westlands" },
  { date: "2025-10-21", runNumber: 1305, hares: "Tuesdsay Diwali Run by Mismanagement", venue: "Mint Shack", area: "General Mathenge" },
  { date: "2025-10-27", runNumber: 1306, hares: "Willy Wonka", venue: "Crafty Chameleon", area: "James Gichuru" },
  { date: "2025-11-03", runNumber: 1307, hares: "Pounder & PK (birthday run)", venue: "Hare’s hole", area: "Kyuna" },
  { date: "2025-11-10", runNumber: 1308, hares: "Comatose and Runaway Ghost", venue: "Hare’s hole", area: "Garden Estate" },
  { date: "2025-11-17", runNumber: 1309, hares: "First and second comer", venue: "German Point", area: "Rosslyn Riviera (Runda)" },
  { date: "2025-11-24", runNumber: 1310, hares: "Mchuzi and Turbo Pharts – Twins Birthday", venue: "Red Ginger", area: "Parklands" },
  { date: "2025-12-01", runNumber: 1311, hares: "Spread Eagle & STFU", venue: "Elkababgy Egyption Restaurant", area: "Parklands" },
  { date: "2025-12-08", runNumber: 1312, hares: "Deadloss and Titscutter", venue: "Hare’s hole", area: "Runda" },
  { date: "2025-12-15", runNumber: 1313, hares: "Mismanagement’s Christmas pub crawl & hymn singing", venue: "Bila Shaka", area: "Sarit Centre, Westlands" },
  { date: "2026-01-05", runNumber: 1314, hares: "STFU & Blown Fuse aka midnight owl", venue: "Spring Valley Oven", area: "Spring Valley" },
  { date: "2026-01-12", runNumber: 1315, hares: "Glossy", venue: "Matteo’s Italian Restaurant", area: "Karen" },
  { date: "2026-01-19", runNumber: 1316, hares: "Alkasleazer, Beer Slut, Shit Hands & Harakiri", venue: "Bavaria Gardens", area: "Westlands" },
  { date: "2026-01-26", runNumber: 1317, hares: "Seven(ty) fucks & Sonkulo", venue: "Suave Kitchen & Social Club", area: "Chiromo Road" },
  { date: "2026-02-02", runNumber: 1318, hares: "Turbo Pharts & Blown Fuse", venue: "Dhirens Spa", area: "Kyuna Road" },
  { date: "2026-02-09", runNumber: 1319, hares: "Moose Knuckles", venue: "Gigiri Courtyard", area: "Gigiri" },
  { date: "2026-02-16", runNumber: 1320, hares: "Thumbs up & Comatose", venue: "Kingfisher", area: "Westlands" },
  { date: "2026-02-23", runNumber: 1321, hares: "Gliterious and Sausage slicer", venue: "Gigiri Social – Padel Kenya", area: "Gigiri" },
  { date: "2026-03-02", runNumber: 1322, hares: "Alkasleazer and Muddy Shaft", venue: "Muddy Shaft’s hole", area: "Runda" },
  { date: "2026-03-09", runNumber: 1323, hares: "Containher & CantTameHim", venue: "Barrels & Stools", area: "Westlands" },
  { date: "2026-03-16", runNumber: 1324, hares: "Mismanagement run", venue: "Karoga & Kocktails", area: "General Mathenge" },
  { date: "2026-03-23", runNumber: 1325, hares: "Deadloss", venue: "Hare’s hole", area: "Runda" },
  { date: "2026-03-30", runNumber: 1326, hares: "Possibly Alkasleazer & EE??", venue: null, area: null },
  { date: "2026-04-06", runNumber: 1327, hares: null, venue: null, area: null },
  { date: "2026-04-13", runNumber: 1328, hares: "Bend over Barbie", venue: null, area: null },
  { date: "2026-04-20", runNumber: 1329, hares: null, venue: null, area: null },
  { date: "2026-04-27", runNumber: 1330, hares: "Dutch King’s Day (Glossy, EE & Weed Wacker)", venue: "Matteo’s Italian Restaurant", area: "Karen" },
  { date: "2026-05-04", runNumber: 1331, hares: "Heimscheißer", venue: null, area: null },
  { date: "2026-05-11", runNumber: 1332, hares: "7f", venue: null, area: null },
  { date: "2026-05-18", runNumber: 1333, hares: "First Comer and Second Coming", venue: null, area: "Gigiri" },
  { date: "2026-05-25", runNumber: 1334, hares: null, venue: null, area: null },
];

function rowToEvent(row: HistoryRow): RawEventData {
  const venueQuery = [row.venue, row.area].filter(Boolean).join(", ");
  return {
    date: row.date,
    kennelTags: [KENNEL_TAG],
    runNumber: row.runNumber,
    // Venue (+ area) title repaints the stale "ONH3 Trail #N" placeholder on
    // re-run via the merge UPDATE path (#1862); shares the adapter helper.
    title: composeVenueTitle(row.venue, row.area),
    hares: row.hares,
    location: row.venue,
    locationUrl: venueQuery ? googleMapsSearchUrl(`${venueQuery} Nairobi Kenya`) : undefined,
    startTime: START_TIME,
    sourceUrl: "https://onh3.wordpress.com/",
  };
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  // en-CA emits ISO YYYY-MM-DD; compute "today" in kennel-local time so the
  // adapter/backfill partition (adapter >= today, backfill < today) holds near
  // the UTC date boundary.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: KENNEL_TIMEZONE }).format(new Date());

  const events = HISTORY.filter((r) => r.date < today).map(rowToEvent);
  events.sort((a, b) => a.date.localeCompare(b.date));

  console.log(`Curated ${HISTORY.length} archive rows; ${events.length} are past (< ${today}).`);
  if (events.length === 0) {
    console.log("Nothing to insert. Exiting.");
    return;
  }
  console.log(`Date range: ${events[0].date} → ${events.at(-1)!.date}`);
  console.log("First 3:");
  for (const e of events.slice(0, 3)) console.log(`  #${e.runNumber} ${e.date} | ${e.hares ?? "-"} | ${e.location ?? "-"}`);
  console.log("Last 3:");
  for (const e of events.slice(-3)) console.log(`  #${e.runNumber} ${e.date} | ${e.hares ?? "-"} | ${e.location ?? "-"}`);

  if (!apply) {
    console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    return;
  }

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const sources = await prisma.source.findMany({ where: { name: SOURCE_NAME }, select: { id: true } });
    if (sources.length === 0) throw new Error(`Source "${SOURCE_NAME}" not found. Run prisma db seed first.`);
    if (sources.length > 1) throw new Error(`Multiple sources named "${SOURCE_NAME}" (${sources.length}). Aborting.`);
    const source = sources[0];

    const withFingerprints = events.map((event) => ({ event, fingerprint: generateFingerprint(event) }));
    const existing = await prisma.rawEvent.findMany({
      where: { sourceId: source.id, fingerprint: { in: withFingerprints.map((x) => x.fingerprint) } },
      select: { fingerprint: true },
    });
    const existingSet = new Set(existing.map((r) => r.fingerprint));
    const toInsert = withFingerprints.filter(({ fingerprint }) => !existingSet.has(fingerprint));
    console.log(`\nPre-existing rows: ${existingSet.size}. New rows to insert: ${toInsert.length}.`);
    if (toInsert.length === 0) {
      console.log("Nothing new to insert. Exiting.");
      return;
    }

    await prisma.rawEvent.createMany({
      data: toInsert.map(({ event, fingerprint }) => ({
        sourceId: source.id,
        rawData: event as unknown as Prisma.InputJsonValue,
        fingerprint,
        processed: false,
      })),
    });
    console.log(`\nDone. Inserted ${toInsert.length} new RawEvents for "${SOURCE_NAME}".`);
    console.log("Trigger a scrape of this source to merge them into canonical Events.");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
