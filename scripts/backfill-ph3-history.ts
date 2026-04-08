/**
 * One-shot historical backfill for Petaling H3 (PH3, Malaysia).
 *
 * Petaling H3 publishes its full hareline (1,160+ runs back to 2003) at
 * https://ph3.org/index.php?r=site/hareline as a paginated Yii GridView.
 * The recurring YiiHarelineAdapter fetches only the LAST page (most recent
 * runs); this script walks every page and inserts every historical
 * RawEvent in one shot.
 *
 * **Idempotency + strict partitioning:** this script only inserts rows
 * where `date < <cutoff>`, and the recurring adapter's date-window filter
 * only admits rows within `±scrapeDays`. With cutoff = today - 30 days and
 * scrapeDays ≥ 180, the two windows overlap by ~150 days — so the
 * fingerprint dedup in the recurring adapter's merge pipeline naturally
 * handles overlap, AND this script's `findMany`+filter step dedupes
 * against any RawEvents already in the DB for the same source.
 *
 * Usage:
 *   1. Dry run first:  npx tsx scripts/backfill-ph3-history.ts
 *   2. Execute:        BACKFILL_APPLY=1 npx tsx scripts/backfill-ph3-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
import {
  buildYiiPageUrl,
  extractMaxYiiPage,
  parseYiiHarelinePage,
  type YiiHarelineConfig,
} from "@/adapters/html-scraper/yii-hareline";
import { safeFetch } from "@/adapters/safe-fetch";
import { generateFingerprint } from "@/pipeline/fingerprint";
import type { RawEventData } from "@/adapters/types";

const BASE_URL = "https://ph3.org/index.php?r=site/hareline";
const SOURCE_NAME = "Petaling H3 Hareline";
const CONFIG: YiiHarelineConfig = {
  kennelTag: "ph3-my",
  startTime: "16:00",
};

/** Fetch a single Yii hareline page and return parsed events. */
async function fetchPage(pageNum: number): Promise<RawEventData[]> {
  const url = buildYiiPageUrl(BASE_URL, pageNum);
  const res = await safeFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
  });
  if (!res.ok) {
    throw new Error(`Page ${pageNum}: HTTP ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  // Pass the canonical base URL (not the per-page URL) so fingerprints
  // stay stable across backfill and recurring scrapes — the recurring
  // adapter always uses the canonical URL. `generateFingerprint()` hashes
  // `sourceUrl`, so a `?page=N` mismatch would produce a different
  // fingerprint for the same event.
  return parseYiiHarelinePage($, CONFIG, BASE_URL);
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Fetching ${BASE_URL} page 1 to discover pagination …`);

  const page1Events = await fetchPage(1);
  const page1Html = await (
    await safeFetch(BASE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
    })
  ).text();
  const maxPage = extractMaxYiiPage(page1Html);
  console.log(`Discovered maxPage = ${maxPage} (page 1 has ${page1Events.length} events)`);

  const allEvents: RawEventData[] = [...page1Events];
  for (let p = 2; p <= maxPage; p++) {
    const events = await fetchPage(p);
    allEvents.push(...events);
    if (p % 10 === 0 || p === maxPage) {
      console.log(`  page ${p}/${maxPage}: +${events.length} events (total ${allEvents.length})`);
    }
  }

  // Dedupe in-memory by (runNumber|date) — page tails can overlap if the
  // kennel added a row between page-1 discovery and later fetches.
  const seen = new Set<string>();
  const unique: RawEventData[] = [];
  for (const e of allEvents) {
    const key = `${e.runNumber ?? ""}|${e.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  unique.sort((a, b) => a.date.localeCompare(b.date));

  console.log(`\nTotal unique events: ${unique.length}`);
  if (unique.length === 0) {
    console.log("No events to insert. Exiting.");
    return;
  }
  console.log(`Date range: ${unique[0].date} → ${unique.at(-1)!.date}`);

  // Strict date partition: the recurring adapter handles recent runs, so we
  // only backfill everything older than the cutoff. With scrapeDays = 180,
  // a 30-day cutoff leaves a ~150-day overlap that's safely deduped by the
  // fingerprint check below.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const historical = unique.filter((e) => e.date < cutoff);
  console.log(`Historical rows (date < ${cutoff}): ${historical.length}`);

  console.log("\nFirst 3 sample events:");
  for (const e of historical.slice(0, 3)) {
    console.log(`  #${e.runNumber} ${e.date} | ${e.hares ?? "(no hare)"} | ${e.location ?? "-"}`);
  }
  console.log("Last 3 sample events:");
  for (const e of historical.slice(-3)) {
    console.log(`  #${e.runNumber} ${e.date} | ${e.hares ?? "(no hare)"} | ${e.location ?? "-"}`);
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    return;
  }

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME } });
  if (!source) {
    throw new Error(`Source "${SOURCE_NAME}" not found in DB. Run prisma db seed first.`);
  }

  const fingerprinted = historical.map((event) => ({
    event,
    fingerprint: generateFingerprint(event),
  }));
  const fingerprints = fingerprinted.map((x) => x.fingerprint);

  const existing = await prisma.rawEvent.findMany({
    where: { sourceId: source.id, fingerprint: { in: fingerprints } },
    select: { fingerprint: true },
  });
  const existingSet = new Set(existing.map((r) => r.fingerprint));
  const toInsert = fingerprinted.filter(({ fingerprint }) => !existingSet.has(fingerprint));
  console.log(`\nPre-existing rows: ${existingSet.size}. New rows to insert: ${toInsert.length}.`);

  if (toInsert.length === 0) {
    console.log("Nothing new to insert. Exiting.");
    await prisma.$disconnect();
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

  console.log(`\nDone. Inserted ${toInsert.length} new RawEvents from ${BASE_URL}.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
