/**
 * One-shot historical backfill for Mexico City H3 (mch3).
 *
 * The recurring source ("Mexico City H3 Meetup") reads the Meetup events page,
 * which is a rolling upcoming-only window (`config.upcomingOnly: true`). The 10
 * most recent runs (#746 2025-07 → #756 2026-05) therefore never reach canonical
 * Events through the live adapter once they age off the upcoming feed.
 *
 * Those 10 runs were extracted once from the Meetup past-events Apollo state and
 * frozen into `scripts/data/mch3-history.json` — committed as data, no parser,
 * per the Asunción/H7 lesson. The rows bind to the live "Mexico City H3 Meetup"
 * source for provenance.
 *
 * The frozen `title` is the real (cleaned) Meetup event name — captured live and
 * verified to be exactly what `MeetupAdapter` emits (`buildRawEventFromApollo`
 * sets `title: cleanMeetupTitle(...)`, and merge.ts keeps an adapter-provided
 * title rather than synthesizing). Mirroring it keeps the backfilled past runs
 * consistent with the live-scraped runs (no title churn on the in-window overlap)
 * instead of leaving them as synthesized "Trail #N" placeholders.
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-mch3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-mch3-history.ts
 *
 * Requires the "Mexico City H3 Meetup" source to exist (run `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import mch3History from "./data/mch3-history.json";

const SOURCE_NAME = "Mexico City H3 Meetup";
const KENNEL_TIMEZONE = "America/Mexico_City";
const GROUP_URL = "https://www.meetup.com/mexico-city-hash-house-harriers/";

interface FrozenRun {
  runNumber: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string; // real (cleaned) Meetup event name — matches what MeetupAdapter emits
  location: string | null;
  address: string | null;
}

function toRawEvent(run: FrozenRun): RawEventData {
  return {
    date: run.date,
    kennelTags: ["mch3"],
    runNumber: run.runNumber,
    title: run.title,
    startTime: run.startTime ?? undefined,
    endTime: run.endTime ?? undefined,
    location: run.location ?? undefined,
    locationStreet: run.address ?? undefined,
    sourceUrl: GROUP_URL,
  };
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading curated Mexico City H3 Meetup archive",
  fetchEvents: async () => (mch3History as FrozenRun[]).map(toRawEvent),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
