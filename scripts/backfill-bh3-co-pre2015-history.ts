/**
 * BH3 Boulder pre-2015 free-form posts backfill. Issue #1020.
 *
 * Phase B (PR #1015) captured ~195 events back to 2015-10-31; the older
 * `boulderh3.com/hashes/` archive uses free-form prose ("When: Saturday,
 * April 25th @ 2:30") that `parseBoulderH3IndexPage` deliberately skips.
 * This script walks the same pages, identifies skipped articles by
 * permalink-difference vs the parser's output, fetches each post for
 * `<meta property="article:published_time">` (year hint), and routes
 * body+publishedDate through Gemini for strict-JSON extraction.
 *
 * Mirrors the CFH3 Gemini cleanup pattern (PR #945):
 * `/tmp/bh3-pre2015-cleaned.json` cache survives re-runs; bypass with
 * `BH3_FORCE_RECLEAN=1`.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-bh3-co-pre2015-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-bh3-co-pre2015-history.ts
 *   Env:     GEMINI_API_KEY, BH3_FORCE_RECLEAN=1 (bypass cache)
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as cheerio from "cheerio";
import { reportAndApplyBackfill } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { callGemini } from "@/lib/ai/gemini";
import { parseBoulderH3IndexPage } from "@/adapters/html-scraper/boulder-h3";
import { decodeEntities } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Boulder H3 Website";
const KENNEL_TIMEZONE = "America/Denver";
const KENNEL_TAG = "bh3-co";
const BASE_URL = "https://boulderh3.com/hashes/";
const MAX_PAGES = 35; // Safety cap; archive currently spans ~21 real pages.
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)",
  Accept: "text/html",
};
const POLITE_DELAY_MS = 150;
const GEMINI_BATCH_SIZE = 25; // Bodies are larger than CFH3 rows; smaller batch keeps prompt under ~30KB.

const CACHE_PATH = path.join(os.tmpdir(), "bh3-pre2015-cleaned.json");

interface FreeFormCandidate {
  permalink: string;
  title: string;
  bodyText: string;
  publishedDate?: string; // YYYY-MM-DD (from <meta article:published_time>)
}

interface CleanedRow {
  permalink: string; // round-trip the URL so we can attach sourceUrl post-Gemini
  runNumber?: number;
  date: string; // YYYY-MM-DD
  title?: string;
  hares?: string;
  location?: string;
  startTime?: string; // "HH:MM"
}

async function fetchText(url: string): Promise<string | null> {
  const res = await safeFetch(url, { headers: FETCH_HEADERS });
  if (!res.ok) {
    console.warn(`  HTTP ${res.status} for ${url}`);
    return null;
  }
  return res.text();
}

function extractCandidatesFromIndex($: cheerio.CheerioAPI): FreeFormCandidate[] {
  const parsed = parseBoulderH3IndexPage($);
  const parsedUrls = new Set(parsed.map((e) => e.sourceUrl).filter((u): u is string => !!u));

  const candidates: FreeFormCandidate[] = [];
  $("article.et_pb_post").each((_i, el) => {
    const $art = $(el);
    const $link = $art.find("h2.entry-title a, h2 a").first();
    const permalink = $link.attr("href");
    const title = $link.text().trim();
    if (!permalink || !title) return;
    if (parsedUrls.has(permalink)) return; // Phase B already handled this one.

    const $body = $art.find(".post-content").first().clone();
    $body.find("a.more-link").remove();
    $body.find("br").replaceWith(" ");
    const bodyText = decodeEntities($body.text()).replaceAll(/\s+/g, " ").trim();
    if (!bodyText) return;
    candidates.push({ permalink, title: decodeEntities(title), bodyText });
  });
  return candidates;
}

async function fetchAllCandidates(): Promise<FreeFormCandidate[]> {
  const all: FreeFormCandidate[] = [];
  let emptyStreak = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? BASE_URL : `${BASE_URL}page/${page}/`;
    const html = await fetchText(url);
    if (!html) break;
    const $ = cheerio.load(html);
    const articles = $("article.et_pb_post").length;
    if (articles === 0) {
      emptyStreak++;
      if (emptyStreak >= 2) {
        console.log("  Two consecutive empty pages — assuming end of archive.");
        break;
      }
      continue;
    }
    emptyStreak = 0;
    const found = extractCandidatesFromIndex($);
    console.log(`  Page ${page}: ${articles} articles, ${found.length} free-form candidate(s)`);
    all.push(...found);
  }
  return all;
}

async function enrichWithPublishedDate(candidate: FreeFormCandidate): Promise<void> {
  const html = await fetchText(candidate.permalink);
  if (!html) return;
  const $ = cheerio.load(html);
  const publishedTime = $('meta[property="article:published_time"]').attr("content");
  if (publishedTime) {
    candidate.publishedDate = publishedTime.slice(0, 10); // "2012-12-27T20:25:00+00:00" → "2012-12-27"
  }
}

/** Strip a leading/trailing markdown code fence so JSON.parse doesn't choke. */
function stripCodeFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

async function geminiCleanBatch(batch: FreeFormCandidate[]): Promise<CleanedRow[]> {
  const rows = batch.map((c, i) => {
    const meta = c.publishedDate ? `[published=${c.publishedDate}]` : "[published=unknown]";
    return `${i + 1}. ${meta} ${c.permalink}\n   TITLE: ${c.title}\n   BODY: ${c.bodyText}`;
  });

  const prompt = `You are extracting Boulder H3 (BH3) trail event data from blog post bodies.

Each input is one trail. Use the [published=YYYY-MM-DD] hint as the YEAR when the body's date doesn't include a year (post is usually published within a few days of the trail). Prefer the body's stated date when explicit (month + day). When in doubt, use the published date.

Body shapes vary wildly:
- "Boulder Hash #735! When: Saturday, April 25th @ 2:30 Where: 4016 26th, Boulder,Co."
- "What: A hash When: Saturday 20 Jun @ 1800 (that's 5:69 pm or 5:00 pm Beano Time)"
- "What 5th Anal Boulder H3 Summer Campout When Friday, July 10 to Sunday, July 12"
- "What: 1/4 Cup of Cock's virgin lay (It's about time you lazy fuck!) The Golden H..."

Extract per trail:
- runNumber: integer (parse from "Hash #N", "BH3 #N", "Run #N"; omit if no number)
- date: "YYYY-MM-DD" (REQUIRED — use published-date hint for the year if body's "When" is yearless; if body has a date range, use the FIRST date)
- title: short title, e.g. "Fart Collins Invasion Pre-Lube" or "Summer Campout"; omit if generic ("A hash")
- startTime: "HH:MM" 24-hour. Convert "2:30" + "pm" → "14:30". "1800"/"18:00" → "18:00". Hash humor like "5:69 pm" → "17:00" (round to nearest sane hour). Omit if absent.
- location: address or venue from "Where:" / "Where" / "@". Omit if absent.
- hares: from "Hares:" / "Hare:" if present. Omit otherwise.

ALSO REQUIRED: include the input "permalink" verbatim in your output so we can match results back.

Output STRICT JSON: an array of objects with these fields:
  - permalink: string (REQUIRED, copy from input line)
  - runNumber: integer (optional)
  - date: "YYYY-MM-DD" (REQUIRED)
  - title: string (optional)
  - hares: string (optional)
  - location: string (optional)
  - startTime: "HH:MM" (optional)

Skip rows where you cannot determine a real trail date (return them as objects with date: null which we'll filter, OR omit them entirely — your choice). Return ONLY the JSON array, no commentary.

INPUT (${batch.length} trails):
${rows.join("\n\n")}`;

  console.log(`  Calling Gemini with ${batch.length} trails (~${Math.round(prompt.length / 1024)}KB prompt)...`);
  const result = await callGemini({ prompt, maxOutputTokens: 65536, temperature: 0 }, 0);
  if (!result.text) throw new Error(`Gemini cleanup failed: ${result.error ?? "empty response"}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(result.text));
  } catch (err) {
    throw new Error(`Gemini returned non-JSON (after fence strip): ${(err as Error).message}. First 200 chars: ${result.text.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("Gemini returned non-array");

  // Validate each row + reject hallucinated permalinks. Gemini occasionally
  // emits null array elements (per the prompt's escape hatch) or rewrites
  // URLs (drops trailing slash, http→https swap). Drop those rather than
  // crash or emit broken sourceUrls.
  const candidatePermalinks = new Set(batch.map((c) => c.permalink));
  const valid: CleanedRow[] = [];
  for (const row of parsed as Array<Partial<CleanedRow> | null>) {
    if (!row || typeof row.permalink !== "string" || !candidatePermalinks.has(row.permalink)) continue;
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    valid.push(row as CleanedRow);
  }
  if (valid.length < parsed.length) {
    console.warn(`  Dropped ${parsed.length - valid.length}/${parsed.length} rows (null/bad permalink/bad date)`);
  }
  return valid;
}

async function loadOrCleanCandidates(candidates: FreeFormCandidate[]): Promise<CleanedRow[]> {
  const force = process.env.BH3_FORCE_RECLEAN === "1";
  if (!force && fs.existsSync(CACHE_PATH)) {
    console.log(`  Reusing cached cleanup: ${CACHE_PATH}`);
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CleanedRow[];
  }

  console.log(`  Enriching ${candidates.length} candidates with published-date meta...`);
  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
    await enrichWithPublishedDate(candidates[i]);
    if ((i + 1) % 20 === 0) console.log(`    ${i + 1}/${candidates.length}`);
  }

  const all: CleanedRow[] = [];
  for (let i = 0; i < candidates.length; i += GEMINI_BATCH_SIZE) {
    const batch = candidates.slice(i, i + GEMINI_BATCH_SIZE);
    const cleaned = await geminiCleanBatch(batch);
    all.push(...cleaned);
    // Persist after every batch so a crash on batch N doesn't waste batches 1..N-1.
    fs.writeFileSync(CACHE_PATH, JSON.stringify(all, null, 2));
  }
  console.log(`  Cached cleanup -> ${CACHE_PATH}`);
  return all;
}

function cleanedToRawEvent(row: CleanedRow): RawEventData | null {
  if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  // Pad single-digit hours to HH:MM — Gemini sometimes returns "9:30" but
  // the codebase convention is strict 5-char "HH:MM".
  const startTime =
    row.startTime && /^\d{1,2}:\d{2}$/.test(row.startTime)
      ? row.startTime.padStart(5, "0")
      : undefined;
  return {
    date: row.date,
    kennelTag: KENNEL_TAG,
    runNumber: row.runNumber && row.runNumber > 0 ? row.runNumber : undefined,
    title: row.title,
    hares: row.hares,
    location: row.location,
    startTime,
    sourceUrl: row.permalink,
  };
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  console.log("\n[1/3] Walking boulderh3.com/hashes/ archive for free-form candidates...");
  const candidates = await fetchAllCandidates();
  console.log(`  Total candidates: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log("  Nothing to clean — Phase B may already have full coverage.");
    return;
  }

  console.log("\n[2/3] AI-cleaning free-form candidates...");
  const cleaned = await loadOrCleanCandidates(candidates);
  console.log(`  Cleaned: ${cleaned.length} rows`);

  const events = cleaned
    .map(cleanedToRawEvent)
    .filter((e): e is RawEventData => e !== null);
  console.log(`  Converted to ${events.length} RawEventData rows`);

  console.log("\n[3/3] Reporting + applying...");
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
