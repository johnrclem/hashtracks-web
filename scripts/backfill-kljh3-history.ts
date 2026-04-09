/**
 * One-shot historical backfill for KL Junior H3 (Malaysia).
 *
 * KLJ H3 publishes runs as WordPress posts at www.kljhhh.org. The recurring
 * KljH3Adapter fetches only the latest 20 posts; this script walks every WP
 * page via `/wp-json/wp/v2/posts?per_page=100&page=N` and ingests all
 * historical run announcements in one shot.
 *
 * **Idempotency + strict partitioning:** this script only inserts rows
 * where `date < <cutoff>`, and the recurring adapter's ±scrapeDays window
 * handles the rest. The pre-insert `findMany`+filter step dedupes against
 * any RawEvents already in the DB for the same source.
 *
 * Shared logic: the post→event transform is `parseKljPost()` exported from
 * `src/adapters/html-scraper/klj-h3.ts` so this script and the recurring
 * adapter agree on run-number regex, default start time, and field mapping.
 *
 * Usage:
 *   Dry run:  set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-kljh3-history.ts
 *   Execute:  BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-kljh3-history.ts
 */

import "dotenv/config";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
import { decodeEntities } from "@/adapters/utils";
import { parseKljPost } from "@/adapters/html-scraper/klj-h3";
import { safeFetch } from "@/adapters/safe-fetch";
import { generateFingerprint } from "@/pipeline/fingerprint";
import type { RawEventData } from "@/adapters/types";

const BASE_URL = "https://www.kljhhh.org";
const SOURCE_NAME = "KL Junior H3 Website";
const PER_PAGE = 100;

interface WpRawPost {
  title: { rendered: string };
  content: { rendered: string };
  link: string;
  date: string;
}

async function fetchAllPosts(): Promise<WpRawPost[]> {
  const posts: WpRawPost[] = [];
  for (let page = 1; page <= 50; page++) {
    const url = `${BASE_URL}/wp-json/wp/v2/posts?per_page=${PER_PAGE}&page=${page}&_fields=title,content,link,date`;
    const res = await safeFetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "HashTracks-Backfill/1.0",
      },
    });
    if (res.status === 400) break; // WP returns 400 when page > totalPages
    if (!res.ok) throw new Error(`Page ${page}: HTTP ${res.status}`);
    // Runtime shape check — don't trust `as T[]` assertions. A WP install
    // that returns an error envelope (e.g. `{code:"rest_no_route",...}`)
    // would otherwise silently coerce to `undefined` and break downstream.
    const batch: unknown = await res.json();
    if (!Array.isArray(batch)) {
      throw new Error(`Page ${page}: expected JSON array, got ${typeof batch}`);
    }
    if (batch.length === 0) break;
    posts.push(...(batch as WpRawPost[]));
    if (batch.length < PER_PAGE) break;
  }
  return posts;
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Fetching all WordPress posts from ${BASE_URL}/wp-json/wp/v2/posts …`);

  const posts = await fetchAllPosts();
  console.log(`Fetched ${posts.length} total posts.`);

  const events: RawEventData[] = [];
  let nonRun = 0;
  let noDate = 0;
  for (const post of posts) {
    const result = parseKljPost({
      title: decodeEntities(post.title.rendered),
      content: post.content.rendered,
      url: post.link,
      date: post.date,
    });
    if (result.ok) {
      events.push(result.event);
    } else if (result.reason === "not-run-post") {
      nonRun++;
    } else {
      noDate++;
    }
  }

  // Dedupe by (runNumber|date) in case WP pagination returns dupes.
  const seen = new Set<string>();
  const unique: RawEventData[] = [];
  for (const e of events) {
    const key = `${e.runNumber ?? ""}|${e.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  unique.sort((a, b) => a.date.localeCompare(b.date));

  console.log(
    `Parsed ${unique.length} unique run events (${nonRun} non-run posts, ${noDate} undated run posts).`,
  );
  if (unique.length === 0) {
    console.log("Nothing to insert. Exiting.");
    return;
  }
  console.log(`Date range: ${unique[0].date} → ${unique.at(-1)!.date}`);

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
