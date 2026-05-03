/**
 * One-shot historical backfill for the DFW Hash House Harriers calendar.
 *
 * The live adapter (`DFWHashAdapter`) intentionally fetches only the current
 * and next month — `dfwhhh.org/calendar/` is partial-enumeration HTML and
 * widening the live window would let the reconcile pipeline cancel events on
 * transient page failures. Historical coverage gaps (#1027 Dallas H3 ~16
 * runs, #1152 Fort Worth H3 #1053-#1055, #1158 DUHHH #845-#846 and earlier)
 * land here as a one-shot DB write.
 *
 * Two-phase strategy:
 *   1. Walk past monthly calendar pages and parse the grid via
 *      `extractDFWEvents`. Catches the bulk (~95%).
 *   2. Probe Wednesday + Saturday `event.php` URLs for any date in the window
 *      not already covered by phase 1. The source's grid sometimes omits
 *      runs whose detail pages still exist (e.g. DH3 #1203, DUHHH #846).
 *      Kennel routing comes from a `<h1>`/`<h2>` heading match.
 *
 * Both phases produce `RawEventData[]` and feed through `runBackfillScript`,
 * which partitions on `date < today-in-Chicago` (so the backfill cannot
 * encroach on the live adapter's window) and routes through `processRawEvents`
 * (fingerprint dedup → re-runnable as a no-op).
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-dfw-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-dfw-history.ts
 *
 *   BACKFILL_MONTHS=24 (default)  Months back from today to walk
 *   BACKFILL_PROBE_DAYS=730 (default)  Days back to probe via direct event.php URLs
 *   BACKFILL_PROBE=0  Disable phase 2 (calendar grid only)
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import {
  buildDFWMonthUrl,
  extractDFWEvents,
  parseDFWDetailPage,
} from "@/adapters/html-scraper/dfw-hash";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "DFW Hash Calendar";
const KENNEL_TIMEZONE = "America/Chicago";
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Backfill)";

/** Per-batch concurrency for detail page fetches. Mirrors the live adapter. */
const DETAIL_CONCURRENCY = 3;
/** Delay between detail-page batches (ms). */
const DETAIL_BATCH_DELAY = 300;

/**
 * Detail-page heading → kennelTag. Used by the probing pass to figure out
 * which kennel a probed `event.php` URL belongs to. Order matters: more
 * specific names (e.g. "Dallas Urban Hash") must come before "Dallas Hash".
 */
const HEADING_TO_KENNEL: Array<[RegExp, string]> = [
  [/Dallas Urban Hash/i, "duhhh"],
  [/NoDuh Hash|NODUH Hash/i, "noduhhh"],
  [/Dallas Hash/i, "dh3-tx"],
  [/Fort Worth Hash/i, "fwh3"],
];

interface MonthRef {
  year: number;
  month: number; // 0-indexed
}

/** Build the list of (year, month) pairs to walk, oldest first. */
function monthsBackFromToday(months: number): MonthRef[] {
  const refs: MonthRef[] = [];
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  for (let i = 0; i < months; i++) {
    refs.push({ year, month });
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return refs.reverse();
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Map a detail page's heading to a known DFW kennelTag, or undefined. */
function detectKennelFromHeadings($: CheerioAPI): string | undefined {
  const headings: string[] = [];
  $("h1, h2").each((_i, el) => {
    headings.push($(el).text().trim());
  });
  for (const text of headings) {
    for (const [pattern, tag] of HEADING_TO_KENNEL) {
      if (pattern.test(text)) return tag;
    }
  }
  return undefined;
}

/** Run an async mapper across `items` in batches with a delay between batches. */
async function batchProcess<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += DETAIL_CONCURRENCY) {
    if (i > 0) await new Promise((r) => setTimeout(r, DETAIL_BATCH_DELAY));
    const batch = items.slice(i, i + DETAIL_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(mapper));
    for (const r of results) {
      if (r.status === "fulfilled") out.push(r.value);
    }
  }
  return out;
}

interface FetchedEvent {
  event: RawEventData;
  /** Absolute detail URL — used to dedupe phase 2 against phase 1. */
  detailKey?: string;
}

async function fetchMonth({ year, month }: MonthRef): Promise<FetchedEvent[]> {
  const url = buildDFWMonthUrl(year, month);
  const html = await fetchHtml(url);
  if (!html) {
    console.warn(`  ${year}-${String(month + 1).padStart(2, "0")}: month page fetch failed`);
    return [];
  }

  const $ = cheerio.load(html);
  const { events: indexEvents, errors } = extractDFWEvents($, year, month, url);
  if (errors.length > 0) {
    console.warn(`  ${year}-${String(month + 1).padStart(2, "0")}: ${errors.length} parse errors`);
  }
  if (indexEvents.length === 0) return [];

  const enriched = await batchProcess(indexEvents, async ({ event, detailUrl }) => {
    if (!detailUrl) return { event, detailKey: undefined };
    const detailHtml = await fetchHtml(detailUrl);
    if (!detailHtml) return { event, detailKey: detailUrl };
    const $detail = cheerio.load(detailHtml);
    const detail = parseDFWDetailPage($detail);
    return {
      event: {
        ...event,
        ...(detail.startTime && { startTime: detail.startTime }),
        ...(detail.location && { location: detail.location }),
        ...(detail.hares && { hares: detail.hares }),
        ...(detail.runNumber !== undefined && { runNumber: detail.runNumber }),
        ...(detail.description && { description: detail.description }),
        ...(detail.cost && { cost: detail.cost }),
        // Detail-page date wins over the grid date (#1155).
        date: detail.date ?? event.date,
      },
      detailKey: detailUrl,
    };
  });

  console.log(
    `  ${year}-${String(month + 1).padStart(2, "0")}: ${enriched.length} events from ${indexEvents.length} index rows`,
  );
  return enriched;
}

/**
 * DFW kennels run on fixed weekdays — DUHHH on Wed, DH3/FWH3 on Sat. Probing
 * those weekdays catches events the source's grid forgot to link (#1158 #846,
 * #1027 #1203/#1212).
 */
function probeDates(daysBack: number): { year: number; month: number; day: number }[] {
  const targets: { year: number; month: number; day: number }[] = [];
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    if (dow !== 3 && dow !== 6) continue; // Wed or Sat only
    targets.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1, // 1-indexed for the source URL
      day: d.getUTCDate(),
    });
  }
  return targets;
}

function probeUrl(year: number, month1: number, day: number): string {
  return `http://www.dfwhhh.org/calendar/${year}/event.php?month=${month1}&day=${day}&year=${year}&no=1`;
}

async function probeDate(
  target: { year: number; month: number; day: number },
): Promise<FetchedEvent | null> {
  const url = probeUrl(target.year, target.month, target.day);
  const html = await fetchHtml(url);
  if (!html) return null;
  const $ = cheerio.load(html);

  const kennelTag = detectKennelFromHeadings($);
  if (!kennelTag) return null;

  const detail = parseDFWDetailPage($);
  // Without a parseable detail-page date this URL probably 404'd silently
  // into a default page — skip rather than guess.
  if (!detail.date) return null;

  const event: RawEventData = {
    date: detail.date,
    kennelTags: [kennelTag],
    sourceUrl: url,
    ...(detail.startTime && { startTime: detail.startTime }),
    ...(detail.location && { location: detail.location }),
    ...(detail.hares && { hares: detail.hares }),
    ...(detail.runNumber !== undefined && { runNumber: detail.runNumber }),
    ...(detail.description && { description: detail.description }),
    ...(detail.cost && { cost: detail.cost }),
  };
  return { event, detailKey: url };
}

async function fetchAllEvents(): Promise<RawEventData[]> {
  const months = parseInt(process.env.BACKFILL_MONTHS ?? "24", 10);
  const probeDays = parseInt(process.env.BACKFILL_PROBE_DAYS ?? "730", 10);
  const probeEnabled = process.env.BACKFILL_PROBE !== "0";

  const refs = monthsBackFromToday(months);
  console.log(
    `Phase 1: walking ${refs.length} months from ${refs[0].year}-${String(refs[0].month + 1).padStart(2, "0")} → ${refs.at(-1)!.year}-${String(refs.at(-1)!.month + 1).padStart(2, "0")}`,
  );

  const phase1: FetchedEvent[] = [];
  for (const ref of refs) {
    phase1.push(...(await fetchMonth(ref)));
  }
  console.log(`  Phase 1 total: ${phase1.length} events`);

  if (!probeEnabled) {
    return phase1.map((f) => f.event);
  }

  const covered = new Set(
    phase1.map((f) => f.detailKey).filter((k): k is string => Boolean(k)),
  );

  const allTargets = probeDates(probeDays);
  const newTargets = allTargets.filter((t) => !covered.has(probeUrl(t.year, t.month, t.day)));
  console.log(
    `\nPhase 2: probing ${newTargets.length} Wed+Sat dates over the past ${probeDays} days (${allTargets.length - newTargets.length} already covered by phase 1)`,
  );

  const probed = await batchProcess(newTargets, probeDate);
  const phase2 = probed.filter((p): p is FetchedEvent => p !== null);
  console.log(`  Phase 2 added: ${phase2.length} events not in monthly grid`);

  return [...phase1, ...phase2].map((f) => f.event);
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: `Walking dfwhhh.org monthly grid + probing direct event.php URLs`,
  fetchEvents: fetchAllEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
