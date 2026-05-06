/**
 * Reusable one-shot historical backfill for ANY SFH3 MultiHash kennel.
 *
 * SFH3's hareline (sfh3.com/runs) paginates by period, so a wide-`days`
 * rescrape via the recurring adapter does NOT reach history — the adapter
 * only fetches the current period + upcoming. To backfill years of history
 * we hit each period bucket once and feed the rows through the shared merge
 * pipeline, scoped to `date < today` (in the source's local timezone) so the
 * backfill cannot collide with the recurring adapter's current-period view.
 *
 * Used by per-kennel wrappers in scripts/backfill-<kennel>-sfh3-history.ts.
 * Future SFH3 kennel audits: add another wrapper, don't re-implement this.
 *
 * Finding a kennel's numeric id: inspect the `<option value="N">` list on
 * any sfh3.com/runs page (the kennel dropdown). Agnews = 13, etc.
 *
 * Reconcile safety: SFH3 HTML `scrapeDays = 90`. The recurring scrape
 * already covers the current period, so backfill rows in that bucket mostly
 * no-op via fingerprint dedup. Historical buckets (2021-2024 and earlier)
 * are entirely outside the ±90d reconcile window, so reconcile never
 * considers them. No cancellation risk.
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { fetchHTMLPage, parse12HourTime } from "@/adapters/utils";
import { parseHarelineRows, parseSFH3Date } from "@/adapters/html-scraper/sfh3";
import { enrichSFH3Events } from "@/adapters/html-scraper/sfh3-detail-enrichment";
import { generateFingerprint } from "@/pipeline/fingerprint";
import { processRawEvents } from "@/pipeline/merge";
import type { RawEventData } from "@/adapters/types";

/** Default historical period buckets exposed by sfh3.com/runs as of 2026-04. */
export const SFH3_HISTORICAL_PERIODS = [
  "2025-2026",
  "2021-2024",
  "2017-2020",
  "2009-2016",
] as const;

/** SFH3 is a Bay Area source — historical cutoff is computed in Pacific time. */
const DEFAULT_TIMEZONE = "America/Los_Angeles";

export interface Sfh3BackfillParams {
  /** Numeric kennel id from sfh3.com's `kennel=N` dropdown. */
  sfh3KennelId: number;
  /** HashTracks Kennel.kennelCode — hardcoded as `kennelTag` on every row. */
  kennelCode: string;
  /** Source.name to look up (typically "SFH3 MultiHash HTML Hareline"). */
  sourceName: string;
  /** Override the period list (e.g. to test a single bucket). */
  periods?: readonly string[];
  /** IANA timezone for the historical cutoff. Defaults to America/Los_Angeles. */
  timezone?: string;
  /**
   * Fetch per-run detail pages to pull the "Comment" field into the
   * description. One extra request per row (~350 for a full Agnews
   * backfill ≈ 2-3 minutes). Defaults to true because historical events
   * without descriptions are low-value.
   */
  enrichDetailPages?: boolean;
  /**
   * Expected label text inside the selected `<option>` for `sfh3KennelId`
   * (e.g. "EBH3"). When set, the page must emit
   * `<option selected="selected" value="<id>">{expectedLabel}</option>` —
   * proving the numeric id still maps to the intended kennel upstream. If
   * sfh3.com renumbers its dropdown or this wrapper is given a wrong id by
   * a copy-paste mistake, the assertion fails before any writes instead of
   * silently importing another kennel's history under our `kennelCode`.
   * Optional for backward compatibility with existing wrappers; new
   * wrappers should always set it.
   */
  expectedLabel?: string;
}

/** Build the SFH3 hareline URL for a given kennel + period bucket. */
function buildUrl(sfh3KennelId: number, period: string): string {
  return `https://www.sfh3.com/runs?kennel=${sfh3KennelId}&period=${encodeURIComponent(period)}`;
}

/** Extract yyyy-mm-dd "today" in the given IANA timezone. */
function localTodayIso(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  // en-CA formats as YYYY-MM-DD which is exactly what we need.
  return parts;
}

/** Guard: confirm the fetched page is actually filtered to the expected kennel. */
function assertKennelFilterApplied(
  html: string,
  sfh3KennelId: number,
  url: string,
  expectedLabel?: string,
): void {
  // The hareline renders `<option selected="selected" value="<id>">` inside
  // the kennel <select>. If SFH3 ever stops honoring `kennel=<id>`, the
  // selected value will be "*" (All kennels) and we'd silently import other
  // kennels' history under our target — direct data corruption. Fail closed.
  // String match (no dynamic RegExp) — Codacy flags template-literal RegExp
  // construction as a security smell even though sfh3KennelId is typed number.
  const marker = `<option selected="selected" value="${sfh3KennelId}"`;
  if (!html.includes(marker)) {
    throw new Error(
      `SFH3 kennel filter not applied at ${url} — expected selected kennel id ${sfh3KennelId}. ` +
        `Refusing to backfill to avoid cross-kennel data corruption.`,
    );
  }
  // Identity check: id alone proves the page is filtered, not that the id
  // maps to the kennel we think it does. If a wrapper passes a wrong id (or
  // sfh3.com renumbers the dropdown), this catches the mismatch before any
  // writes — instead of importing another kennel's full history under
  // `kennelCode`.
  if (expectedLabel !== undefined) {
    const labelMarker = `${marker}>${expectedLabel}</option>`;
    if (!html.includes(labelMarker)) {
      throw new Error(
        `SFH3 kennel id ${sfh3KennelId} does not map to "${expectedLabel}" at ${url}. ` +
          `Refusing to backfill — verify the kennel dropdown on sfh3.com.`,
      );
    }
  }
}

/** Format a single event as a one-line sample for dry-run/apply logs. */
function formatEventSample(event: RawEventData): string {
  const descPreview = event.description ? `${event.description.slice(0, 60)}…` : "-";
  return `  ${event.date} #${event.runNumber ?? "?"} | ${event.title ?? "-"} | hares=${event.hares ?? "-"} | desc=${descPreview}`;
}

/** Log the first 3 + last 3 events (or just all of them if ≤ 3). */
function logEventSamples(events: readonly RawEventData[]): void {
  console.log("\nFirst 3:");
  events.slice(0, 3).forEach((e) => console.log(formatEventSample(e)));
  if (events.length > 3) {
    console.log("Last 3:");
    events.slice(-3).forEach((e) => console.log(formatEventSample(e)));
  }
}

/**
 * Fetch one period bucket, validate the kennel filter was honored, then
 * map each parsed hareline row into a `RawEventData`. Skips rows with
 * unparseable dates.
 */
async function fetchPeriodRows(
  sfh3KennelId: number,
  period: string,
  kennelCode: string,
  expectedLabel?: string,
): Promise<{ events: RawEventData[]; skippedDate: number }> {
  const url = buildUrl(sfh3KennelId, period);
  const page = await fetchHTMLPage(url);
  if (!page.ok) {
    throw new Error(`Failed to fetch ${url}: ${page.result.errors.join("; ")}`);
  }
  assertKennelFilterApplied(page.html, sfh3KennelId, url, expectedLabel);

  const rows = parseHarelineRows(page.html);
  const events: RawEventData[] = [];
  let skippedDate = 0;
  for (const row of rows) {
    const date = parseSFH3Date(row.dateText);
    if (!date) {
      skippedDate++;
      continue;
    }
    const detailUrl = row.detailUrl
      ? new URL(row.detailUrl, "https://www.sfh3.com").href
      : url;
    events.push({
      date,
      kennelTags: [kennelCode],
      runNumber: row.runNumber,
      title: row.title || undefined,
      hares: row.hare,
      location: row.locationText,
      locationUrl: row.locationUrl,
      startTime: parse12HourTime(row.dateText),
      sourceUrl: detailUrl,
    });
  }
  return { events, skippedDate };
}

export async function backfillSfh3Kennel(params: Sfh3BackfillParams): Promise<void> {
  const periods = params.periods ?? SFH3_HISTORICAL_PERIODS;
  const timezone = params.timezone ?? DEFAULT_TIMEZONE;
  const enrichDetailPages = params.enrichDetailPages ?? true;
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`SFH3 historical backfill: kennel=${params.kennelCode} (sfh3 id ${params.sfh3KennelId})`);
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Periods: ${periods.join(", ")}`);
  console.log(`Timezone: ${timezone}  Enrich detail pages: ${enrichDetailPages}`);

  const todayIso = localTodayIso(timezone);
  console.log(`Historical cutoff (local): date < ${todayIso}`);

  const allEvents: RawEventData[] = [];
  let totalSkippedDate = 0;

  for (const period of periods) {
    const { events, skippedDate } = await fetchPeriodRows(
      params.sfh3KennelId,
      period,
      params.kennelCode,
      params.expectedLabel,
    );
    const historical = events.filter((e) => e.date < todayIso);
    console.log(
      `  period ${period}: fetched ${events.length}, historical ${historical.length}, skipped-date ${skippedDate}`,
    );
    allEvents.push(...historical);
    totalSkippedDate += skippedDate;
    // Polite pacing between sequential fetches.
    await new Promise((r) => setTimeout(r, 500));
  }

  // De-dup by fingerprint within the fetch set itself (periods can overlap a
  // future-boundary row between buckets if the source edits a period label).
  const seen = new Set<string>();
  const unique: RawEventData[] = [];
  for (const event of allEvents) {
    const fingerprint = generateFingerprint(event);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    unique.push(event);
  }

  console.log(
    `\nTotal historical rows: ${allEvents.length} (unique ${unique.length}, skipped-date ${totalSkippedDate})`,
  );
  if (unique.length === 0) {
    console.log("No rows to insert. Exiting.");
    return;
  }

  // Detail-page enrichment BEFORE sorting/logging so samples show the full
  // description. enrichSFH3Events filters out e.date >= todayIso internally
  // (which is fine — every row here is already historical). It fetches in
  // batches of 10, capped at MAX_ENRICH_PER_SCRAPE (200). The cap is lifted
  // below for one-shot historical backfills by calling enrich in chunks.
  if (enrichDetailPages) {
    console.log(`\nEnriching ${unique.length} events from detail pages (may take ~2-3 min)...`);
    // enrichSFH3Events uses a per-scrape cap; loop in safe chunks and pass
    // `now` in the past so the internal future-filter keeps every row.
    const pastReferenceNow = new Date("2000-01-01T00:00:00Z");
    const CHUNK = 150;
    let totalEnriched = 0;
    let totalFailures = 0;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const res = await enrichSFH3Events(chunk, { now: pastReferenceNow });
      totalEnriched += res.enriched;
      totalFailures += res.failures.length;
      console.log(
        `  chunk ${Math.floor(i / CHUNK) + 1}: enriched=${res.enriched} failures=${res.failures.length}`,
      );
    }
    console.log(`Enrichment complete: ${totalEnriched} enriched, ${totalFailures} failures.`);
  }

  // Sort by date for readable sample output.
  unique.sort((a, b) => a.date.localeCompare(b.date));
  logEventSamples(unique);

  if (!apply) {
    console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    return;
  }

  try {
    // Kennel + source existence are independent — look them up in parallel.
    const [kennel, source] = await Promise.all([
      prisma.kennel.findUnique({ where: { kennelCode: params.kennelCode } }),
      prisma.source.findFirst({ where: { name: params.sourceName } }),
    ]);
    if (!kennel) throw new Error(`Kennel ${params.kennelCode} not found. Run prisma db seed first.`);
    if (!source) throw new Error(`Source "${params.sourceName}" not found. Run prisma db seed first.`);

    // Preflight: the target kennel MUST be linked to the source via
    // SourceKennel or the merge pipeline's source-kennel guard will block
    // every row as "unlinked" — leaving orphaned unprocessed RawEvents that
    // re-insert on every retry. Fail closed before any writes.
    const link = await prisma.sourceKennel.findFirst({
      where: { sourceId: source.id, kennelId: kennel.id },
      select: { id: true },
    });
    if (!link) {
      throw new Error(
        `Source "${params.sourceName}" is not linked to kennel "${params.kennelCode}" via SourceKennel. ` +
          `Create the link in admin before running this backfill.`,
      );
    }

    // Route through the real merge pipeline so canonical Events are created
    // inline. `processRawEvents` handles RawEvent row creation itself,
    // dedupes by fingerprint against any prior inserts, and flips
    // processed:true as it links each raw row to its canonical Event.
    // Safe to re-run: fingerprint dedup short-circuits duplicates.
    console.log(`\nDelegating ${unique.length} events to merge pipeline...`);
    const mergeResult = await processRawEvents(source.id, unique);
    console.log(
      `\nDone. created=${mergeResult.created} updated=${mergeResult.updated} skipped=${mergeResult.skipped} unmatched=${mergeResult.unmatched.length} blocked=${mergeResult.blocked}`,
    );
    // One-shot backfill: any partial failure is fatal. A silent exit 0 with
    // missing history is worse than a loud abort we can retry.
    if (mergeResult.blocked > 0) {
      throw new Error(
        `${mergeResult.blocked} events were BLOCKED by source-kennel guard — aborting. ` +
          `This should have been caught by the preflight link check above.`,
      );
    }
    if (mergeResult.unmatched.length > 0) {
      throw new Error(`Unexpected unmatched tags: ${mergeResult.unmatched.join(", ")}`);
    }
    if (mergeResult.eventErrors > 0) {
      const sampleErrors = mergeResult.eventErrorMessages.slice(0, 10).join("\n  ");
      throw new Error(
        `Merge pipeline reported ${mergeResult.eventErrors} event errors:\n  ${sampleErrors}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}
