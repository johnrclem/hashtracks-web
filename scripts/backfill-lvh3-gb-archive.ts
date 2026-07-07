/**
 * One-shot DEEP historical backfill for Lune Valley H3 (lvh3-gb) — runs #1–#728.
 *
 * Companion to `scripts/backfill-lvh3-gb-history.ts`, which recovered the Harrier
 * Central window (#729–#943 — the ~215 runs already in HashTracks). HC's public
 * feed only reaches back to when the kennel joined (~#729, 2020), so the deep
 * archive #1 (2000-10-22) → ~#728 (~2018) was still missing.
 *
 * That deep history lives on the kennel's own site:
 * https://lvh3.org.uk/previous/runs — a single HTML table that renders the FULL
 * #1–#943 archive server-side (the 25/50/75/100/ALL control is client-side JS
 * pager.js, so ONE fetch returns every row). Columns: R*n #, Date ("DD MMM YYYY"),
 * Type, Location, Hares, Scribe.
 *
 * Provenance note: there is no lvh3.org.uk Source row, so these website-archive
 * rows bind to the live "Lune Valley H3 Harrier Central" source (already linked to
 * lvh3-gb; `upcomingOnly: true` protects reconcile from ever false-cancelling past
 * rows). The DATA originates from lvh3.org.uk/previous/runs — documented here
 * because the binding is for provenance/merge-guard only, not the data's origin.
 *
 * Scope guard: only `runNumber <= 728` is emitted. #729–#943 are already canonical
 * (from the HC backfill) and share kennel+date with these rows, so re-emitting them
 * would only create parallel RawEvents with no new canonical Events — we skip them
 * to keep the backfill scoped to the genuine gap.
 *
 * Field mapping mirrors the live HC adapter's minimal output: `title` is left
 * undefined so merge synthesizes "LVH3 #N"; `location` and `hares` come verbatim
 * (HTML-entity-decoded); `description`/`cost`/`startTime` omitted (the archive
 * exposes none, and the scribe column is a byline, not a blurb).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint and loads only past
 * events (date < today in Europe/London).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-lvh3-gb-archive.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-lvh3-gb-archive.ts
 *
 * Requires the "Lune Valley H3 Harrier Central" source to exist + be linked to
 * lvh3-gb (seeded).
 */
import "dotenv/config";
import * as cheerio from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { chronoParseDate } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Lune Valley H3 Harrier Central";
const KENNEL_TIMEZONE = "Europe/London";
const ARCHIVE_URL = "https://lvh3.org.uk/previous/runs";
const MAX_RUN = 728; // deep gap only; #729+ already canonical via the HC backfill

async function fetchArchive(): Promise<RawEventData[]> {
  const res = await safeFetch(ARCHIVE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    throw new Error(`${ARCHIVE_URL}: HTTP ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const events: RawEventData[] = [];
  let droppedNoDate = 0;
  let droppedNoRun = 0;

  $("tr").each((_i, el) => {
    const cells = $(el)
      .find("td")
      .map((_j, c) => $(c).text().trim())
      .get();
    if (cells.length < 5) return; // header (<th>) rows / malformed

    const runNumber = Number.parseInt(cells[0], 10);
    if (!Number.isFinite(runNumber) || runNumber <= 0) {
      droppedNoRun++;
      return;
    }
    if (runNumber > MAX_RUN) return; // covered by the HC backfill

    // cells: [R*n, Date, Type, Location, Hares, Scribe]
    const date = chronoParseDate(cells[1], "en-GB");
    if (!date) {
      droppedNoDate++;
      return;
    }

    const location = cells[3]?.trim() || undefined;
    const hares = cells[4]?.trim() || undefined;

    events.push({
      date,
      kennelTags: ["lvh3-gb"],
      runNumber,
      // title omitted → merge synthesizes "LVH3 #N"
      location,
      hares,
      sourceUrl: ARCHIVE_URL,
    });
  });

  console.log(
    `  Parsed ${events.length} rows (#1–#${MAX_RUN}); dropped ${droppedNoDate} undated, ${droppedNoRun} non-numeric-run`,
  );

  // A one-shot backfill that recovers zero rows is never correct — the archive
  // demonstrably holds #1 (2000-10-22) onward. Fail loud so breakage isn't masked
  // by the runner's "Total parsed: 0 → exit 0".
  if (events.length === 0) {
    throw new Error(
      `${ARCHIVE_URL} yielded 0 parseable rows ≤ #${MAX_RUN} — the table structure likely changed. Aborting.`,
    );
  }
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Fetching Lune Valley H3 (LVH3) deep archive #1–#728 from lvh3.org.uk",
  fetchEvents: fetchArchive,
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
