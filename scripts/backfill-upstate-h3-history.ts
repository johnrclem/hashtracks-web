/**
 * One-shot historical backfill for Upstate H3 (uh3), issue #2420.
 *
 * The kennel's static "receding hareline" page
 * (https://www.upstatehashers.com/receding-hareline) documents named historical
 * runs #122 (Feb 2008) → #334 (May 2016) — 88 titled runs, gappy, unmaintained
 * past 2016 (the kennel is now ~#700). Each run is a Squarespace summary link
 * whose text is verbatim "M/D/YY #NNN Title" (rendered twice per run — thumbnail
 * + title — so we dedup by run number). None are in HashTracks.
 *
 * These predate the STATIC_SCHEDULE source's recurring placeholders and carry
 * real run numbers + titles, so there's no collision.
 *
 * This one-shot also owns ALL of the kennel's historical special events: it
 * pulls the /new-events-1 Squarespace collection (multi-day dress-run weekends /
 * campouts) via the shared SquarespaceEventsAdapter with a wide window, so the
 * two known Sep-2024 specials land here too. The live "Upstate H3 Website"
 * source stays forward-only (all historical data belongs to this backfill).
 *
 * Binds to the "Upstate H3 Website" source for provenance, routes through
 * reportAndApplyBackfill → processRawEvents (canonical Events in one pass;
 * idempotent; strict date<today partition — every row is past, so a future
 * special returned by the Squarespace feed is dropped here and left to the
 * live source).
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-upstate-h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-upstate-h3-history.ts
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { SquarespaceEventsAdapter } from "@/adapters/html-scraper/squarespace-events";
import { toIsoDateString } from "@/lib/date";
import type { RawEventData } from "@/adapters/types";
import type { Source } from "@/generated/prisma/client";

const SITE_URL = "https://www.upstatehashers.com";
const HARELINE_URL = `${SITE_URL}/receding-hareline`;

/** Verbatim summary-link text: "M/D/YY #NNN Title". The title capture is
 *  `(\S.*)` (not `.+`): requiring a non-space first char makes the `\s+` before
 *  it a deterministic boundary, so the match is linear — no backtracking
 *  (Sonar S8786). Text is single-spaced + trimmed before matching. */
const ROW_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2})\s+#(\d{2,3})\s+(\S.*)$/;

/**
 * Parse the receding-hareline HTML into one RawEventData per run. Each run is an
 * `<a>` whose text is "M/D/YY #NNN Title"; Squarespace renders two links per run
 * (thumbnail + title), so we dedup by run number (first wins). Two-digit years
 * are all 2008–2016 → 20YY.
 */
export function parseRecedingHareline(html: string): RawEventData[] {
  const $ = cheerio.load(html);
  const byRun = new Map<number, RawEventData>();
  $("a").each((_i, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const m = ROW_RE.exec(text);
    if (!m) return;
    const [, mo, day, yy, num, title] = m;
    const runNumber = Number.parseInt(num, 10);
    if (byRun.has(runNumber)) return;
    // toIsoDateString normalizes the loose "2008-2-17" form to "2008-02-17" and
    // validates — keeping the canonical UTC-noon date key in sync with merge.
    const date = toIsoDateString(`${2000 + Number.parseInt(yy, 10)}-${mo}-${day}`);
    byRun.set(runNumber, {
      date,
      runNumber,
      title: title.trim(),
      kennelTags: ["uh3"],
    });
  });
  return [...byRun.values()].sort((a, b) => (a.runNumber ?? 0) - (b.runNumber ?? 0));
}

const isMain = import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  runBackfillScript({
    sourceName: "Upstate H3 Website",
    kennelTimezone: "America/New_York",
    label: "Fetching Upstate H3 receding hareline (#122–#334)",
    fetchEvents: async (): Promise<RawEventData[]> => {
      // 1. Historical hareline (#122–#334) from the static page.
      const res = await safeFetch(HARELINE_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracksBackfill/1.0)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${HARELINE_URL}`);
      const hareline = parseRecedingHareline(await res.text());
      // Fail loud on a structural change — expect ~88 runs; a near-empty parse
      // means the page markup rotated and we'd otherwise backfill nothing.
      if (hareline.length < 60) {
        throw new Error(`Only ${hareline.length} runs parsed (expected ~88) — page structure may have changed`);
      }

      // 2. Named special events from the /new-events-1 Squarespace collection —
      //    same adapter the live source uses, but a wide window here reaches the
      //    older past specials. The runner's date<today partition drops any
      //    future one (the live source owns those).
      const specialsSource = {
        id: "backfill-upstate-specials",
        name: "Upstate H3 Website",
        type: "HTML_SCRAPER",
        url: SITE_URL,
        config: { kennelTag: "uh3", collectionPath: "/new-events-1" },
      } as unknown as Source;
      const specials = await new SquarespaceEventsAdapter().fetch(specialsSource, { days: 9999 });
      // Fail closed on ANY adapter error — not just fetch. The Squarespace adapter
      // also reports malformed JSON / missing upcoming|past shape through errors[],
      // and this one-shot exclusively owns the historical specials, so a partial
      // specials fetch must abort rather than silently backfill hareline-only.
      // (Codex review; same completeness rule as the WH4/Larrikins backfills.)
      if (specials.errors.length > 0) {
        throw new Error(`Squarespace specials fetch failed: ${specials.errors.join("; ")}`);
      }

      return [...hareline, ...specials.events];
    },
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
