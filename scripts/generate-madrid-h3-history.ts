/**
 * One-shot generator for `scripts/data/madrid-h3-history.json` — the frozen
 * Madrid H3 (madrid-h3) WordPress archive that `backfill-madrid-h3-history.ts`
 * replays into canonical Events.
 *
 * Re-extracts the FULL archive from madridhhh.com via the self-hosted WordPress
 * REST API (`fetchAllWordPressPosts` — every page, not just the latest 30 the
 * forward adapter pulls), runs the live adapter's `parseMadridRunBody` over each
 * post (threading `post.date` so the 11-year archive's year-less / typo'd /
 * copy-pasted body dates resolve via `resolveRunDate`), drops non-run posts
 * (parser returns null), sorts deterministically by (date, runNumber), and
 * writes the JSON.
 *
 * Why regenerate (vs. hand-editing the JSON):
 *   - #2040: the prior extraction routed the run title into `description` (as a
 *     bare quoted theme) and left `title` undefined. The fixed parser now emits
 *     the real source title in `title` and `description: null`. Regenerating is
 *     the only way to get REAL source titles onto the ~440 historical rows (the
 *     old JSON only stored the theme fragment).
 *   - #2041: full enumeration captures the ~10 posts the partial window missed.
 *
 * The frozen JSON is committed as data (no parser at backfill time), per the
 * H7 / Brasília / Asunción "freeze the archive" lesson. This generator is the
 * provenance record for how it was produced; it is NOT run by cron or Vercel.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   npx tsx scripts/generate-madrid-h3-history.ts          # writes the JSON
 *   npx tsx scripts/generate-madrid-h3-history.ts --dry    # report only, no write
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchAllWordPressPosts } from "@/adapters/wordpress-api";
import {
  extractMadridPostBody,
  parseMadridRunBody,
} from "@/adapters/html-scraper/madrid-hash";
import type { RawEventData } from "@/adapters/types";

const BASE_URL = "https://madridhhh.com/";
const OUT_PATH = join(process.cwd(), "scripts/data/madrid-h3-history.json");

/**
 * Curated real runs the parser skips because their post body carries NO
 * `Run No.` label (so `parseMadridRunBody` returns null). These are the
 * recoverable half of the #2041 gap: special/recent runs with an EXPLICIT
 * in-body `Date:` line, so the run date is certain — no weekday/publish-date
 * guessing. Fields transcribed verbatim from the live post bodies; hares
 * `& `-split + alpha-sorted to match the adapter's fingerprint shape;
 * `description: null` (no theme routed, per #2040).
 *
 * Deliberately EXCLUDED (no determinable run date — absence beats a guessed
 * date, per the fail-loud philosophy): the 5 pre-2017 freeform "Coordinates:"
 * recap posts (Memorial 2016-11-07, Tinsel 2016-12-18, Traumatised
 * 2015-10-25, Titillated 2015-09-20, Beleaguered 2015-09-17 — no `Date:`
 * line) and the COVID-era "St Paddy's R*n 2020" (2020-03-11, no body data,
 * lockdown-cancelled). The empty 2014-10-23 meta post is a non-run.
 */
const CURATED_EXTRAS: RawEventData[] = [
  {
    date: "2025-06-08",
    kennelTags: ["madrid-h3"],
    title: "The “Scarlet Culchie” R*n",
    hares: "Scarlett O’Hare, Sir Sir Culchie",
    location: "La Berzosa",
    startTime: "13:00",
    latitude: 40.614912,
    longitude: -3.928358,
    locationUrl: "https://goo.gl/maps/N3n3SeQKihWmXNpm6",
    sourceUrl: "https://madridhhh.com/the-scarlet-culchie-rn/",
    description: null,
  },
  {
    date: "2025-06-15",
    kennelTags: ["madrid-h3"],
    title: "The “Mad Dag With A Hairy Bush” R*n",
    hares: "Bush Warmer, Sir Scrambled Dag",
    location: "Avda papa Negro 39, Parque Juan Pablo II, Madrid",
    startTime: "13:00",
    latitude: 40.454352,
    longitude: -3.629372,
    locationUrl: "https://maps.app.goo.gl/WJGZLk4YtjP36gw29",
    sourceUrl: "https://madridhhh.com/mad-dag-with-a-hairy-bush-run/",
    description: null,
  },
  {
    date: "2025-06-22",
    kennelTags: ["madrid-h3"],
    title: "The “Hope I don’t have to sh*t” R*n",
    hares: "Marine NN (Virgin Hare), Smile Like You Like It",
    location: "Casa de Campo, Puerta de Rodajos Entrance.",
    startTime: "13:00",
    latitude: 40.412508,
    longitude: -3.779128,
    locationUrl: "https://goo.gl/maps/QVmpJDhkkkm",
    sourceUrl: "https://madridhhh.com/the-hope-i-dont-have-to-sht-rn/",
    description: null,
  },
  {
    // COVID-era online "e-vent"; body gives an explicit date + 13:00 but no
    // venue (it was virtual), so location/hares are intentionally absent.
    date: "2020-12-20",
    kennelTags: ["madrid-h3"],
    title: "Hash Xmas E-vent 2020",
    startTime: "13:00",
    sourceUrl: "https://madridhhh.com/hash-xmas-e-vent-2020/",
    description: null,
  },
];

/**
 * Parse one post exactly as the live adapter does — via the shared
 * `extractMadridPostBody` transform — so the frozen archive matches the
 * recurring scrape byte-for-byte.
 */
function parsePost(post: {
  title: string;
  content: string;
  url: string;
  date: string;
}): RawEventData | null {
  const { body, hrefLocationUrl } = extractMadridPostBody(post.content);
  return parseMadridRunBody(body, post.title, post.url, post.date, hrefLocationUrl);
}

async function main() {
  const dryRun = process.argv.includes("--dry");

  console.log(`Fetching full WordPress archive from ${BASE_URL} …`);
  const posts = await fetchAllWordPressPosts(BASE_URL, { perPage: 100 });
  console.log(`  Fetched ${posts.length} posts (all categories).`);
  // Abort BEFORE any processing if the fetch came back empty (API/network
  // failure). Otherwise the curated extras alone would survive the later
  // `events.length === 0` check and overwrite the frozen archive with 4 rows,
  // wiping the 442 historical runs.
  if (posts.length === 0) {
    throw new Error(
      "Fetched 0 posts from WordPress API — aborting to avoid overwriting the frozen history.",
    );
  }

  const events: RawEventData[] = [];
  let skipped = 0;
  for (const post of posts) {
    // Isolate each post: one malformed body must not abort the whole archive.
    try {
      const event = parsePost(post);
      if (event) events.push(event);
      else skipped++;
    } catch (err) {
      console.error(`  Failed to parse ${post.url}:`, err);
      skipped++;
    }
  }
  console.log(`  Parsed ${events.length} run events, skipped ${skipped} non-run/unlabeled posts.`);

  // Splice in the curated runs the parser can't reach (no `Run No.` label),
  // guarding against a future parser that DOES pick one of them up (no dup).
  const parsedUrls = new Set(events.map((e) => e.sourceUrl));
  const extras = CURATED_EXTRAS.filter((e) => !parsedUrls.has(e.sourceUrl));
  events.push(...extras);
  console.log(`  + ${extras.length} curated extras (unlabeled real runs, #2041).`);

  // Fail loud before any further work if the parse produced nothing.
  if (events.length === 0) {
    throw new Error("Generator produced 0 run events — aborting (body format may have changed).");
  }

  // Deterministic order for a clean, stable committed diff.
  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || (a.runNumber ?? 0) - (b.runNumber ?? 0),
  );

  const first = events[0];
  const last = events.at(-1)!;
  console.log(`\nDate range: ${first.date} (#${first.runNumber}) → ${last.date} (#${last.runNumber})`);
  console.log("Samples:");
  for (const e of [first, events[Math.floor(events.length / 2)], last]) {
    console.log(
      `  #${e.runNumber} ${e.date} | title=${e.title ?? "—"} | desc=${e.description === null ? "null" : (e.description ?? "—")} | hares=${e.hares ?? "—"}`,
    );
  }
  // Faithful source quirks — confirm they survived the regeneration.
  const quirk1 = events.find((e) => e.runNumber === 1);
  const quirk2659 = events.find((e) => e.runNumber === 2659);
  console.log(`\nQuirks: run #1 (COVID virtual) ${quirk1 ? `present @ ${quirk1.date}` : "ABSENT"}; ` +
    `run #2659 (mistype) ${quirk2659 ? `present @ ${quirk2659.date}` : "ABSENT"}`);

  if (dryRun) {
    console.log("\n--dry: not writing. Re-run without --dry to write the JSON.");
    return;
  }

  writeFileSync(OUT_PATH, JSON.stringify(events, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${events.length} rows → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
