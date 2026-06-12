import type { Prisma, SourceType } from "@/generated/prisma/client";

/**
 * "Independent ground truth" classification for prediction evaluation.
 *
 * A STATIC_SCHEDULE source *generates* its events by projecting a schedule rule, so an Event
 * backed only by STATIC_SCHEDULE RawEvents cannot independently confirm a prediction derived from
 * that same rule (it would be circular). An event is an "eligible actual" only when it is backed by
 * ≥1 RawEvent from a non-STATIC_SCHEDULE source (a real scrape: GCal, HTML, iCal, Meetup, FB, …).
 *
 * Shared by the retrospective audit (`scripts/audit-travel-predictions.ts`), the rule-fix proposal
 * script, and the Phase-2 prediction-ledger scorer so all three agree on what counts as ground truth.
 */

const STATIC_SCHEDULE: SourceType = "STATIC_SCHEDULE";

/**
 * Prisma `select` fragment that loads exactly the RawEvent → Source.type provenance
 * `isEligibleActual` needs. Spread into an Event select:
 *   select: { ..., ...EVENT_ELIGIBILITY_SELECT }
 */
export const EVENT_ELIGIBILITY_SELECT = {
  rawEvents: { select: { source: { select: { type: true } } } },
} as const satisfies Prisma.EventSelect;

/** The minimal shape `isEligibleActual` reads — an Event with its RawEvent source types. */
export interface EligibilityCheckable {
  rawEvents: { source: { type: SourceType } }[];
}

/**
 * True iff the event is backed by ≥1 RawEvent from a non-STATIC_SCHEDULE source — i.e. it is
 * independent evidence a run actually happened, not a rule projecting itself.
 *
 * An event with no RawEvents is NOT eligible (nothing to verify against). Callers are expected to
 * have already constrained status=CONFIRMED + isCanonical via `CANONICAL_EVENT_WHERE`.
 */
export function isEligibleActual(event: EligibilityCheckable): boolean {
  return event.rawEvents.some((re) => re.source.type !== STATIC_SCHEDULE);
}
