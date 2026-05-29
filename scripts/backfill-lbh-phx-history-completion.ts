/**
 * LBH-PHX (Phoenix Lost Boobs Hash) pre-2023 history completion — issue #1595.
 *
 * Context: the cycle-11 `backfill-lbh-phx-history.ts` recovered 2023-10 → today
 * by walking phoenixhhh.org's Big Ass Calendar. Everything earlier is gone from
 * the wp-events-manager database — pre-2023 calendar pages (re-confirmed live
 * on 2026-05-29) return empty grids, and HashRego 404s for LBH. The only public
 * trace of pre-2023 runs is the Internet Archive, which snapshotted a handful of
 * individual `phoenixhhh.org/?event=lbh-NNN-…` detail pages.
 *
 * This script harvests those archived detail pages:
 *   1. Query the Wayback CDX API for `?event=lbh-*` snapshots (HTTP 200 only).
 *   2. Keep slugs of the form `lbh-<runNumber>-…` (drops `lbh-special-event`,
 *      `lbh3-mm-meeting`, etc.), one snapshot per slug (latest).
 *   3. Fetch each via the `…/web/<ts>id_/<url>` RAW form — `id_` returns the
 *      UNREWRITTEN original HTML so the wp-events-manager template parses
 *      cleanly (no injected Wayback banner/link-rewriting).
 *   4. Run number comes from the SLUG; the event date is parsed from the page
 *      body's `MM/DD/YYYY` (NEVER the CDX snapshot timestamp — that's the crawl
 *      date). Rows with no parseable body date are skipped. Hares / location /
 *      start time / cost reuse the exported `parseDetailPage` from the parent
 *      script.
 *
 * Yield ceiling: the Archive holds only ~10-13 LBH detail pages (runs in the
 * #511-517 and #637-639 ranges), so this recovers a small slice of the ~630
 * missing pre-2023 runs. The bulk requires a WordPress admin CSV export from
 * the LBH kennel (no public path). **Issue #1595 stays OPEN** after this runs.
 *
 * Bound to "Phoenix H3 Big Ass Calendar" (trust 8 HTML scraper — the corrected
 * binding from `cleanup-lbh-misbound-rawevents.ts`; NOT the trust-7 ICS feed).
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-lbh-phx-history-completion.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-lbh-phx-history-completion.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import type { RawEventData } from "@/adapters/types";
import { runBackfillScript } from "./lib/backfill-runner";
import { parseDetailPage } from "./backfill-lbh-phx-history";

const SOURCE_NAME = "Phoenix H3 Big Ass Calendar";
const KENNEL_TAG = "lbh-phx";
const KENNEL_TIMEZONE = "America/Phoenix";
const ORIGIN = "https://www.phoenixhhh.org";

const CDX_URL =
  "https://web.archive.org/cdx/search/cdx?url=phoenixhhh.org&matchType=domain" +
  "&output=text&collapse=urlkey&fl=original,timestamp,statuscode" +
  "&filter=urlkey:.*event%3Dlbh.*&filter=statuscode:200";

const BATCH_SIZE = 3;
const POLITENESS_DELAY_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return await res.text();
      // 4xx won't improve on retry; bail. 5xx (Wayback overload) → retry.
      if (res.status < 500) return null;
    } catch {
      // network/timeout — fall through to retry
    }
    if (i < attempts - 1) await sleep(POLITENESS_DELAY_MS * (i + 1));
  }
  return null;
}

interface Snapshot {
  slug: string;
  runNumber: number;
  timestamp: string;
  /** Original phoenixhhh.org URL (used as the canonical sourceUrl). */
  original: string;
}

/** Parse CDX text rows into one latest snapshot per real `lbh-<N>` slug. */
export function parseCdxRows(cdxText: string): Snapshot[] {
  const bySlug = new Map<string, Snapshot>();
  for (const line of cdxText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [original, timestamp] = trimmed.split(/\s+/);
    if (!original || !timestamp) continue;
    const slugMatch = original.match(/[?&]event=([^&"'#]+)/i);
    if (!slugMatch) continue;
    const slug = slugMatch[1].toLowerCase();
    // Only real numbered runs: `lbh-<digits>` (drops lbh-special-event,
    // lbh3-mm-meeting, lbh3-…). Require the hyphen so "lbh3" can't match.
    const runMatch = slug.match(/^lbh-(\d{1,4})(?:-|$)/);
    if (!runMatch) continue;
    const runNumber = Number.parseInt(runMatch[1], 10);
    if (!Number.isFinite(runNumber) || runNumber <= 0) continue;
    const prev = bySlug.get(slug);
    if (!prev || timestamp > prev.timestamp) {
      bySlug.set(slug, { slug, runNumber, timestamp, original: `${ORIGIN}/?event=${slug}` });
    }
  }
  return [...bySlug.values()];
}

/**
 * Extract the event date from an archived detail page body as `YYYY-MM-DD`
 * (UTC noon). Reads the FIRST `MM/DD/YYYY` inside the entry-content — the
 * wp-events-manager `Date(s) - Weekday - MM/DD/YYYYH:MM pm` line. Returns null
 * when absent so the caller can skip the row rather than guess. Exported for
 * unit testing.
 */
export function extractBodyDate(html: string): string | null {
  const $ = cheerio.load(html);
  const text =
    $(".entry-content").first().text() ||
    $("article").first().text() ||
    $("main").text() ||
    $("body").text();
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const month = Number.parseInt(m[1], 10);
  const day = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toISOString().slice(0, 10);
}

/** Best-effort event title from the archived page, with the `LBH #N:` prefix
 *  stripped to match the live calendar walker's title format (so an overlapping
 *  event's canonical title doesn't regress to the prefixed form on merge).
 *  Falls back to undefined → merge synthesizes "Lost Boobs Hash Trail #N". */
function extractTitle(html: string): string | undefined {
  const $ = cheerio.load(html);
  const raw = ($(".entry-title").first().text() || $("h1").first().text() || "").replace(/\s+/g, " ").trim();
  if (!raw) return undefined;
  const stripped = raw.replace(/^LBH\s*#?\s*\d+\s*[:\-–]?\s*/i, "").trim();
  return stripped.length > 0 ? stripped : raw;
}

async function harvestSnapshot(snap: Snapshot): Promise<RawEventData | null> {
  const rawUrl = `https://web.archive.org/web/${snap.timestamp}id_/${snap.original}`;
  const html = await fetchText(rawUrl);
  if (!html) {
    console.warn(`  ✗ #${snap.runNumber}: snapshot fetch failed (${snap.slug})`);
    return null;
  }
  const date = extractBodyDate(html);
  if (!date) {
    console.warn(`  ✗ #${snap.runNumber}: no body date found (${snap.slug}) — skipped`);
    return null;
  }
  const detail = parseDetailPage(html);
  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: snap.runNumber,
    title: extractTitle(html),
    hares: detail.hares,
    location: detail.location,
    startTime: detail.startTime,
    cost: detail.cost,
    sourceUrl: snap.original,
  };
}

async function fetchEvents(): Promise<RawEventData[]> {
  console.log("  Querying Wayback CDX for archived LBH detail pages...");
  const cdx = await fetchText(CDX_URL);
  if (!cdx) {
    throw new Error("Wayback CDX query failed (no response after retries).");
  }
  const snapshots = parseCdxRows(cdx);
  console.log(`  ${snapshots.length} archived lbh-<N> detail page(s) found.`);

  const events: RawEventData[] = [];
  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    const batch = snapshots.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(harvestSnapshot));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) events.push(r.value);
    }
    await sleep(POLITENESS_DELAY_MS);
  }
  console.log(`  Recovered ${events.length} event(s) with a parseable body date.`);
  return events;
}

if (process.argv[1]?.endsWith("backfill-lbh-phx-history-completion.ts")) {
  runBackfillScript({
    sourceName: SOURCE_NAME,
    kennelTimezone: KENNEL_TIMEZONE,
    label: "Harvesting Wayback-archived LBH detail pages (pre-2023 completion)",
    fetchEvents,
  }).catch((err: unknown) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
