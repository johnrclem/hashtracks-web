/**
 * One-shot historical backfill for Hanoi H3 (hanoi-h3) — dated recap runs.
 *
 * The live "Hanoi H3 Website" adapter parses only the current-run block on
 * hanoih3.com's home page (upcomingOnly), so historical runs never reach
 * canonical Events. The kennel's "Runs Hash Flash" recap gallery
 * (https://hanoih3.com/run-on-31st-of-august/) is a WordPress Jetpack slideshow
 * whose `<figcaption>` captions carry run number + a free-text location/blurb, and
 * — for about half — an explicit DD/MM/YYYY or DD.MM.YYYY date.
 *
 * Partial-recovery by design: the captions are inconsistent free text. Only
 * captions where a date immediately follows the run number are imported; undated
 * captions (run# + place only) are DROPPED, not date-inferred — the cadence isn't
 * strictly weekly and the run#→date mapping is unreliable (per the #2287 audit
 * comment). The result is ~26 faithful rows (#1718–#1747) rather than a guessed 48.
 *
 * Field mapping: the caption prose goes to `description` (verbatim recap text);
 * `location` is intentionally left undefined so merge doesn't geocode Vietnamese
 * prose into a wrong pin (events fall back to the Hanoi region centroid), and
 * `title` is left undefined so merge synthesizes "Hanoi H3 #N". No hares/start/cost
 * are exposed on the recap captions.
 *
 * Guards: run numbers are restricted to the recap window (>= 1700) so the summary
 * caption "No.0232 (01/01/1996) – No.1667(21/05/2023) 740 times" and its embedded
 * tokens don't mint phantom runs; captions concatenate multiple "No.NNNN" tokens,
 * so each run# is paired only with a date that immediately follows it, and rows are
 * deduped by run number.
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint and loads only past
 * events (date < today in Asia/Ho_Chi_Minh).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-hanoi-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-hanoi-h3-history.ts
 *
 * Requires the "Hanoi H3 Website" source to exist + be linked to hanoi-h3 (seeded).
 */
import "dotenv/config";
import * as cheerio from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Hanoi H3 Website";
const KENNEL_TIMEZONE = "Asia/Ho_Chi_Minh";
const RECAP_URL = "https://hanoih3.com/run-on-31st-of-august/";
const MIN_RUN = 1700; // recap gallery window; drops the "No.0232 … No.1667" summary

// run# (labelled "No." OR "Run") directly followed by a date. The `(?:,\s*)?`
// keeps the two whitespace quantifiers non-adjacent (no ReDoS backtracking).
const RUN_DATE_RE = /(?:No\.?|Run)\s?(\d{3,4})\s*(?:,\s*)?\(?(\d{1,2})[/.](\d{1,2})[/.](\d{4})/gi;
// matches any run-number token ("No.NNNN" / "Run NNNN") — used to detect an
// undated caption and to trim a blurb at the next embedded token.
const ANY_RUN_RE = /(?:No\.?|Run)\s?\d{3,4}/i;

async function fetchRecap(): Promise<RawEventData[]> {
  const res = await safeFetch(RECAP_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    throw new Error(`${RECAP_URL}: HTTP ${res.status}`);
  }
  const $ = cheerio.load(await res.text());

  const byRun = new Map<number, RawEventData>();
  let undatedCaptions = 0;

  $("figcaption.gallery-caption").each((_i, el) => {
    const caption = $(el).text().trim();
    if (!caption) return;
    let matchedHere = false;

    for (const m of caption.matchAll(RUN_DATE_RE)) {
      const runNumber = Number.parseInt(m[1], 10);
      if (runNumber < MIN_RUN) continue; // summary tokens
      const dd = Number.parseInt(m[2], 10);
      const mm = Number.parseInt(m[3], 10);
      const yyyy = Number.parseInt(m[4], 10);
      if (dd < 1 || dd > 31 || mm < 1 || mm > 12) continue;
      matchedHere = true;
      if (byRun.has(runNumber)) continue; // first date per run wins

      const date = `${yyyy.toString().padStart(4, "0")}-${mm
        .toString()
        .padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;

      // blurb = text after the date, trimmed at the next embedded run token
      let blurb = caption.slice(m.index + m[0].length).trim().replace(/^[,]+/, "").trim();
      const next = ANY_RUN_RE.exec(blurb);
      if (next) blurb = blurb.slice(0, next.index).trim();
      blurb = blurb.replace(/\s+/g, " ").trim();

      byRun.set(runNumber, {
        date,
        kennelTags: ["hanoi-h3"],
        runNumber,
        // title/location omitted (see header); recap prose kept as description.
        description: blurb || undefined,
        sourceUrl: RECAP_URL,
      });
    }

    // Count as an undated drop only when the caption carries an IN-WINDOW run
    // token (>= MIN_RUN) with no adjacent date. This excludes the out-of-window
    // summary caption ("No.0232 … No.1667 … 740 times"), which is dated but
    // deliberately skipped for a different reason (run# below MIN_RUN).
    if (!matchedHere) {
      const hasInWindowRun = [...caption.matchAll(/(?:No\.?|Run)\s?(\d{3,4})/gi)].some(
        (t) => Number.parseInt(t[1], 10) >= MIN_RUN,
      );
      if (hasInWindowRun) undatedCaptions++;
    }
  });

  const events = [...byRun.values()];
  console.log(
    `  Parsed ${events.length} dated runs (#${MIN_RUN}+); dropped ~${undatedCaptions} undated captions (no date-inference by design)`,
  );

  if (events.length === 0) {
    throw new Error(
      `${RECAP_URL} yielded 0 dated captions — the gallery markup likely changed. Aborting.`,
    );
  }
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Fetching Hanoi H3 dated recap runs from hanoih3.com Hash Flash gallery",
  fetchEvents: fetchRecap,
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
