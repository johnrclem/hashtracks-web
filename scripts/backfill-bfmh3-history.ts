/**
 * One-shot historical backfill for Bangkok Full Moon Hash (BFMH3).
 *
 * Per `feedback_historical_backfill` memory: the recurring BangkokHashAdapter
 * pulls only upcoming runs (the Joomla homepage "Next Run" article + the PHP
 * hareline API, both future-facing). This script scrapes the paginated Joomla
 * archive at `/fullmoon/index.php/run-archives-bfmh3` (5 pages × 15 items)
 * and inserts every visible historical run as a RawEvent.
 *
 * The archive exposes runs #187–#255 only (~65 runs after accounting for
 * gaps at #189 and #191 which were never published). Older runs pre-date
 * the current archive and would require a separate source (Wayback Machine,
 * kennel records) — out of scope for this script.
 *
 * Partition (per `.claude/rules/adapter-patterns.md`):
 *   - Adapter handles dates >= CURDATE()
 *   - This script handles dates < CURDATE()
 * Never overlap, always re-runnable.
 *
 * Usage:
 *   1. Dry run first:  npx tsx scripts/backfill-bfmh3-history.ts
 *   2. Execute:        BACKFILL_APPLY=1 npx tsx scripts/backfill-bfmh3-history.ts
 *
 * Idempotency: fingerprint-based dedup against existing RawEvents for this
 * source id, so re-running is safe and only inserts new rows.
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
import { parseNextRunArticle } from "@/adapters/html-scraper/bangkokhash";
import { safeFetch } from "@/adapters/safe-fetch";
import { generateFingerprint } from "@/pipeline/fingerprint";
import type { RawEventData } from "@/adapters/types";

const KENNEL_CODE = "bfmh3";
const SOURCE_NAME = "Bangkok Full Moon Hash";
const ARCHIVE_BASE = "https://www.bangkokhash.com/fullmoon/index.php/run-archives-bfmh3";
const ARCHIVE_ORIGIN = new URL(ARCHIVE_BASE).origin;
const ARCHIVE_PAGES = [0, 15, 30, 45, 60];
// Bangkok is UTC+7 — compute today's date in kennel-local time to keep the
// adapter/backfill partition correct near midnight UTC.
const KENNEL_TIMEZONE = "Asia/Bangkok";
const DEFAULT_START_TIME = "18:30";
const FETCH_DELAY_MS = 500;
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracksBackfill/1.0; +https://hashtracks.com)";
// Matches /run-archives-bfmh3/{articleId}-run-{runNumber}, filters out the
// stray /93-template index entry.
const DETAIL_URL_RE = /\/run-archives-bfmh3\/(\d+)-run-(\d+)$/;

interface IndexEntry {
  runNumber: number;
  detailUrl: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url: string): Promise<string> {
  const res = await safeFetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Fetch ${url} failed: HTTP ${res.status}`);
  }
  return res.text();
}

async function fetchArchiveIndex(): Promise<IndexEntry[]> {
  const seen = new Map<string, IndexEntry>();
  for (const [i, start] of ARCHIVE_PAGES.entries()) {
    const pageUrl = `${ARCHIVE_BASE}?start=${start}`;
    const html = await fetchText(pageUrl);
    const $ = cheerio.load(html);
    $("table.com-content-category__table tr th.list-title a").each((_i, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const match = DETAIL_URL_RE.exec(href);
      if (!match) return;
      const resolved = new URL(href, ARCHIVE_BASE);
      if (resolved.origin !== ARCHIVE_ORIGIN) return;
      const runNumber = Number.parseInt(match[2], 10);
      const detailUrl = resolved.toString();
      if (!seen.has(detailUrl)) {
        seen.set(detailUrl, { runNumber, detailUrl });
      }
    });
    if (i < ARCHIVE_PAGES.length - 1) await sleep(FETCH_DELAY_MS);
  }
  return [...seen.values()].sort((a, b) => a.runNumber - b.runNumber);
}

async function fetchDetailEvent(entry: IndexEntry): Promise<RawEventData | null> {
  const html = await fetchText(entry.detailUrl);
  const event = parseNextRunArticle(html, KENNEL_CODE, DEFAULT_START_TIME, entry.detailUrl);
  if (!event) return null;
  // Run # lives in the page header, not the article body — populate from the URL.
  event.runNumber = entry.runNumber;
  return event;
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Fetching archive index from ${ARCHIVE_BASE} …`);

  const entries = await fetchArchiveIndex();
  console.log(`Archive index contains ${entries.length} run entries (#${entries[0]?.runNumber ?? "?"} – #${entries.at(-1)?.runNumber ?? "?"})`);
  if (entries.length === 0) {
    console.log("No entries found. Exiting.");
    return;
  }

  // en-CA locale emits ISO YYYY-MM-DD which string-compares correctly against
  // RawEventData.date (also YYYY-MM-DD). UTC slicing would misclassify
  // early-morning Bangkok runs as "past" between 17:00–23:59 UTC.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: KENNEL_TIMEZONE }).format(new Date());
  const allEvents: RawEventData[] = [];
  const skipped: string[] = [];

  for (const [i, entry] of entries.entries()) {
    try {
      const event = await fetchDetailEvent(entry);
      if (!event) {
        skipped.push(`#${entry.runNumber}: parseNextRunArticle returned null (${entry.detailUrl})`);
      } else if (event.date >= today) {
        skipped.push(`#${entry.runNumber}: date ${event.date} >= today (${today}) — adapter territory`);
      } else {
        allEvents.push(event);
      }
    } catch (err) {
      skipped.push(`#${entry.runNumber}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (i < entries.length - 1) await sleep(FETCH_DELAY_MS);
  }

  console.log(`\nParsed ${allEvents.length} historical events (skipped ${skipped.length}).`);
  if (skipped.length > 0) {
    console.log("Skipped entries:");
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (allEvents.length === 0) {
    console.log("No events to insert. Exiting.");
    return;
  }

  allEvents.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`Date range: ${allEvents[0].date} → ${allEvents.at(-1)!.date}`);

  console.log("\nFirst 3 sample events:");
  for (const e of allEvents.slice(0, 3)) {
    console.log(`  #${e.runNumber} ${e.date} | hares=${e.hares ?? "-"} | loc=${e.location ?? "-"}`);
  }
  console.log("\nLast 3 sample events:");
  for (const e of allEvents.slice(-3)) {
    console.log(`  #${e.runNumber} ${e.date} | hares=${e.hares ?? "-"} | loc=${e.location ?? "-"}`);
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    return;
  }

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const sources = await prisma.source.findMany({
      where: { name: SOURCE_NAME },
      select: { id: true },
    });
    if (sources.length === 0) throw new Error(`Source "${SOURCE_NAME}" not found in DB. Run prisma db seed first.`);
    if (sources.length > 1) throw new Error(`Multiple sources named "${SOURCE_NAME}" found (${sources.length}). Aborting to avoid writing to the wrong one.`);
    const source = sources[0];

    const withFingerprints = allEvents.map((event) => ({
      event,
      fingerprint: generateFingerprint(event),
    }));
    const fingerprintList = withFingerprints.map((x) => x.fingerprint);
    const existingRows = await prisma.rawEvent.findMany({
      where: { sourceId: source.id, fingerprint: { in: fingerprintList } },
      select: { fingerprint: true },
    });
    const existingSet = new Set(existingRows.map((r) => r.fingerprint));
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

    console.log(`\nDone. Inserted ${toInsert.length} new RawEvents for source "${SOURCE_NAME}".`);
    console.log("Trigger a scrape of this source from the admin UI to merge the new RawEvents into canonical Events.");
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
