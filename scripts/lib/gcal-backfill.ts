/**
 * Reusable wide-window Google Calendar historical backfill helper.
 *
 * GoogleCalendarAdapter.fetch() takes a symmetric `days` window (now ± days).
 * The recurring scrape uses ~365 days, so a calendar with 10+ years of
 * history loses everything older than the window every run. This helper
 * pulls the full archive in one shot, partitions to historical events
 * (date < today in the kennel timezone), and routes the result through
 * the merge pipeline so canonical Events are created inline.
 *
 * Reconcile safety: the recurring scrape's reconcile step only operates on
 * events within its own window. Events older than that window are never
 * cancelled by reconcile, so historical backfill rows are stable across
 * future scrapes.
 *
 * Used by per-source wrappers in scripts/backfill-<kennel>-history.ts.
 */

import { prisma } from "@/lib/db";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";
import { processRawEvents } from "@/pipeline/merge";
import { todayInTimezone } from "@/lib/timezone";
import type { RawEventData } from "@/adapters/types";

export interface GCalBackfillParams {
  /** Source.name to look up in the DB. */
  sourceName: string;
  /** Symmetric ± window in days. 5500 ≈ 15 years; size to cover earliest event. */
  days: number;
  /** IANA timezone for the today-cutoff (e.g. "Europe/Copenhagen"). */
  timezone: string;
}

function logEventSamples(events: readonly RawEventData[]): void {
  if (events.length === 0) return;
  console.log("\nFirst 3:");
  for (const e of events.slice(0, 3)) {
    console.log(
      `  ${e.date} #${e.runNumber ?? "?"} ${e.kennelTag} | ${e.title ?? "—"} | hares=${e.hares ?? "—"}`,
    );
  }
  if (events.length > 3) {
    console.log("Last 3:");
    for (const e of events.slice(-3)) {
      console.log(
        `  ${e.date} #${e.runNumber ?? "?"} ${e.kennelTag} | ${e.title ?? "—"} | hares=${e.hares ?? "—"}`,
      );
    }
  }
}

export async function backfillGCalSource(params: GCalBackfillParams): Promise<void> {
  const apply = process.env.BACKFILL_APPLY === "1";
  const todayIso = todayInTimezone(params.timezone);
  console.log(`GCal historical backfill: source="${params.sourceName}"`);
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Window: ± ${params.days} days. Cutoff (${params.timezone}): date < ${todayIso}`);

  try {
    // Match insertRawEventsForSource's uniqueness check — ambiguous source
    // names must abort, never silently bind to the first match.
    const sources = await prisma.source.findMany({ where: { name: params.sourceName } });
    if (sources.length === 0) throw new Error(`Source "${params.sourceName}" not found in DB.`);
    if (sources.length > 1) {
      throw new Error(
        `Multiple sources named "${params.sourceName}" found (${sources.length}). Aborting to avoid writing to the wrong one.`,
      );
    }
    const source = sources[0];

    console.log("\nFetching from Google Calendar API...");
    const adapter = new GoogleCalendarAdapter();
    const result = await adapter.fetch(source, { days: params.days });
    if (result.errors && result.errors.length > 0) {
      console.warn(`  Adapter reported ${result.errors.length} non-fatal error(s):`);
      for (const e of result.errors.slice(0, 5)) console.warn(`    ${e}`);
    }
    console.log(`  Adapter returned ${result.events.length} events.`);

    const historical = result.events.filter((e) => e.date < todayIso);
    console.log(`  Historical (date < ${todayIso}): ${historical.length}`);

    // Tally per-kennel for visibility on multi-kennel calendars.
    const byKennel = new Map<string, number>();
    for (const ev of historical) {
      byKennel.set(ev.kennelTag, (byKennel.get(ev.kennelTag) ?? 0) + 1);
    }
    if (byKennel.size > 0) {
      console.log("  Per-kennel:");
      for (const [tag, n] of [...byKennel.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${tag}: ${n}`);
      }
    }

    historical.sort((a, b) => a.date.localeCompare(b.date));
    if (historical.length > 0) {
      console.log(`\nDate range: ${historical[0].date} → ${historical.at(-1)!.date}`);
    }
    logEventSamples(historical);

    if (!apply) {
      console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
      return;
    }
    if (historical.length === 0) {
      console.log("\nNothing to insert.");
      return;
    }

    console.log(`\nDelegating ${historical.length} events to merge pipeline...`);
    const merge = await processRawEvents(source.id, historical);
    console.log(
      `Done. created=${merge.created} updated=${merge.updated} skipped=${merge.skipped} ` +
        `unmatched=${merge.unmatched.length} blocked=${merge.blocked} errors=${merge.eventErrors}`,
    );
    if (merge.unmatched.length > 0) {
      console.log(`  Unmatched tags: ${merge.unmatched.join(", ")}`);
    }
    if (merge.blocked > 0) {
      console.log(
        `  Blocked: ${merge.blocked} events were rejected by source-kennel guard ` +
          `(SourceKennel link missing for tag(s): ${merge.blockedTags.join(", ")}).`,
      );
    }
    if (merge.eventErrors > 0) {
      const sampleErrors = merge.eventErrorMessages.slice(0, 5).join("\n    ");
      console.log(`  Errors:\n    ${sampleErrors}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
