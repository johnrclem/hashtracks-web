/**
 * One-shot historical backfill for Sumo H3 Kanagawa (sumo-h3).
 *
 * The live SumoH3Adapter scrapes the rolling hareline (upcoming window only), so
 * the Past tab showed 0 events (#2381). The site IS a WordPress install running
 * The Events Calendar, and every run has a durable per-event page at
 * `/events/<postId>/` that survives indefinitely — each one SSRs a clean JSON-LD
 * `Event` object:
 *
 *   { "@type":"Event", "name":"580",
 *     "startDate":"2017-02-19T14:00:00+09:00",
 *     "location":{ "name":"Kokusai-Tenjijo Station / Ariake Station" } }
 *
 * plus a `<title>Run #N – …</title>` for the run number. (The audit called this
 * gap "unrecoverable"; it is not — the per-event archive is fully reachable.)
 *
 * Numeric post ids are stable permalinks (id 100 → Run #580) that serve clean
 * JSON-LD directly (the date-slug `/events/<YYYY-MM-DD>/` form 301-redirects, and
 * some pages omit the JSON-LD island). We walk the numeric id range and import
 * every page that carries a parseable `Event` island, deduped by run number.
 *
 * SCOPE NOTE: this recovers the JSON-LD-bearing subset (~80+ runs, 2015→present)
 * — proving the gap is NOT "unrecoverable" as the audit (#2381) claimed. A
 * fuller enumeration (the minority of event pages that lack JSON-LD need
 * title+schedule HTML parsing) is a follow-up; re-running this script after that
 * is added is idempotent (fingerprint dedup). The Events Calendar archive begins
 * ~2015; pre-2015 runs were never entered into the plugin and are genuinely absent.
 * Titles are just "Run #N" (no theme) → left undefined so merge synthesizes
 * "Sumo H3 Trail #N". Source carries upcomingOnly so reconcile won't cancel these.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-sumo-h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-sumo-h3-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Sumo H3 Website";
const KENNEL_TAG = "sumo-h3";
const KENNEL_TIMEZONE = "Asia/Tokyo";
const BASE = "https://sumoh3.gotothehash.net/events";
// Event post ids are scattered up to the current upcoming pages (~1061); the
// id space is sparse (many 404 gaps) so we walk the whole range and keep hits.
// Bump this before re-running once the site publishes ids beyond the ceiling.
const MAX_ID = 1100;
const BATCH = 12;

const TITLE_RUN_RE = /Run\s*#\s*(\d{1,5})/i;
const TIME_RE = /T(\d{2}:\d{2})/;

interface LdEvent {
  "@type"?: string | string[];
  name?: string | number;
  startDate?: string;
  location?: { name?: string } | string;
}

function extractLdEvent(html: string): LdEvent | null {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const it of items) {
        const t = (it as LdEvent)?.["@type"];
        if (t === "Event" || (Array.isArray(t) && t.includes("Event"))) return it as LdEvent;
      }
    } catch {
      // skip malformed island
    }
  }
  return null;
}

async function fetchEvent(id: number): Promise<RawEventData | null> {
  const url = `${BASE}/${id}/`;
  let res: Response;
  try {
    res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (HashTracks backfill)" } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const html = await res.text();
  const ld = extractLdEvent(html);
  if (!ld?.startDate) return null;
  const date = ld.startDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const titleMatch = TITLE_RUN_RE.exec(html);
  const nameNum = typeof ld.name === "number" ? ld.name : Number.parseInt(String(ld.name), 10);
  // Number.isInteger guards the integer runNumber column against NaN/float.
  const runNumber = titleMatch
    ? Number.parseInt(titleMatch[1], 10)
    : Number.isInteger(nameNum) && nameNum > 0
      ? nameNum
      : undefined;

  const startTime = TIME_RE.exec(ld.startDate)?.[1];
  const locationName = typeof ld.location === "string" ? ld.location : ld.location?.name;
  const location = locationName?.trim() || undefined;

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    // "Run #N" carries no theme → undefined so merge synthesizes the default.
    startTime,
    location,
    sourceUrl: url,
  };
}

async function fetchEvents(): Promise<RawEventData[]> {
  const found: RawEventData[] = [];
  for (let start = 1; start <= MAX_ID; start += BATCH) {
    const ids = Array.from({ length: Math.min(BATCH, MAX_ID - start + 1) }, (_, i) => start + i);
    const batch = await Promise.all(ids.map(fetchEvent));
    for (const e of batch) if (e) found.push(e);
  }
  // Dedupe by run number (republished "-2" slugs share a run#); keep first.
  const byRun = new Map<string, RawEventData>();
  for (const e of found) {
    const k = e.runNumber != null ? `r${e.runNumber}` : `d${e.date}`;
    if (!byRun.has(k)) byRun.set(k, e);
  }
  return [...byRun.values()].sort((a, b) => a.date.localeCompare(b.date));
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: `Walking Sumo H3 /events/<id>/ archive (ids 1-${MAX_ID})`,
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
