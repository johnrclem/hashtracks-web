/**
 * One-shot historical backfill for Boulder H3 (BH3 Boulder).
 *
 * Walks `/hashes/` pages 1–N of boulderh3.com and feeds every article
 * through the merge pipeline. Phase A's adapter only ingests page 1
 * within a 90-day window — the archive (~300 trails back to early
 * 2010s) lives on pages 2–20 and would never reach canonical Events
 * without this script.
 *
 * Reuses Phase A's exported parser (`parseBoulderH3IndexPage`), so the
 * backfill stays in sync with the live adapter on field extraction.
 *
 * Re-runnable: `reportAndApplyBackfill` routes through `processRawEvents`,
 * which dedupes by fingerprint on every row.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-bh3-co-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-bh3-co-history.ts
 *   Env:      BACKFILL_ALLOW_SELF_SIGNED_CERT=1 (Railway proxy)
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { reportAndApplyBackfill } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { parseBoulderH3IndexPage } from "@/adapters/html-scraper/boulder-h3";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Boulder H3 Website";
const KENNEL_TIMEZONE = "America/Denver";
const BASE_URL = "https://boulderh3.com/hashes/";
const MAX_PAGES = 30; // Safety cap; current archive is 20 pages.

async function fetchPage(page: number): Promise<string | null> {
  const url = page === 1 ? BASE_URL : `${BASE_URL}page/${page}/`;
  const res = await safeFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    console.warn(`  Page ${page}: HTTP ${res.status}, stopping`);
    return null;
  }
  return res.text();
}

async function fetchAllArchive(): Promise<RawEventData[]> {
  const all: RawEventData[] = [];
  let emptyStreak = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchPage(page);
    if (!html) break;
    const $ = cheerio.load(html);
    const articleCount = $("article.et_pb_post").length;
    const events = parseBoulderH3IndexPage($);
    if (articleCount > 0 && events.length === 0) {
      // Older archive posts use free-form prose ("When: Saturday, April 25th
      // @ 2:30") rather than the structured "WHEN: MM/DD/YYYY" the parser
      // expects. Logged for visibility; cleanup is out of scope for this
      // phase — would need Gemini-assisted parsing like the CFH3 archive.
      console.log(`  Page ${page}: ${articleCount} articles, 0 parsed (older free-form format — skipped)`);
    } else {
      console.log(`  Page ${page}: parsed ${events.length}/${articleCount} articles`);
    }
    if (articleCount === 0) {
      emptyStreak++;
      if (emptyStreak >= 2) {
        console.log("  Two consecutive empty pages — assuming end of archive.");
        break;
      }
    } else {
      emptyStreak = 0;
      all.push(...events);
    }
  }
  return all;
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  console.log("\n[1/2] Walking boulderh3.com/hashes/ archive...");
  const events = await fetchAllArchive();
  console.log(`  Total articles parsed: ${events.length}`);

  console.log("\n[2/2] Reporting + applying...");
  await reportAndApplyBackfill({
    apply,
    sourceName: SOURCE_NAME,
    events,
    kennelTimezone: KENNEL_TIMEZONE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
