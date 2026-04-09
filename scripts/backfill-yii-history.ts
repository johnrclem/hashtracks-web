/**
 * One-shot historical backfill for any Yii GridView hareline kennel.
 *
 * Parameterized via the `YII_BACKFILL_PRESET` env var so the same script
 * covers every Yii-hosted hash kennel HashTracks onboards. The recurring
 * `YiiHarelineAdapter` fetches only the last few pages on each run; this
 * script walks every page and inserts every historical RawEvent in one
 * shot.
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
 *   # PH3 dry run:
 *   set -a && source .env && set +a
 *   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 YII_BACKFILL_PRESET=ph3 npx tsx scripts/backfill-yii-history.ts
 *
 *   # KL Full Moon apply:
 *   BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 YII_BACKFILL_PRESET=klfm npx tsx scripts/backfill-yii-history.ts
 *
 *   # Add a new preset by extending the PRESETS map below.
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

interface YiiBackfillPreset {
  baseUrl: string;
  sourceName: string;
  config: YiiHarelineConfig;
}

const PRESETS: Record<string, YiiBackfillPreset> = {
  ph3: {
    baseUrl: "https://ph3.org/index.php?r=site/hareline",
    sourceName: "Petaling H3 Hareline",
    config: { kennelTag: "ph3-my", startTime: "16:00" },
  },
  klfm: {
    baseUrl: "https://klfullmoonhash.com/index.php?r=site/hareline",
    sourceName: "KL Full Moon H3 Hareline",
    config: { kennelTag: "klfmh3", startTime: "18:00" },
  },
};

const presetKey = process.env.YII_BACKFILL_PRESET;
if (!presetKey || !PRESETS[presetKey]) {
  console.error(
    `YII_BACKFILL_PRESET is required. Available presets: ${Object.keys(PRESETS).join(", ")}`,
  );
  process.exit(1);
}
const { baseUrl: BASE_URL, sourceName: SOURCE_NAME, config: CONFIG } = PRESETS[presetKey];

/**
 * Fetch a single Yii hareline page and return both the parsed events AND
 * the raw HTML — the caller needs the HTML of page 1 to extract the
 * pagination max.
 */
async function fetchPage(
  pageNum: number,
): Promise<{ events: RawEventData[]; html: string }> {
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
  return { events: parseYiiHarelinePage($, CONFIG, BASE_URL), html };
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Fetching ${BASE_URL} page 1 to discover pagination …`);

  const { events: page1Events, html: page1Html } = await fetchPage(1);
  const maxPage = extractMaxYiiPage(page1Html);
  console.log(`Discovered maxPage = ${maxPage} (page 1 has ${page1Events.length} events)`);

  const allEvents: RawEventData[] = [...page1Events];
  for (let p = 2; p <= maxPage; p++) {
    const { events } = await fetchPage(p);
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

  try {
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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
