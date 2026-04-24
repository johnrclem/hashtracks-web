/**
 * One-shot historical backfill for Cape Fear H3 (CFH3).
 *
 * Backfills the receding hareline (second `wp-block-table` on `/hare-line/`,
 * trails back to #1 "Feast of Fools" 2013-01-05) which the live adapter never
 * reaches (it reads only the upcoming table + 20 most recent blog posts).
 *
 * Uses Gemini to clean the non-uniform archive (decimal run numbers, embedded
 * year markers, inline titles, mixed date formats); cached output lives at
 * `/tmp/cfh3-receding-cleaned.json` for re-runs.
 *
 * Partition: live adapter owns `date >= CURDATE()`, this script owns
 * `date < CURDATE()`. `insertRawEventsForSource` fingerprint-dedupes, so the
 * script is safely re-runnable.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-cfh3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-cfh3-history.ts
 *   Env:       GEMINI_API_KEY (required), CFH3_FORCE_RECLEAN=1 (bypass cache)
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as cheerio from "cheerio";
import { insertRawEventsForSource } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { callGemini } from "@/lib/ai/gemini";
import { parseCfh3Post } from "@/adapters/html-scraper/cape-fear-h3";
import { decodeEntities } from "@/adapters/utils";
import { todayInTimezone } from "@/lib/timezone";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Cape Fear H3 Website";
const HARELINE_PAGE_URL = "https://capefearh3.com/hare-line/";
const KENNEL_TIMEZONE = "America/New_York";

const API_BASE = "https://public-api.wordpress.com/rest/v1.1/sites/capefearh3.com";
const HARELINE_POST_JSON = `${API_BASE}/posts/339?fields=content`;
const POSTS_JSON = (offset: number) =>
  `${API_BASE}/posts/?number=100&offset=${offset}&fields=ID,date,title,URL,content`;

const CACHE_PATH = "/tmp/cfh3-receding-cleaned.json";

interface WpComPost {
  ID: number;
  date: string;
  title: string;
  URL: string;
  content: string;
}

interface CleanedRow {
  runNumber?: number;
  date: string; // YYYY-MM-DD
  title?: string;
  hares?: string;
  notes?: string;
}

interface BlogEnrichment extends Omit<RawEventData, "sourceUrl"> {
  title: string;
  sourceUrl: string;
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const res = await safeFetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${label} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Extract the receding table as `trail | date | hares` lines for Gemini. */
function extractRecedingRows(harelineHtml: string): string[] {
  const $ = cheerio.load(harelineHtml);
  const table = $("figure.wp-block-table table").eq(1);
  if (!table.length) throw new Error("Receding table not found — page layout may have changed");

  const lines: string[] = [];
  table.find("tr").each((_i, el) => {
    if ($(el).find("th").length > 0) return;
    const tds = $(el).find("td").toArray();
    if (tds.length < 2) return;
    const cells = tds.map((td) => $(td).text().trim().replace(/\s+/g, " "));
    lines.push(cells.join(" | "));
  });
  return lines;
}

async function geminiCleanRows(rows: string[]): Promise<CleanedRow[]> {
  const prompt = `You are cleaning a hash kennel's hareline archive into structured JSON.

Each input line is one trail, separated by \`|\`. Columns: trail_number | date_cell | hares.

Oddities to handle:
- The "date_cell" uses inconsistent formats: "2-21" (M-D no year), "1/17/26" (M/D/YY), "1-5-2013" (M-D-YYYY), "7/24 – 7/26 PEG ISLAND" (range + title), "12-27 XMAS WKND" (date + inline title), "5-30: Hash Olympics" (date : inline title).
- When a date has NO explicit year, INFER the year from context. Rows are in DESCENDING run-number order. Year markers appear at year boundaries (first January entry of each year typically has an explicit year). Carry the year forward to subsequent rows until the next explicit-year marker.
- If the date is a range, use the FIRST date only.
- The "trail_number" cell may embed a title with a colon, e.g. "1: Feast of Fools" means runNumber=1, title="Feast of Fools". If the third hares column is separately "Udder and Taste", that remains hares.
- Decimal run numbers like "499.69" or "381.5" are mini/interhash sequels. Return them as runNumber=499 (round down to integer) and put the fractional info in notes (e.g., "mini-hash (.69)"). If unsure, omit runNumber.
- "TBD" hares → omit \`hares\` field.
- Preserve any inline titles you find in the date cell (e.g., "EASTER WKND", "Hash Olympics", "XMAS WKND", "travel hashing to Myrtle Beach").

Output STRICT JSON: an array of objects with these fields (omit any that don't apply):
  - runNumber: integer (optional)
  - date: "YYYY-MM-DD" (REQUIRED)
  - title: string (optional, inline title extracted from date or trail cell)
  - hares: string (optional)
  - notes: string (optional, for decimal-run annotations or other curious details)

Preserve one row per input line. Do not deduplicate. Do not include commentary — return only the JSON array.

INPUT (${rows.length} rows):
${rows.join("\n")}`;

  console.log(`  Calling Gemini with ${rows.length} rows (~${Math.round(prompt.length / 1024)}KB prompt)...`);
  const result = await callGemini({ prompt, maxOutputTokens: 65536, temperature: 0.0 }, 0);
  if (!result.text) throw new Error(`Gemini cleanup failed: ${result.error ?? "empty response"}`);
  console.log(`  Gemini returned ${Math.round(result.text.length / 1024)}KB in ${result.durationMs}ms`);

  const parsed = JSON.parse(result.text) as CleanedRow[];
  if (!Array.isArray(parsed)) throw new Error("Gemini returned non-array");
  return parsed;
}

async function loadOrCleanReceding(harelineHtml: string): Promise<CleanedRow[]> {
  const forceReclean = process.env.CFH3_FORCE_RECLEAN === "1";
  if (!forceReclean && fs.existsSync(CACHE_PATH)) {
    console.log(`  Reusing cached cleanup: ${CACHE_PATH}`);
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CleanedRow[];
  }
  const rows = extractRecedingRows(harelineHtml);
  console.log(`  Extracted ${rows.length} raw receding rows`);
  const cleaned = await geminiCleanRows(rows);
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cleaned, null, 2));
  console.log(`  Cached cleanup -> ${CACHE_PATH}`);
  return cleaned;
}

async function fetchAllBlogPosts(): Promise<WpComPost[]> {
  const posts: WpComPost[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const data = await fetchJson<{ posts?: WpComPost[] }>(
      POSTS_JSON(offset),
      `Posts fetch offset=${offset}`,
    );
    const batch = data.posts ?? [];
    posts.push(...batch);
    if (batch.length < 100) break;
  }
  return posts;
}

function buildBlogIndex(posts: WpComPost[]): Map<string, BlogEnrichment> {
  const index = new Map<string, BlogEnrichment>();
  for (const post of posts) {
    const $ = cheerio.load(post.content);
    const parsed = parseCfh3Post($, post.date);
    if (!parsed) continue;
    index.set(parsed.date, {
      ...parsed,
      title: decodeEntities(post.title),
      sourceUrl: post.URL,
    });
  }
  return index;
}

function cleanedToRawEvent(row: CleanedRow): RawEventData | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  // Gemini sometimes echoes meta-instructions like "omit hares field" into the
  // notes field. Drop those; they're not real trail notes.
  const notes = row.notes && !/omit\s+hares/i.test(row.notes) ? row.notes : undefined;
  return {
    date: row.date,
    kennelTag: "cfh3",
    runNumber: row.runNumber && row.runNumber > 0 ? row.runNumber : undefined,
    title: row.title,
    hares: row.hares,
    description: notes,
    sourceUrl: HARELINE_PAGE_URL,
  };
}

function mergeWithBlog(row: RawEventData, blog: BlogEnrichment): RawEventData {
  return {
    ...row,
    title: blog.title || row.title,
    hares: blog.hares ?? row.hares,
    startTime: blog.startTime,
    location: blog.location,
    locationUrl: blog.locationUrl,
    description: blog.description ?? row.description,
    sourceUrl: blog.sourceUrl,
  };
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  console.log("\n[1/4] Fetching hareline page (post 339)...");
  const { content } = await fetchJson<{ content?: string }>(HARELINE_POST_JSON, "Hareline fetch");
  if (!content) throw new Error("Hareline page returned empty content");

  console.log("\n[2/4] AI-cleaning receding table...");
  const cleaned = await loadOrCleanReceding(content);
  console.log(`  Cleaned: ${cleaned.length} rows`);

  console.log("\n[3/4] Fetching blog posts for enrichment...");
  const posts = await fetchAllBlogPosts();
  console.log(`  Fetched ${posts.length} posts`);
  const blogIndex = buildBlogIndex(posts);
  console.log(`  Blog index: ${blogIndex.size} posts with parseable event data`);

  const base = cleaned
    .map(cleanedToRawEvent)
    .filter((e): e is RawEventData => e !== null);
  const enriched = base.map((row) => {
    const blog = blogIndex.get(row.date);
    return blog ? mergeWithBlog(row, blog) : row;
  });
  const enrichedCount = enriched.filter((e) => e.startTime || e.location).length;
  console.log(`  Enriched ${enrichedCount}/${enriched.length} rows with blog fields`);

  const today = todayInTimezone(KENNEL_TIMEZONE);
  const past = enriched.filter((e) => e.date < today);
  const futureOrToday = enriched.length - past.length;
  console.log(`  Partition: ${past.length} past rows, ${futureOrToday} skipped (date >= ${today})`);

  const sorted = [...past].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length > 0) {
    console.log(`\nDate range: ${sorted[0].date} → ${sorted[sorted.length - 1].date}`);
    const sampleIdx = [0, Math.floor(sorted.length / 2), sorted.length - 1];
    console.log("Samples (oldest, middle, newest):");
    for (const i of sampleIdx) {
      const e = sorted[i];
      console.log(
        `  #${e.runNumber ?? "?"} ${e.date} | title=${e.title ?? "—"} | hares=${e.hares ?? "—"} | loc=${e.location ?? "—"} | start=${e.startTime ?? "—"}`,
      );
    }
  }

  if (!apply) {
    console.log(`\n[4/4] Dry run complete. Review ${CACHE_PATH} and re-run with BACKFILL_APPLY=1 to write to DB.`);
    return;
  }
  if (past.length === 0) {
    console.log("\nNo events to insert. Exiting.");
    return;
  }

  console.log("\n[4/4] Writing to DB...");
  const { preExisting, inserted } = await insertRawEventsForSource(SOURCE_NAME, past);
  console.log(`  Pre-existing: ${preExisting}. Inserted: ${inserted}.`);
  if (inserted > 0) {
    console.log(`\nDone. Trigger a scrape of "${SOURCE_NAME}" from the admin UI to merge the new RawEvents.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
