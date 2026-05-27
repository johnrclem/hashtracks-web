/**
 * Shared reporting/merge tail for one-shot backfill scripts.
 *
 * Every adapter-driven backfill script ends with the same three blocks:
 *   1. Per-kennel tally of the events about to be inserted.
 *   2. Delegation to `processRawEvents` for the actual merge.
 *   3. Pretty-printed merge result + per-error/blocked/unmatched breakdown.
 *
 * These are extracted here so the per-script files can collapse to the
 * unique parts (URL override, kennel filter, config update). Without the
 * extraction the same ~18 lines repeat across gcal-backfill.ts, lds-h3,
 * ich3, and mihihuha — flagged as 9% duplicated lines by SonarCloud on
 * the cluster-sweep PR.
 *
 * No DB connection management here — callers own `prisma.$disconnect()`
 * in their own `try/finally`, because some scripts (e.g. ICH3) need to
 * keep the connection open for a config-row update before the merge.
 */

import { processRawEvents } from "@/pipeline/merge";
import type { RawEventData } from "@/adapters/types";

/**
 * Log a per-kennel tally of the events about to be inserted. Sorted by
 * descending count so the biggest backfill targets surface first.
 *
 * Empty event list → no output. Caller is expected to handle the
 * empty-input case separately.
 */
export function logPerKennelTally(events: readonly RawEventData[]): void {
  if (events.length === 0) return;
  const byKennel = new Map<string, number>();
  for (const ev of events) {
    const tag = ev.kennelTags[0];
    byKennel.set(tag, (byKennel.get(tag) ?? 0) + 1);
  }
  if (byKennel.size === 0) return;
  console.log("  Per-kennel:");
  for (const [tag, n] of [...byKennel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${tag}: ${n}`);
  }
}

/**
 * Delegate the historical event slice to the merge pipeline and pretty-
 * print the result. Surfaces the standard breakdowns:
 *   - created / updated / skipped / unmatched / blocked / eventErrors
 *   - unmatched kennel tags (when any)
 *   - blocked tags + reason (when any)
 *   - first 5 event-error messages (when any)
 *
 * Returns the raw merge result so callers can post-assert (e.g. fail loud
 * if blocked > N) if they want.
 */
export async function mergeAndReport(
  sourceId: string,
  events: readonly RawEventData[],
): Promise<Awaited<ReturnType<typeof processRawEvents>>> {
  console.log(`\nDelegating ${events.length} events to merge pipeline...`);
  const merge = await processRawEvents(sourceId, events as RawEventData[]);
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
  return merge;
}
