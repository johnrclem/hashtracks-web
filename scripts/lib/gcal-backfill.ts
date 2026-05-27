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
import { todayInTimezone } from "@/lib/timezone";
import type { RawEventData } from "@/adapters/types";
import { logPerKennelTally, mergeAndReport } from "./backfill-reporting";

export interface GCalBackfillParams {
  /** Source.name to look up in the DB. */
  sourceName: string;
  /** Symmetric ± window in days. 5500 ≈ 15 years; size to cover earliest event. */
  days: number;
  /** IANA timezone for the today-cutoff (e.g. "Europe/Copenhagen"). */
  timezone: string;
  /**
   * Skip the trailing `prisma.$disconnect()`. Set on every call but the last
   * when chaining multiple `backfillGCalSource` invocations in one process —
   * Prisma's `$disconnect` is terminal, and the global client is cached, so
   * a second call after disconnect would fail to query.
   */
  keepConnected?: boolean;
}

function logEventSamples(events: readonly RawEventData[]): void {
  if (events.length === 0) return;
  console.log("\nFirst 3:");
  for (const e of events.slice(0, 3)) {
    console.log(
      `  ${e.date} #${e.runNumber ?? "?"} ${e.kennelTags[0]} | ${e.title ?? "—"} | hares=${e.hares ?? "—"}`,
    );
  }
  if (events.length > 3) {
    console.log("Last 3:");
    for (const e of events.slice(-3)) {
      console.log(
        `  ${e.date} #${e.runNumber ?? "?"} ${e.kennelTags[0]} | ${e.title ?? "—"} | hares=${e.hares ?? "—"}`,
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
    // Same uniqueness guard as the shared backfill-runner — ambiguous source
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

    logPerKennelTally(historical);

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

    await mergeAndReport(source.id, historical);
  } finally {
    if (!params.keepConnected) {
      await prisma.$disconnect();
    }
  }
}

/**
 * One-call entry point for thin per-kennel wrapper scripts: run the backfill
 * and exit non-zero on failure. Lets each wrapper collapse to a single
 * statement, avoiding the duplicate `.catch(err => {console.error; exit})`
 * boilerplate flagged as duplication when several wrappers ship together.
 */
export function runGCalBackfill(params: GCalBackfillParams): void {
  backfillGCalSource(params).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
